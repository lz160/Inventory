import sql from 'mssql';
import { getMssqlPool } from '../../core/db/pool';
import { SqliteSandbox } from '../../core/db/sqliteSandbox';
import { conflictError, notFoundError } from '../../core/http/envelope';
import {
  G1_BIT_FIELDS,
  G1_COLUMNS,
  G1_FLOAT_FIELDS,
  G1_INT_FIELDS,
  G1_MONEY_FIELDS,
  G1_NUMERIC_FIELDS,
  G1_REAL_FIELDS,
  G1_SMALLINT_FIELDS,
  G1Product,
  LowStockRow,
  ProductListQuery,
  StockStatus,
} from './types';
import { validateSort } from './validators';

export interface InventoryRepository {
  listProducts(
    query: ProductListQuery,
    page: number,
    pageSize: number
  ): Promise<{ rows: G1Product[]; total: number }>;
  getProductByBarcode(barcode: string): Promise<G1Product | null>;
  createProduct(product: G1Product, changedBy: string): Promise<G1Product>;
  updateProduct(
    barcode: string,
    patch: Record<string, any>,
    changedBy: string
  ): Promise<{ before: G1Product; after: G1Product }>;
  deleteProduct(barcode: string): Promise<boolean>;
  listSuppliers(): Promise<string[]>;
  listLowStock(): Promise<{ rows: LowStockRow[]; total: number }>;
  getAllMatchingForExport(query: ProductListQuery): Promise<G1Product[]>;
}

const G1_SELECT_COLS = G1_COLUMNS.join(', ');

function buildStockConditionSql(stock?: StockStatus | ''): string | null {
  if (stock === 'out') {
    return '(Surplus IS NULL OR Surplus <= 0)';
  }
  if (stock === 'low') {
    return '(WarningAt > 0 AND Surplus IS NOT NULL AND Surplus <= WarningAt AND Surplus > 0)';
  }
  if (stock === 'in') {
    return '(Surplus > 0 AND NOT (WarningAt > 0 AND Surplus <= WarningAt))';
  }
  return null;
}

function normalizeProductRow(raw: any): G1Product {
  return {
    Nazov: String(raw.Nazov ?? ''),
    Cena: Number(raw.Cena ?? 0) || 0,
    PovCena: Number(raw.PovCena ?? 0) || 0,
    Barcode: String(raw.Barcode ?? '').trim(),
    Mnozstvo: Number(raw.Mnozstvo ?? 0) || 0,
    Kod: String(raw.Kod ?? ''),
    Element: String(raw.Element ?? ''),
    Class: String(raw.Class ?? ''),
    Reserved: raw.Reserved ? 1 : 0,
    Surplus: raw.Surplus === null || raw.Surplus === undefined ? null : Number(raw.Surplus),
    VIPnoDiscount: raw.VIPnoDiscount ? 1 : 0,
    barcode2nd: String(raw.barcode2nd ?? ''),
    conv2ndtobarcode: Number(raw.conv2ndtobarcode ?? 0) || 0,
    barcodeType: Number(raw.barcodeType ?? 0) || 0,
    DPHtype: Number(raw.DPHtype ?? 1) || 1,
    PurchasePrice: Number(raw.PurchasePrice ?? 0) || 0,
    Dozen: Number(raw.Dozen ?? 0) || 0,
    Box: Number(raw.Box ?? 0) || 0,
    menupackage: String(raw.menupackage ?? ''),
    Picture: String(raw.Picture ?? ''),
    Cena2: Number(raw.Cena2 ?? 0) || 0,
    WarningAt: Number(raw.WarningAt ?? 0) || 0,
    MoreSurplus: String(raw.MoreSurplus ?? ''),
    ExpiryDate: raw.ExpiryDate === null || raw.ExpiryDate === undefined ? null : String(raw.ExpiryDate),
    PurchaseCountry: String(raw.PurchaseCountry ?? ''),
    Supplier: String(raw.Supplier ?? ''),
    Companions: String(raw.Companions ?? ''),
    NotNewForCloud: raw.NotNewForCloud ? 1 : 0,
    IsUpdateCloud: raw.IsUpdateCloud ? 1 : 0,
    InstallDate: raw.InstallDate instanceof Date ? raw.InstallDate.toISOString() : String(raw.InstallDate ?? ''),
    Shelves: raw.Shelves === null || raw.Shelves === undefined ? null : Number(raw.Shelves),
    LastInstallQty: Number(raw.LastInstallQty ?? 0) || 0,
  };
}

function bindMssqlField(request: sql.Request, paramName: string, col: string, value: any) {
  if (col === 'Barcode' || col === 'barcode2nd') {
    request.input(paramName, sql.VarChar(13), value ?? '');
  } else if (col === 'Class') {
    request.input(paramName, sql.VarChar(5), value ?? '');
  } else if (col === 'Element') {
    request.input(paramName, sql.NVarChar(sql.MAX), value ?? '');
  } else if (col === 'MoreSurplus') {
    request.input(paramName, sql.NVarChar(2000), value ?? '');
  } else if (col === 'ExpiryDate') {
    request.input(paramName, sql.NVarChar(510), value === null || value === undefined ? null : String(value));
  } else if (col === 'InstallDate') {
    request.input(paramName, sql.DateTime, value ? new Date(value) : new Date());
  } else if (G1_MONEY_FIELDS.has(col)) {
    request.input(paramName, sql.Money, Number(value ?? 0));
  } else if (G1_REAL_FIELDS.has(col)) {
    request.input(paramName, sql.Real, value === null || value === undefined ? null : Number(value));
  } else if (G1_SMALLINT_FIELDS.has(col)) {
    request.input(paramName, sql.SmallInt, Math.round(Number(value ?? 0)));
  } else if (G1_INT_FIELDS.has(col)) {
    request.input(paramName, sql.Int, Math.round(Number(value ?? 0)));
  } else if (G1_FLOAT_FIELDS.has(col)) {
    request.input(paramName, sql.Float, value === null || value === undefined ? null : Number(value));
  } else if (G1_BIT_FIELDS.has(col)) {
    request.input(paramName, sql.Bit, value ? 1 : 0);
  } else {
    request.input(paramName, sql.NVarChar(510), String(value ?? ''));
  }
}

function applyMssqlWhere(
  request: sql.Request,
  query: ProductListQuery
): string {
  const clauses: string[] = [];
  if (query.barcode && query.barcode.trim()) {
    clauses.push('TRIM(Barcode) = @f_barcode');
    request.input('f_barcode', sql.VarChar(13), query.barcode.trim());
  }
  if (query.kod && query.kod.trim()) {
    clauses.push('Kod LIKE @f_kod');
    request.input('f_kod', sql.NVarChar(512), `%${query.kod.trim()}%`);
  }
  if (query.q && query.q.trim()) {
    clauses.push('(TRIM(Barcode) LIKE @f_q OR Kod LIKE @f_q OR Nazov LIKE @f_q OR Supplier LIKE @f_q)');
    request.input('f_q', sql.NVarChar(512), `%${query.q.trim()}%`);
  }
  if (query.supplier && query.supplier.trim()) {
    clauses.push('TRIM(Supplier) = @f_supplier');
    request.input('f_supplier', sql.NVarChar(510), query.supplier.trim());
  }
  const stockSql = buildStockConditionSql(query.stock);
  if (stockSql) {
    clauses.push(stockSql);
  }
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

export class MssqlInventoryRepository implements InventoryRepository {
  private async tryInsertPriceHistory(
    entries: Array<{
      Barcode: string;
      Nazov: string;
      Field: 'Cena' | 'Cena2';
      OldValue: number | null;
      NewValue: number;
      ChangedBy: string;
    }>
  ) {
    if (entries.length === 0) return;
    try {
      const pool = await getMssqlPool('saledata');
      for (const e of entries) {
        const req = pool.request();
        req.input('Barcode', sql.VarChar(13), e.Barcode);
        req.input('Nazov', sql.NVarChar(510), e.Nazov);
        req.input('Field', sql.NVarChar(10), e.Field);
        req.input('OldValue', sql.Money, e.OldValue);
        req.input('NewValue', sql.Money, e.NewValue);
        req.input('ChangedBy', sql.NVarChar(100), e.ChangedBy);
        req.input('Source', sql.NVarChar(10), 'ims');
        await req.query(`
          INSERT INTO dbo.PriceHistory (Barcode, Nazov, Field, OldValue, NewValue, ChangedBy, Source)
          VALUES (@Barcode, @Nazov, @Field, @OldValue, @NewValue, @ChangedBy, @Source)
        `);
      }
    } catch (err: any) {
      // B-29 / §4.1.2: PriceHistory write failure must never block main flow
      console.warn(`[PriceHistory] Non-blocking insert warning: ${err?.message || err}`);
    }
  }

  async listProducts(query: ProductListQuery, page: number, pageSize: number) {
    const pool = await getMssqlPool('sklad');
    const sort = validateSort(query.sortBy, query.sortDir);
    const offset = (page - 1) * pageSize;

    const countReq = pool.request();
    const whereSql = applyMssqlWhere(countReq, query);
    const countRes = await countReq.query(`SELECT COUNT(*) AS total FROM dbo.g1 ${whereSql}`);
    const total = Number(countRes.recordset[0]?.total ?? 0);

    const dataReq = pool.request();
    applyMssqlWhere(dataReq, query);
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const orderBy =
      sort.column === 'Barcode'
        ? `Barcode ${sort.direction}`
        : `${sort.column} ${sort.direction}, Barcode ASC`;

    const dataRes = await dataReq.query(`
      SELECT ${G1_SELECT_COLS}
      FROM dbo.g1
      ${whereSql}
      ORDER BY ${orderBy}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return {
      rows: dataRes.recordset.map(normalizeProductRow),
      total,
    };
  }

  async getProductByBarcode(barcode: string): Promise<G1Product | null> {
    const pool = await getMssqlPool('sklad');
    const req = pool.request();
    req.input('bc', sql.VarChar(13), barcode.trim());
    const res = await req.query(`
      SELECT TOP (1) ${G1_SELECT_COLS}
      FROM dbo.g1
      WHERE TRIM(Barcode) = @bc
    `);
    if (res.recordset.length === 0) return null;
    return normalizeProductRow(res.recordset[0]);
  }

  async createProduct(product: G1Product, changedBy: string): Promise<G1Product> {
    const pool = await getMssqlPool('sklad');
    const dupReq = pool.request();
    dupReq.input('bc', sql.VarChar(13), product.Barcode.trim());
    const dupRes = await dupReq.query(`SELECT COUNT(*) AS cnt FROM dbo.g1 WHERE TRIM(Barcode) = @bc`);
    if (Number(dupRes.recordset[0]?.cnt ?? 0) > 0) {
      throw conflictError(`条码 ${product.Barcode.trim()} 已存在，新建被拒绝（不覆盖已有行）`);
    }

    const insertReq = pool.request();
    const paramNames = G1_COLUMNS.map((col, idx) => {
      const pName = `p_${idx}`;
      bindMssqlField(insertReq, pName, col, (product as any)[col]);
      return `@${pName}`;
    });

    await insertReq.query(`
      INSERT INTO dbo.g1 (${G1_COLUMNS.join(', ')})
      VALUES (${paramNames.join(', ')})
    `);

    // Price baselines (non-blocking)
    await this.tryInsertPriceHistory([
      {
        Barcode: product.Barcode.trim(),
        Nazov: product.Nazov,
        Field: 'Cena',
        OldValue: null,
        NewValue: Number(product.Cena ?? 0),
        ChangedBy: changedBy,
      },
      {
        Barcode: product.Barcode.trim(),
        Nazov: product.Nazov,
        Field: 'Cena2',
        OldValue: null,
        NewValue: Number(product.Cena2 ?? 0),
        ChangedBy: changedBy,
      },
    ]);

    const created = await this.getProductByBarcode(product.Barcode.trim());
    return created || product;
  }

  async updateProduct(barcode: string, patch: Record<string, any>, changedBy: string) {
    const bc = barcode.trim();
    const before = await this.getProductByBarcode(bc);
    if (!before) {
      throw notFoundError(`条码 ${bc} 的商品不存在`);
    }

    const pool = await getMssqlPool('sklad');
    const req = pool.request();
    req.input('bc', sql.VarChar(13), bc);

    const sets: string[] = [];
    let idx = 0;
    for (const [col, val] of Object.entries(patch)) {
      const pName = `u_${idx++}`;
      sets.push(`${col} = @${pName}`);
      bindMssqlField(req, pName, col, val);
    }

    await req.query(`
      UPDATE dbo.g1
      SET ${sets.join(', ')}
      WHERE TRIM(Barcode) = @bc
    `);

    const after = (await this.getProductByBarcode(bc)) || before;

    const historyEntries: Array<{
      Barcode: string;
      Nazov: string;
      Field: 'Cena' | 'Cena2';
      OldValue: number | null;
      NewValue: number;
      ChangedBy: string;
    }> = [];

    if (patch.Cena !== undefined && Number(before.Cena) !== Number(after.Cena)) {
      historyEntries.push({
        Barcode: bc,
        Nazov: after.Nazov,
        Field: 'Cena',
        OldValue: Number(before.Cena),
        NewValue: Number(after.Cena),
        ChangedBy: changedBy,
      });
    }
    if (patch.Cena2 !== undefined && Number(before.Cena2) !== Number(after.Cena2)) {
      historyEntries.push({
        Barcode: bc,
        Nazov: after.Nazov,
        Field: 'Cena2',
        OldValue: Number(before.Cena2),
        NewValue: Number(after.Cena2),
        ChangedBy: changedBy,
      });
    }
    await this.tryInsertPriceHistory(historyEntries);

    return { before, after };
  }

  async deleteProduct(barcode: string): Promise<boolean> {
    const pool = await getMssqlPool('sklad');
    const req = pool.request();
    req.input('bc', sql.VarChar(13), barcode.trim());
    const res = await req.query(`DELETE FROM dbo.g1 WHERE TRIM(Barcode) = @bc`);
    return Number(res.rowsAffected[0] ?? 0) > 0;
  }

  async listSuppliers(): Promise<string[]> {
    const pool = await getMssqlPool('sklad');
    const res = await pool.request().query(`
      SELECT DISTINCT TOP (300) TRIM(Supplier) AS supplier
      FROM dbo.g1
      WHERE Supplier IS NOT NULL AND TRIM(Supplier) <> ''
      ORDER BY supplier ASC
    `);
    return res.recordset.map((r) => String(r.supplier).trim()).filter(Boolean);
  }

  async listLowStock(): Promise<{ rows: LowStockRow[]; total: number }> {
    const pool = await getMssqlPool('sklad');
    const res = await pool.request().query(`
      SELECT ${G1_SELECT_COLS}, (WarningAt - COALESCE(Surplus, 0)) AS Gap
      FROM dbo.g1
      WHERE WarningAt > 0 AND COALESCE(Surplus, 0) <= WarningAt
      ORDER BY (WarningAt - COALESCE(Surplus, 0)) DESC, Barcode ASC
    `);
    const rows: LowStockRow[] = res.recordset.map((r) => ({
      ...normalizeProductRow(r),
      Gap: Number(r.Gap ?? 0),
    }));
    return { rows, total: rows.length };
  }

  async getAllMatchingForExport(query: ProductListQuery): Promise<G1Product[]> {
    const pool = await getMssqlPool('sklad');
    const sort = validateSort(query.sortBy, query.sortDir);
    const req = pool.request();
    const whereSql = applyMssqlWhere(req, query);
    const orderBy =
      sort.column === 'Barcode'
        ? `Barcode ${sort.direction}`
        : `${sort.column} ${sort.direction}, Barcode ASC`;

    const res = await req.query(`
      SELECT TOP (50000) ${G1_SELECT_COLS}
      FROM dbo.g1
      ${whereSql}
      ORDER BY ${orderBy}
    `);
    return res.recordset.map(normalizeProductRow);
  }
}

function applySqliteWhere(query: ProductListQuery): { whereSql: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (query.barcode && query.barcode.trim()) {
    clauses.push('TRIM(Barcode) = ?');
    params.push(query.barcode.trim());
  }
  if (query.kod && query.kod.trim()) {
    clauses.push('Kod LIKE ?');
    params.push(`%${query.kod.trim()}%`);
  }
  if (query.q && query.q.trim()) {
    const pattern = `%${query.q.trim()}%`;
    clauses.push('(TRIM(Barcode) LIKE ? OR Kod LIKE ? OR Nazov LIKE ? OR Supplier LIKE ?)');
    params.push(pattern, pattern, pattern, pattern);
  }
  if (query.supplier && query.supplier.trim()) {
    clauses.push('TRIM(Supplier) = ?');
    params.push(query.supplier.trim());
  }
  const stockSql = buildStockConditionSql(query.stock);
  if (stockSql) {
    clauses.push(stockSql);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private sandbox: SqliteSandbox) {}

  private tryInsertPriceHistory(
    entries: Array<{
      Barcode: string;
      Nazov: string;
      Field: 'Cena' | 'Cena2';
      OldValue: number | null;
      NewValue: number;
      ChangedBy: string;
    }>
  ) {
    if (entries.length === 0) return;
    try {
      const stmt = this.sandbox.db.prepare(`
        INSERT INTO PriceHistory (Barcode, Nazov, Field, OldValue, NewValue, ChangedBy, ChangedAt, Source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ims')
      `);
      const now = new Date().toISOString();
      for (const e of entries) {
        stmt.run(e.Barcode, e.Nazov, e.Field, e.OldValue, e.NewValue, e.ChangedBy, now);
      }
    } catch (err: any) {
      console.warn(`[PriceHistory] Non-blocking insert warning: ${err?.message || err}`);
    }
  }

  async listProducts(query: ProductListQuery, page: number, pageSize: number) {
    const sort = validateSort(query.sortBy, query.sortDir);
    const { whereSql, params } = applySqliteWhere(query);

    const countRow = this.sandbox.db
      .prepare(`SELECT COUNT(*) AS total FROM g1 ${whereSql}`)
      .get(...params) as { total: number };

    const orderBy =
      sort.column === 'Barcode'
        ? `Barcode ${sort.direction}`
        : `${sort.column} ${sort.direction}, Barcode ASC`;

    const offset = (page - 1) * pageSize;
    const rows = this.sandbox.db
      .prepare(`
        SELECT ${G1_SELECT_COLS}
        FROM g1
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `)
      .all(...params, pageSize, offset);

    return {
      rows: rows.map(normalizeProductRow),
      total: Number(countRow?.total ?? 0),
    };
  }

  async getProductByBarcode(barcode: string): Promise<G1Product | null> {
    const row = this.sandbox.db
      .prepare(`SELECT ${G1_SELECT_COLS} FROM g1 WHERE TRIM(Barcode) = ? LIMIT 1`)
      .get(barcode.trim());
    return row ? normalizeProductRow(row) : null;
  }

  async createProduct(product: G1Product, changedBy: string): Promise<G1Product> {
    const bc = product.Barcode.trim();
    const dup = this.sandbox.db
      .prepare(`SELECT COUNT(*) AS cnt FROM g1 WHERE TRIM(Barcode) = ?`)
      .get(bc) as { cnt: number };
    if (dup.cnt > 0) {
      throw conflictError(`条码 ${bc} 已存在，新建被拒绝（不覆盖已有行）`);
    }

    const placeholders = G1_COLUMNS.map(() => '?').join(', ');
    const values = G1_COLUMNS.map((col) => (product as any)[col]);
    this.sandbox.db
      .prepare(`INSERT INTO g1 (${G1_COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .run(...values);

    this.tryInsertPriceHistory([
      { Barcode: bc, Nazov: product.Nazov, Field: 'Cena', OldValue: null, NewValue: Number(product.Cena), ChangedBy: changedBy },
      { Barcode: bc, Nazov: product.Nazov, Field: 'Cena2', OldValue: null, NewValue: Number(product.Cena2), ChangedBy: changedBy },
    ]);

    return (await this.getProductByBarcode(bc)) || product;
  }

  async updateProduct(barcode: string, patch: Record<string, any>, changedBy: string) {
    const bc = barcode.trim();
    const before = await this.getProductByBarcode(bc);
    if (!before) {
      throw notFoundError(`条码 ${bc} 的商品不存在`);
    }

    const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
    const values = Object.values(patch);
    this.sandbox.db.prepare(`UPDATE g1 SET ${sets} WHERE TRIM(Barcode) = ?`).run(...values, bc);

    const after = (await this.getProductByBarcode(bc)) || before;
    const history: Array<{
      Barcode: string;
      Nazov: string;
      Field: 'Cena' | 'Cena2';
      OldValue: number | null;
      NewValue: number;
      ChangedBy: string;
    }> = [];
    if (patch.Cena !== undefined && Number(before.Cena) !== Number(after.Cena)) {
      history.push({ Barcode: bc, Nazov: after.Nazov, Field: 'Cena', OldValue: Number(before.Cena), NewValue: Number(after.Cena), ChangedBy: changedBy });
    }
    if (patch.Cena2 !== undefined && Number(before.Cena2) !== Number(after.Cena2)) {
      history.push({ Barcode: bc, Nazov: after.Nazov, Field: 'Cena2', OldValue: Number(before.Cena2), NewValue: Number(after.Cena2), ChangedBy: changedBy });
    }
    this.tryInsertPriceHistory(history);

    return { before, after };
  }

  async deleteProduct(barcode: string): Promise<boolean> {
    const res = this.sandbox.db.prepare(`DELETE FROM g1 WHERE TRIM(Barcode) = ?`).run(barcode.trim());
    return Number(res.changes) > 0;
  }

  async listSuppliers(): Promise<string[]> {
    const rows = this.sandbox.db
      .prepare(`
        SELECT DISTINCT TRIM(Supplier) AS supplier
        FROM g1
        WHERE Supplier IS NOT NULL AND TRIM(Supplier) <> ''
        ORDER BY supplier ASC
        LIMIT 300
      `)
      .all() as Array<{ supplier: string }>;
    return rows.map((r) => r.supplier.trim()).filter(Boolean);
  }

  async listLowStock(): Promise<{ rows: LowStockRow[]; total: number }> {
    const rows = this.sandbox.db
      .prepare(`
        SELECT ${G1_SELECT_COLS}, (WarningAt - COALESCE(Surplus, 0)) AS Gap
        FROM g1
        WHERE WarningAt > 0 AND COALESCE(Surplus, 0) <= WarningAt
        ORDER BY (WarningAt - COALESCE(Surplus, 0)) DESC, Barcode ASC
      `)
      .all();
    const mapped: LowStockRow[] = rows.map((r: any) => ({
      ...normalizeProductRow(r),
      Gap: Number(r.Gap ?? 0),
    }));
    return { rows: mapped, total: mapped.length };
  }

  async getAllMatchingForExport(query: ProductListQuery): Promise<G1Product[]> {
    const sort = validateSort(query.sortBy, query.sortDir);
    const { whereSql, params } = applySqliteWhere(query);
    const orderBy =
      sort.column === 'Barcode'
        ? `Barcode ${sort.direction}`
        : `${sort.column} ${sort.direction}, Barcode ASC`;
    const rows = this.sandbox.db
      .prepare(`SELECT ${G1_SELECT_COLS} FROM g1 ${whereSql} ORDER BY ${orderBy} LIMIT 50000`)
      .all(...params);
    return rows.map(normalizeProductRow);
  }
}
