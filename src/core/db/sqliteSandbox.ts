import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite Sandbox Adapter for Automated E2E Tests and explicit IMS_DB_MODE=sqlite-seed demo mode.
 * NOTE: Never used as silent fallback when default MSSQL mode is unreachable (B-30 / Q12).
 */
export class SqliteSandbox {
  public readonly db: DatabaseSync;

  constructor(dbPath = ':memory:', seed = true) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    if (seed) {
      this.seedIfEmpty();
    }
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS g1 (
        Nazov TEXT NOT NULL DEFAULT '',
        Cena REAL NOT NULL DEFAULT 0,
        PovCena REAL NOT NULL DEFAULT 0,
        Barcode TEXT PRIMARY KEY,
        Mnozstvo REAL NOT NULL DEFAULT 0,
        Kod TEXT NOT NULL DEFAULT '',
        Element TEXT NOT NULL DEFAULT '',
        Class TEXT NOT NULL DEFAULT '',
        Reserved INTEGER NOT NULL DEFAULT 0,
        Surplus REAL NULL DEFAULT 0,
        VIPnoDiscount INTEGER NOT NULL DEFAULT 0,
        barcode2nd TEXT NOT NULL DEFAULT '',
        conv2ndtobarcode INTEGER NOT NULL DEFAULT 0,
        barcodeType INTEGER NOT NULL DEFAULT 0,
        DPHtype INTEGER NOT NULL DEFAULT 1,
        PurchasePrice REAL NOT NULL DEFAULT 0,
        Dozen INTEGER NOT NULL DEFAULT 0,
        Box INTEGER NOT NULL DEFAULT 0,
        menupackage TEXT NOT NULL DEFAULT '',
        Picture TEXT NOT NULL DEFAULT '',
        Cena2 REAL NOT NULL DEFAULT 0,
        WarningAt INTEGER NOT NULL DEFAULT 0,
        MoreSurplus TEXT NOT NULL DEFAULT '',
        ExpiryDate TEXT NULL,
        PurchaseCountry TEXT NOT NULL DEFAULT '',
        Supplier TEXT NOT NULL DEFAULT '',
        Companions TEXT NOT NULL DEFAULT '',
        NotNewForCloud INTEGER NOT NULL DEFAULT 1,
        IsUpdateCloud INTEGER NOT NULL DEFAULT 0,
        InstallDate TEXT NOT NULL,
        Shelves REAL NULL,
        LastInstallQty REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS PriceHistory (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Barcode TEXT NOT NULL,
        Nazov TEXT NULL,
        Field TEXT NOT NULL,
        OldValue REAL NULL,
        NewValue REAL NULL,
        ChangedBy TEXT NOT NULL,
        ChangedAt TEXT NOT NULL,
        Source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS SalesLog (
        LogId INTEGER PRIMARY KEY AUTOINCREMENT,
        ChangeTime TEXT NOT NULL,
        AppName TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS SalesLogDetail (
        DetailId INTEGER PRIMARY KEY AUTOINCREMENT,
        LogId INTEGER NOT NULL REFERENCES SalesLog(LogId),
        Barcode TEXT NOT NULL,
        Nazov TEXT NULL,
        Delta REAL NOT NULL,
        Cena REAL NOT NULL,
        Supplier TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS Stocktake (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT NOT NULL,
        CountDate TEXT NOT NULL,
        CreatedBy TEXT NOT NULL,
        Status TEXT NOT NULL DEFAULT 'open',
        SyncedToG1 TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS StocktakeLine (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        StocktakeId INTEGER NOT NULL REFERENCES Stocktake(Id),
        Barcode TEXT NOT NULL,
        Nazov TEXT NULL,
        SystemQty REAL NULL,
        CountedQty REAL NULL,
        Variance REAL NULL,
        WarningAt REAL NULL,
        Notes TEXT NULL
      );
    `);
  }

  private seedIfEmpty() {
    const countRow = this.db.prepare(`SELECT COUNT(*) AS cnt FROM g1`).get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const now = new Date();
    const fmtDateTimeLocal = (daysAgo: number, hh = 12, mm = 0, ss = 0) => {
      const d = new Date(now.getTime() - daysAgo * 86400_000);
      // Use ISO UTC representations aligned around Europe/Bratislava local testing windows
      // For relative sandbox seeding we anchor recent dates cleanly in UTC equivalent
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${y}-${m}-${day}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000Z`;
    };

    const insertG1 = this.db.prepare(`
      INSERT INTO g1 (
        Nazov, Cena, PovCena, Barcode, Mnozstvo, Kod, Element, Class, Reserved, Surplus,
        VIPnoDiscount, barcode2nd, conv2ndtobarcode, barcodeType, DPHtype, PurchasePrice,
        Dozen, Box, menupackage, Picture, Cena2, WarningAt, MoreSurplus, ExpiryDate,
        PurchaseCountry, Supplier, Companions, NotNewForCloud, IsUpdateCloud, InstallDate,
        Shelves, LastInstallQty
      ) VALUES (?, ?, 0, ?, 0, ?, '', '', 0, ?, 0, '', 0, 0, 1, 0, 0, 0, '', '', ?, ?, '', NULL, '', ?, '', 1, 0, ?, NULL, 0)
    `);

    const seedProducts: Array<[string, number, string, string, number | null, number, number, string]> = [
      ['甲商品 正常', 12.30, '1000000000001', 'K-001', 50, 8.00, 10, 'SupplierA'],
      ['乙商品 低库存', 12.30, '1000000000002', 'K-002', 5, 8.00, 10, 'SupplierA'],
      ['丙商品 缺货', 3.00, '1000000000003', 'K-003', 0, 1.00, 0, 'SupplierB'],
      ['丁商品 负库存', 5.00, '1000000000004', 'K-004', -3, 2.00, 5, 'SupplierB'],
      ['戊商品 无价', 0, '1000000000005', 'K-005', 20, 0, 0, 'SupplierA'],
      ['己商品 带空格条码', 1.00, ' 1000000000006 ', 'K-006', 1, 0, 0, 'SupplierC'],
      ['Dámske tričko bavlna', 19.90, '1000000000007', 'K-007', 15, 8.50, 3, 'FashionSK'],
      ['Pánske nohavice slim', 29.90, '1000000000008', 'K-008', 8, 12.00, 4, 'FashionSK'],
      ['Detská bunda zimná', 39.90, '1000000000009', 'K-009', 12, 18.00, 2, 'KidsWear'],
      ['NULL库存历史商品', 4.50, '1000000000010', 'K-010', null, 2.00, 0, 'SupplierC'],
      ['Kuchynský nôž nerezový extra dlhý názov produktu pre testovanie zobrazenia v tabuľke skladu', 14.90, '1000000000011', 'K-011', 25, 6.00, 5, 'HomeGoods'],
      ['Slow Moving Ceramic Mug', 6.50, '1000000000012', 'K-012', 40, 2.50, 5, 'HomeGoods'],
    ];

    const installNow = new Date().toISOString();
    const insertLog = this.db.prepare(`INSERT INTO SalesLog (ChangeTime, AppName) VALUES (?, ?)`);
    const insertDetail = this.db.prepare(
      `INSERT INTO SalesLogDetail (LogId, Barcode, Nazov, Delta, Cena, Supplier) VALUES (?, ?, ?, ?, ?, ?)`
    );

    this.db.exec('BEGIN');
    try {
      for (const p of seedProducts) {
        insertG1.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], installNow);
      }

      // §10.1 3-day sales logs:
      // D1 (5 days ago): 条码1 Delta=-2 Cena=12.30 POS; 条码1 Delta=+5 Cena=12.30 POS (inbound, ignored)
      const log1 = Number(insertLog.run(fmtDateTimeLocal(5, 10, 15, 0), 'POS').lastInsertRowid);
      insertDetail.run(log1, '1000000000001', '甲商品 正常', -2, 12.30, 'SupplierA');
      insertDetail.run(log1, '1000000000001', '甲商品 正常', 5, 12.30, 'SupplierA');

      // D2 (3 days ago): 条码2 Delta=-10 Cena=0 POS; 条码3 Delta=-1 Cena=3.00 Tedious (excluded)
      const log2 = Number(insertLog.run(fmtDateTimeLocal(3, 14, 30, 0), 'POS').lastInsertRowid);
      insertDetail.run(log2, '1000000000002', '乙商品 低库存', -10, 0, 'SupplierA');
      const log2Tedious = Number(insertLog.run(fmtDateTimeLocal(3, 15, 0, 0), 'Tedious').lastInsertRowid);
      insertDetail.run(log2Tedious, '1000000000003', '丙商品 缺货', -1, 3.00, 'SupplierB');

      // D3 (1 day ago): 条码1 Delta=-3 Cena=12.30 POS
      const log3 = Number(insertLog.run(fmtDateTimeLocal(1, 16, 45, 0), 'POS').lastInsertRowid);
      insertDetail.run(log3, '1000000000001', '甲商品 正常', -3, 12.30, 'SupplierA');

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}

let defaultSandbox: SqliteSandbox | null = null;
export function getSqliteSandbox(): SqliteSandbox {
  if (!defaultSandbox) {
    const dbPath = process.env.IMS_SANDBOX_DB_PATH || path.resolve(process.cwd(), 'data', 'ims_sandbox.db');
    defaultSandbox = new SqliteSandbox(dbPath, true);
  }
  return defaultSandbox;
}
