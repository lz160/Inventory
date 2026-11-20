import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { CATEGORY_DICTIONARY, CategoryDef } from '../../modules/sales/category-rules';

export interface ProductMetaRow {
  barcode: string;
  category: string | null;
  name_zh: string | null;
  updated_by: string;
  updated_at: string;
}

export type DbOverrideTarget = 'sklad' | 'saledata';

export interface DbOverrideRow {
  target: DbOverrideTarget;
  server: string;
  port: number;
  database_name: string;
  username: string;
  password: string;
  encrypt: boolean;
  trust_server_certificate: boolean;
  updated_at: string;
}

export class MetaStore {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath || process.env.IMS_META_DB_PATH || path.resolve(process.cwd(), 'data', 'ims_meta.db');
    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        code       TEXT PRIMARY KEY,
        name_sk    TEXT NOT NULL,
        name_zh    TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS product_meta (
        barcode    TEXT PRIMARY KEY,
        category   TEXT NULL REFERENCES categories(code),
        name_zh    TEXT NULL,
        updated_by TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS IX_product_meta_category ON product_meta(category);

      CREATE TABLE IF NOT EXISTS db_connection_overrides (
        target                   TEXT PRIMARY KEY,
        server                   TEXT NOT NULL,
        port                     INTEGER NOT NULL DEFAULT 1433,
        database_name            TEXT NOT NULL,
        username                 TEXT NOT NULL,
        password                 TEXT NOT NULL DEFAULT '',
        encrypt                  INTEGER NOT NULL DEFAULT 0,
        trust_server_certificate INTEGER NOT NULL DEFAULT 1,
        updated_at               TEXT NOT NULL
      );
    `);

    const upsertCat = this.db.prepare(`
      INSERT INTO categories (code, name_sk, name_zh, sort_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name_sk = excluded.name_sk,
        name_zh = excluded.name_zh,
        sort_order = excluded.sort_order
    `);

    this.db.exec('BEGIN');
    try {
      for (const cat of CATEGORY_DICTIONARY) {
        upsertCat.run(cat.code, cat.name_sk, cat.name_zh, cat.sort_order);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listCategories(): CategoryDef[] {
    const rows = this.db
      .prepare(`SELECT code, name_sk, name_zh, sort_order FROM categories ORDER BY sort_order ASC, code ASC`)
      .all() as unknown as CategoryDef[];
    return rows;
  }

  getAllProductMetaMap(): Map<string, ProductMetaRow> {
    const rows = this.db
      .prepare(`SELECT barcode, category, name_zh, updated_by, updated_at FROM product_meta`)
      .all() as unknown as ProductMetaRow[];
    const map = new Map<string, ProductMetaRow>();
    for (const r of rows) {
      map.set(r.barcode.trim(), r);
    }
    return map;
  }

  getProductMeta(barcode: string): ProductMetaRow | null {
    const bc = barcode.trim();
    const row = this.db
      .prepare(`SELECT barcode, category, name_zh, updated_by, updated_at FROM product_meta WHERE barcode = ?`)
      .get(bc) as unknown as ProductMetaRow | undefined;
    return row || null;
  }

  upsertProductMeta(barcode: string, category: string | null, nameZh: string | null, updatedBy: string): ProductMetaRow {
    const bc = barcode.trim();
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO product_meta (barcode, category, name_zh, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(barcode) DO UPDATE SET
          category = excluded.category,
          name_zh = COALESCE(excluded.name_zh, product_meta.name_zh),
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `)
      .run(bc, category, nameZh, updatedBy, now);
    return { barcode: bc, category, name_zh: nameZh, updated_by: updatedBy, updated_at: now };
  }

  deleteProductMeta(barcode: string): void {
    const bc = barcode.trim();
    this.db.prepare(`DELETE FROM product_meta WHERE barcode = ?`).run(bc);
  }

  /**
   * Single-transaction batch category assignment (§7.4 & §7.6 idempotent).
   * If any item fails validation/FK constraint, rolls back the whole batch.
   */
  batchUpsertCategories(
    items: Array<{ barcode: string; category: string }>,
    updatedBy: string
  ): number {
    const now = new Date().toISOString();
    const validCategories = new Set(this.listCategories().map((c) => c.code));

    for (const it of items) {
      if (!it.barcode || !it.barcode.trim()) {
        throw new Error('条码不能为空');
      }
      if (!validCategories.has(it.category)) {
        throw new Error(`无效的品类编码: ${it.category}`);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO product_meta (barcode, category, name_zh, updated_by, updated_at)
      VALUES (?, ?, NULL, ?, ?)
      ON CONFLICT(barcode) DO UPDATE SET
        category = excluded.category,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `);

    this.db.exec('BEGIN');
    try {
      let applied = 0;
      for (const it of items) {
        stmt.run(it.barcode.trim(), it.category, updatedBy, now);
        applied += 1;
      }
      this.db.exec('COMMIT');
      return applied;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getDbOverride(target: DbOverrideTarget): DbOverrideRow | null {
    const row = this.db
      .prepare(
        `SELECT target, server, port, database_name, username, password, encrypt, trust_server_certificate, updated_at
         FROM db_connection_overrides WHERE target = ?`
      )
      .get(target) as any;
    if (!row) return null;
    return {
      target: row.target as DbOverrideTarget,
      server: String(row.server ?? ''),
      port: Number(row.port ?? 1433),
      database_name: String(row.database_name ?? ''),
      username: String(row.username ?? ''),
      password: String(row.password ?? ''),
      encrypt: Boolean(row.encrypt),
      trust_server_certificate: Boolean(row.trust_server_certificate),
      updated_at: String(row.updated_at ?? ''),
    };
  }

  getAllDbOverrides(): { sklad: DbOverrideRow | null; saledata: DbOverrideRow | null } {
    return {
      sklad: this.getDbOverride('sklad'),
      saledata: this.getDbOverride('saledata'),
    };
  }

  upsertDbOverride(
    target: DbOverrideTarget,
    input: {
      server: string;
      port: number;
      database_name: string;
      username: string;
      password: string;
      encrypt: boolean;
      trust_server_certificate: boolean;
    }
  ): DbOverrideRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO db_connection_overrides
           (target, server, port, database_name, username, password, encrypt, trust_server_certificate, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(target) DO UPDATE SET
           server = excluded.server,
           port = excluded.port,
           database_name = excluded.database_name,
           username = excluded.username,
           password = excluded.password,
           encrypt = excluded.encrypt,
           trust_server_certificate = excluded.trust_server_certificate,
           updated_at = excluded.updated_at`
      )
      .run(
        target,
        input.server,
        input.port,
        input.database_name,
        input.username,
        input.password,
        input.encrypt ? 1 : 0,
        input.trust_server_certificate ? 1 : 0,
        now
      );
    return {
      target,
      ...input,
      updated_at: now,
    };
  }

  clearAllDbOverrides(): void {
    this.db.prepare(`DELETE FROM db_connection_overrides`).run();
  }

  close() {
    this.db.close();
  }
}

let defaultMetaStore: MetaStore | null = null;
export function getMetaStore(): MetaStore {
  if (!defaultMetaStore) {
    defaultMetaStore = new MetaStore();
  }
  return defaultMetaStore;
}
