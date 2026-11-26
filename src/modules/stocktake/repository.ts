import sql from 'mssql';
import { getInventoryTable, getMssqlPool } from '../../core/db/pool';
import { SqliteSandbox } from '../../core/db/sqliteSandbox';
import { notFoundError, serverError } from '../../core/http/envelope';
import { StocktakeHead, StocktakeLine, StocktakeListRow } from './types';

export interface StocktakeRepository {
  createStocktake(name: string, createdBy: string): Promise<StocktakeHead>;
  listStocktakes(): Promise<StocktakeListRow[]>;
  getStocktakeById(id: number): Promise<StocktakeHead | null>;
  listLines(stocktakeId: number): Promise<StocktakeLine[]>;
  lookupG1Product(barcode: string): Promise<{ Barcode: string; Nazov: string; Surplus: number } | null>;
  upsertLineAndSyncG1(params: {
    stocktakeId: number;
    barcode: string;
    nazov: string;
    systemQty: number;
    countedQty: number;
    variance: number;
    warningAt: number | null;
    hasWarningAt: boolean;
    notes: string | null;
  }): Promise<StocktakeLine>;
  submitStocktake(id: number): Promise<StocktakeHead>;
  deleteStocktake(id: number): Promise<boolean>;
}

function normalizeHead(row: any): StocktakeHead {
  return {
    Id: Number(row.Id),
    Name: String(row.Name ?? ''),
    CountDate: row.CountDate instanceof Date ? row.CountDate.toISOString() : String(row.CountDate ?? ''),
    CreatedBy: String(row.CreatedBy ?? ''),
    Status: row.Status === 'submitted' ? 'submitted' : 'open',
    SyncedToG1:
      row.SyncedToG1 === null || row.SyncedToG1 === undefined
        ? null
        : row.SyncedToG1 instanceof Date
        ? row.SyncedToG1.toISOString()
        : String(row.SyncedToG1),
  };
}

function normalizeLine(row: any): StocktakeLine {
  return {
    Id: row.Id !== undefined ? Number(row.Id) : undefined,
    StocktakeId: row.StocktakeId !== undefined ? Number(row.StocktakeId) : undefined,
    Barcode: String(row.Barcode ?? '').trim(),
    Nazov: row.Nazov === null || row.Nazov === undefined ? null : String(row.Nazov),
    SystemQty: Number(row.SystemQty ?? 0),
    CountedQty: Number(row.CountedQty ?? 0),
    Variance: Number(row.Variance ?? 0),
    WarningAt: row.WarningAt === null || row.WarningAt === undefined ? null : Number(row.WarningAt),
    Notes: row.Notes === null || row.Notes === undefined ? null : String(row.Notes),
  };
}

export class MssqlStocktakeRepository implements StocktakeRepository {
  async createStocktake(name: string, createdBy: string): Promise<StocktakeHead> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    req.input('Name', sql.NVarChar(200), name);
    req.input('CreatedBy', sql.NVarChar(100), createdBy);
    req.input('CountDate', sql.DateTime2, new Date());
    const res = await req.query(`
      INSERT INTO dbo.Stocktake (Name, CountDate, CreatedBy, Status, SyncedToG1)
      OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.CountDate, INSERTED.CreatedBy, INSERTED.Status, INSERTED.SyncedToG1
      VALUES (@Name, @CountDate, @CreatedBy, N'open', NULL)
    `);
    return normalizeHead(res.recordset[0]);
  }

  async listStocktakes(): Promise<StocktakeListRow[]> {
    const pool = await getMssqlPool('saledata');
    const res = await pool.request().query(`
      SELECT
        s.Id, s.Name, s.CountDate, s.CreatedBy, s.Status, s.SyncedToG1,
        COUNT(l.Id) AS LineCount,
        SUM(CASE WHEN ABS(COALESCE(l.Variance, 0)) > 0.0001 THEN 1 ELSE 0 END) AS DiffCount
      FROM dbo.Stocktake s
      LEFT JOIN dbo.StocktakeLine l ON l.StocktakeId = s.Id
      GROUP BY s.Id, s.Name, s.CountDate, s.CreatedBy, s.Status, s.SyncedToG1
      ORDER BY s.Id DESC
    `);
    return res.recordset.map((r) => ({
      ...normalizeHead(r),
      LineCount: Number(r.LineCount ?? 0),
      DiffCount: Number(r.DiffCount ?? 0),
    }));
  }

  async getStocktakeById(id: number): Promise<StocktakeHead | null> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    req.input('Id', sql.Int, id);
    const res = await req.query(`
      SELECT Id, Name, CountDate, CreatedBy, Status, SyncedToG1
      FROM dbo.Stocktake
      WHERE Id = @Id
    `);
    if (res.recordset.length === 0) return null;
    return normalizeHead(res.recordset[0]);
  }

  async listLines(stocktakeId: number): Promise<StocktakeLine[]> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    req.input('StocktakeId', sql.Int, stocktakeId);
    const res = await req.query(`
      SELECT Id, StocktakeId, Barcode, Nazov, SystemQty, CountedQty, Variance, WarningAt, Notes
      FROM dbo.StocktakeLine
      WHERE StocktakeId = @StocktakeId
      ORDER BY Id DESC
    `);
    return res.recordset.map(normalizeLine);
  }

  async lookupG1Product(barcode: string): Promise<{ Barcode: string; Nazov: string; Surplus: number } | null> {
    const pool = await getMssqlPool('sklad');
    const req = pool.request();
    req.input('bc', sql.VarChar(13), barcode.trim());
    const res = await req.query(`
      SELECT TOP (1) Barcode, Nazov, Surplus
      FROM ${getInventoryTable()}
      WHERE TRIM(Barcode) = @bc
    `);
    if (res.recordset.length === 0) return null;
    const row = res.recordset[0];
    return {
      Barcode: String(row.Barcode ?? '').trim(),
      Nazov: String(row.Nazov ?? ''),
      Surplus: Number(row.Surplus ?? 0) || 0,
    };
  }

  /**
   * Cross-database two-step write (§6.2, §7.4):
   * Step 1: Upsert SaleData.dbo.StocktakeLine
   * Step 2: Update the configured inventory table's Surplus and optional WarningAt.
   * Never swallows Step 2 failure (B-30 / §9.4).
   */
  async upsertLineAndSyncG1(params: {
    stocktakeId: number;
    barcode: string;
    nazov: string;
    systemQty: number;
    countedQty: number;
    variance: number;
    warningAt: number | null;
    hasWarningAt: boolean;
    notes: string | null;
  }): Promise<StocktakeLine> {
    const salePool = await getMssqlPool('saledata');
    const skladPool = await getMssqlPool('sklad');
    const bc = params.barcode.trim();

    // Step 1: Upsert StocktakeLine by (StocktakeId, TRIM(Barcode))
    const findReq = salePool.request();
    findReq.input('StocktakeId', sql.Int, params.stocktakeId);
    findReq.input('Barcode', sql.VarChar(13), bc);
    const existing = await findReq.query(`
      SELECT TOP (1) Id FROM dbo.StocktakeLine
      WHERE StocktakeId = @StocktakeId AND TRIM(Barcode) = @Barcode
    `);

    let savedLine: StocktakeLine;
    if (existing.recordset.length > 0) {
      const lineId = Number(existing.recordset[0].Id);
      const updReq = salePool.request();
      updReq.input('Id', sql.Int, lineId);
      updReq.input('Nazov', sql.NVarChar(510), params.nazov);
      updReq.input('SystemQty', sql.Real, params.systemQty);
      updReq.input('CountedQty', sql.Real, params.countedQty);
      updReq.input('Variance', sql.Real, params.variance);
      updReq.input('WarningAt', sql.Real, params.hasWarningAt ? params.warningAt : null);
      updReq.input('Notes', sql.NVarChar(1000), params.notes);
      const updRes = await updReq.query(`
        UPDATE dbo.StocktakeLine
        SET Nazov = @Nazov,
            SystemQty = @SystemQty,
            CountedQty = @CountedQty,
            Variance = @Variance,
            WarningAt = CASE WHEN @WarningAt IS NOT NULL THEN @WarningAt ELSE WarningAt END,
            Notes = @Notes
        OUTPUT INSERTED.Id, INSERTED.StocktakeId, INSERTED.Barcode, INSERTED.Nazov,
               INSERTED.SystemQty, INSERTED.CountedQty, INSERTED.Variance, INSERTED.WarningAt, INSERTED.Notes
        WHERE Id = @Id
      `);
      savedLine = normalizeLine(updRes.recordset[0]);
    } else {
      const insReq = salePool.request();
      insReq.input('StocktakeId', sql.Int, params.stocktakeId);
      insReq.input('Barcode', sql.VarChar(13), bc);
      insReq.input('Nazov', sql.NVarChar(510), params.nazov);
      insReq.input('SystemQty', sql.Real, params.systemQty);
      insReq.input('CountedQty', sql.Real, params.countedQty);
      insReq.input('Variance', sql.Real, params.variance);
      insReq.input('WarningAt', sql.Real, params.hasWarningAt ? params.warningAt : null);
      insReq.input('Notes', sql.NVarChar(1000), params.notes);
      const insRes = await insReq.query(`
        INSERT INTO dbo.StocktakeLine (StocktakeId, Barcode, Nazov, SystemQty, CountedQty, Variance, WarningAt, Notes)
        OUTPUT INSERTED.Id, INSERTED.StocktakeId, INSERTED.Barcode, INSERTED.Nazov,
               INSERTED.SystemQty, INSERTED.CountedQty, INSERTED.Variance, INSERTED.WarningAt, INSERTED.Notes
        VALUES (@StocktakeId, @Barcode, @Nazov, @SystemQty, @CountedQty, @Variance, @WarningAt, @Notes)
      `);
      savedLine = normalizeLine(insRes.recordset[0]);
    }

    // Step 2: Immediate inventory write-back.
    try {
      const g1Req = skladPool.request();
      g1Req.input('bc', sql.VarChar(13), bc);
      g1Req.input('Surplus', sql.Real, params.countedQty);
      let sqlStr = `UPDATE ${getInventoryTable()} SET Surplus = @Surplus`;
      if (params.hasWarningAt && params.warningAt !== null) {
        g1Req.input('WarningAt', sql.SmallInt, params.warningAt);
        sqlStr += `, WarningAt = @WarningAt`;
      }
      sqlStr += ` WHERE TRIM(Barcode) = @bc`;
      const g1Res = await g1Req.query(sqlStr);
      if (Number(g1Res.rowsAffected[0] ?? 0) === 0) {
        throw new Error(`门店库存主表中找不到条码 ${bc}`);
      }
    } catch (err: any) {
      console.error(
        `[Stocktake Sync Error] StocktakeLine written (stocktake=${params.stocktakeId}, barcode=${bc}), inventory update failed: ${err?.message}`
      );
      throw serverError(
        `盘点行已记录，但回写门店库存主表失败（请重扫该条码以重试同步）：${err?.message || '数据库错误'}`
      );
    }

    return savedLine;
  }

  async submitStocktake(id: number): Promise<StocktakeHead> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    req.input('Id', sql.Int, id);
    req.input('SyncedToG1', sql.DateTime2, new Date());
    const res = await req.query(`
      UPDATE dbo.Stocktake
      SET Status = N'submitted', SyncedToG1 = @SyncedToG1
      OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.CountDate, INSERTED.CreatedBy, INSERTED.Status, INSERTED.SyncedToG1
      WHERE Id = @Id
    `);
    if (res.recordset.length === 0) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    return normalizeHead(res.recordset[0]);
  }

  async deleteStocktake(id: number): Promise<boolean> {
    const pool = await getMssqlPool('saledata');
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const delLines = new sql.Request(tx);
      delLines.input('Id', sql.Int, id);
      await delLines.query(`DELETE FROM dbo.StocktakeLine WHERE StocktakeId = @Id`);

      const delHead = new sql.Request(tx);
      delHead.input('Id', sql.Int, id);
      const res = await delHead.query(`DELETE FROM dbo.Stocktake WHERE Id = @Id`);
      await tx.commit();
      return Number(res.rowsAffected[0] ?? 0) > 0;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }
}

export class SqliteStocktakeRepository implements StocktakeRepository {
  constructor(private sandbox: SqliteSandbox) {}

  async createStocktake(name: string, createdBy: string): Promise<StocktakeHead> {
    const now = new Date().toISOString();
    const res = this.sandbox.db
      .prepare(`INSERT INTO Stocktake (Name, CountDate, CreatedBy, Status, SyncedToG1) VALUES (?, ?, ?, 'open', NULL)`)
      .run(name, now, createdBy);
    const id = Number(res.lastInsertRowid);
    const row = this.sandbox.db.prepare(`SELECT * FROM Stocktake WHERE Id = ?`).get(id);
    return normalizeHead(row);
  }

  async listStocktakes(): Promise<StocktakeListRow[]> {
    const rows = this.sandbox.db
      .prepare(`
        SELECT
          s.Id, s.Name, s.CountDate, s.CreatedBy, s.Status, s.SyncedToG1,
          COUNT(l.Id) AS LineCount,
          COALESCE(SUM(CASE WHEN ABS(COALESCE(l.Variance, 0)) > 0.0001 THEN 1 ELSE 0 END), 0) AS DiffCount
        FROM Stocktake s
        LEFT JOIN StocktakeLine l ON l.StocktakeId = s.Id
        GROUP BY s.Id, s.Name, s.CountDate, s.CreatedBy, s.Status, s.SyncedToG1
        ORDER BY s.Id DESC
      `)
      .all();
    return rows.map((r: any) => ({
      ...normalizeHead(r),
      LineCount: Number(r.LineCount ?? 0),
      DiffCount: Number(r.DiffCount ?? 0),
    }));
  }

  async getStocktakeById(id: number): Promise<StocktakeHead | null> {
    const row = this.sandbox.db.prepare(`SELECT * FROM Stocktake WHERE Id = ?`).get(id);
    return row ? normalizeHead(row) : null;
  }

  async listLines(stocktakeId: number): Promise<StocktakeLine[]> {
    const rows = this.sandbox.db
      .prepare(`SELECT * FROM StocktakeLine WHERE StocktakeId = ? ORDER BY Id DESC`)
      .all(stocktakeId);
    return rows.map(normalizeLine);
  }

  async lookupG1Product(barcode: string): Promise<{ Barcode: string; Nazov: string; Surplus: number } | null> {
    const row = this.sandbox.db
      .prepare(`SELECT Barcode, Nazov, Surplus FROM g1 WHERE TRIM(Barcode) = ? LIMIT 1`)
      .get(barcode.trim()) as any;
    if (!row) return null;
    return {
      Barcode: String(row.Barcode ?? '').trim(),
      Nazov: String(row.Nazov ?? ''),
      Surplus: Number(row.Surplus ?? 0) || 0,
    };
  }

  async upsertLineAndSyncG1(params: {
    stocktakeId: number;
    barcode: string;
    nazov: string;
    systemQty: number;
    countedQty: number;
    variance: number;
    warningAt: number | null;
    hasWarningAt: boolean;
    notes: string | null;
  }): Promise<StocktakeLine> {
    const bc = params.barcode.trim();
    const existing = this.sandbox.db
      .prepare(`SELECT Id, WarningAt FROM StocktakeLine WHERE StocktakeId = ? AND TRIM(Barcode) = ? LIMIT 1`)
      .get(params.stocktakeId, bc) as { Id: number; WarningAt: number | null } | undefined;

    let savedId: number;
    if (existing) {
      const nextWarning = params.hasWarningAt ? params.warningAt : existing.WarningAt;
      this.sandbox.db
        .prepare(`
          UPDATE StocktakeLine
          SET Nazov = ?, SystemQty = ?, CountedQty = ?, Variance = ?, WarningAt = ?, Notes = ?
          WHERE Id = ?
        `)
        .run(params.nazov, params.systemQty, params.countedQty, params.variance, nextWarning, params.notes, existing.Id);
      savedId = existing.Id;
    } else {
      const res = this.sandbox.db
        .prepare(`
          INSERT INTO StocktakeLine (StocktakeId, Barcode, Nazov, SystemQty, CountedQty, Variance, WarningAt, Notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          params.stocktakeId,
          bc,
          params.nazov,
          params.systemQty,
          params.countedQty,
          params.variance,
          params.hasWarningAt ? params.warningAt : null,
          params.notes
        );
      savedId = Number(res.lastInsertRowid);
    }

    // Immediate write-back to g1
    if (params.hasWarningAt && params.warningAt !== null) {
      this.sandbox.db
        .prepare(`UPDATE g1 SET Surplus = ?, WarningAt = ? WHERE TRIM(Barcode) = ?`)
        .run(params.countedQty, params.warningAt, bc);
    } else {
      this.sandbox.db
        .prepare(`UPDATE g1 SET Surplus = ? WHERE TRIM(Barcode) = ?`)
        .run(params.countedQty, bc);
    }

    const row = this.sandbox.db.prepare(`SELECT * FROM StocktakeLine WHERE Id = ?`).get(savedId);
    return normalizeLine(row);
  }

  async submitStocktake(id: number): Promise<StocktakeHead> {
    const now = new Date().toISOString();
    this.sandbox.db
      .prepare(`UPDATE Stocktake SET Status = 'submitted', SyncedToG1 = ? WHERE Id = ?`)
      .run(now, id);
    const row = this.sandbox.db.prepare(`SELECT * FROM Stocktake WHERE Id = ?`).get(id);
    if (!row) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    return normalizeHead(row);
  }

  async deleteStocktake(id: number): Promise<boolean> {
    this.sandbox.db.exec('BEGIN');
    try {
      this.sandbox.db.prepare(`DELETE FROM StocktakeLine WHERE StocktakeId = ?`).run(id);
      const res = this.sandbox.db.prepare(`DELETE FROM Stocktake WHERE Id = ?`).run(id);
      this.sandbox.db.exec('COMMIT');
      return Number(res.changes) > 0;
    } catch (err) {
      this.sandbox.db.exec('ROLLBACK');
      throw err;
    }
  }
}
