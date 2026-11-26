import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { CATEGORY_DICTIONARY, CategoryDef } from '../../modules/sales/category-rules';
import {
  PermissionKey,
  UserRole,
  filterAccessibleStores,
  isValidUserRole,
  normalizePermissions,
} from '../auth/permissions';

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

export interface StoreRecord {
  id: number;
  storeCode: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreSessionInfo {
  storeId: number;
  storeCode: string;
  storeName: string;
  expiresAt: string;
}

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: PermissionKey[];
  allStores: boolean;
  assignedStoreIds: number[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSessionInfo {
  user: UserRecord;
  activeStore: StoreRecord | null;
  availableStores: StoreRecord[];
  expiresAt: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashStorePassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyStorePassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) return false;
  const expected = Buffer.from(hexDigest, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
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
    this.db.exec('PRAGMA foreign_keys = ON;');
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

      CREATE TABLE IF NOT EXISTS stores (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        store_code    TEXT NOT NULL UNIQUE,
        store_name    TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS store_sessions (
        token_hash TEXT PRIMARY KEY,
        store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS IX_store_sessions_store_id ON store_sessions(store_id);

      CREATE TABLE IF NOT EXISTS store_db_configs (
        store_id                 INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        target                   TEXT NOT NULL,
        server                   TEXT NOT NULL,
        port                     INTEGER NOT NULL DEFAULT 1433,
        database_name            TEXT NOT NULL,
        username                 TEXT NOT NULL,
        password                 TEXT NOT NULL DEFAULT '',
        encrypt                  INTEGER NOT NULL DEFAULT 0,
        trust_server_certificate INTEGER NOT NULL DEFAULT 1,
        updated_at               TEXT NOT NULL,
        PRIMARY KEY (store_id, target)
      );

      CREATE TABLE IF NOT EXISTS users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        username         TEXT NOT NULL UNIQUE,
        display_name     TEXT NOT NULL,
        password_hash    TEXT NOT NULL,
        role             TEXT NOT NULL DEFAULT 'staff',
        permissions_json TEXT NOT NULL,
        all_stores       INTEGER NOT NULL DEFAULT 0,
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_stores (
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, store_id)
      );

      CREATE INDEX IF NOT EXISTS IX_user_stores_store_id ON user_stores(store_id);

      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash      TEXT PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_store_id INTEGER NULL REFERENCES stores(id) ON DELETE SET NULL,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS IX_user_sessions_user_id ON user_sessions(user_id);
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

  // ===== Multi-Store & Session Management =====

  countStores(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS cnt FROM stores`).get() as any;
    return Number(row?.cnt || 0);
  }

  listStores(): StoreRecord[] {
    const rows = this.db
      .prepare(`SELECT id, store_code, store_name, created_at, updated_at FROM stores ORDER BY id ASC`)
      .all() as any[];
    return rows.map((r) => ({
      id: Number(r.id),
      storeCode: String(r.store_code),
      storeName: String(r.store_name),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  getStoreById(id: number): StoreRecord | null {
    const row = this.db
      .prepare(`SELECT id, store_code, store_name, created_at, updated_at FROM stores WHERE id = ?`)
      .get(id) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      storeCode: String(row.store_code),
      storeName: String(row.store_name),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  getStoreByCode(storeCode: string): StoreRecord | null {
    const code = storeCode.trim().toUpperCase();
    const row = this.db
      .prepare(`SELECT id, store_code, store_name, created_at, updated_at FROM stores WHERE store_code = ?`)
      .get(code) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      storeCode: String(row.store_code),
      storeName: String(row.store_name),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  createStore(input: { storeCode: string; storeName: string; password?: string }): StoreRecord {
    const code = input.storeCode.trim().toUpperCase();
    const name = input.storeName.trim();
    const now = new Date().toISOString();
    const hash = input.password ? hashStorePassword(input.password) : '!account-auth-only';
    const info = this.db
      .prepare(
        `INSERT INTO stores (store_code, store_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(code, name, hash, now, now);

    return {
      id: Number(info.lastInsertRowid),
      storeCode: code,
      storeName: name,
      createdAt: now,
      updatedAt: now,
    };
  }

  migrateLegacyOverridesToStore(storeId: number): void {
    const existing = this.db
      .prepare(`SELECT target, server, port, database_name, username, password, encrypt, trust_server_certificate FROM db_connection_overrides`)
      .all() as any[];
    if (existing.length === 0) return;

    for (const row of existing) {
      const target = row.target as DbOverrideTarget;
      if (target !== 'sklad' && target !== 'saledata') continue;
      if (!this.getDbOverride(target, storeId)) {
        this.upsertDbOverride(
          target,
          {
            server: String(row.server ?? ''),
            port: Number(row.port ?? 1433),
            database_name: String(row.database_name ?? ''),
            username: String(row.username ?? ''),
            password: String(row.password ?? ''),
            encrypt: Boolean(row.encrypt),
            trust_server_certificate: Boolean(row.trust_server_certificate),
          },
          storeId
        );
      }
    }
  }

  cloneStoreDbConfigs(fromStoreId: number, toStoreId: number): void {
    const targets: DbOverrideTarget[] = ['sklad', 'saledata'];
    for (const target of targets) {
      const src = this.getDbOverride(target, fromStoreId);
      if (src) {
        this.upsertDbOverride(
          target,
          {
            server: src.server,
            port: src.port,
            database_name: src.database_name,
            username: src.username,
            password: src.password,
            encrypt: src.encrypt,
            trust_server_certificate: src.trust_server_certificate,
          },
          toStoreId
        );
      }
    }
  }

  updateStore(
    id: number,
    updates: { storeName?: string; password?: string; keepToken?: string }
  ): StoreRecord | null {
    const existing = this.getStoreById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextName = updates.storeName !== undefined ? updates.storeName.trim() : existing.storeName;

    if (updates.password !== undefined && updates.password !== '') {
      const nextHash = hashStorePassword(updates.password);
      this.db
        .prepare(`UPDATE stores SET store_name = ?, password_hash = ?, updated_at = ? WHERE id = ?`)
        .run(nextName, nextHash, now, id);
      // Invalidate other sessions of this store after password change
      if (updates.keepToken) {
        const keepHash = hashSessionToken(updates.keepToken);
        this.db
          .prepare(`DELETE FROM store_sessions WHERE store_id = ? AND token_hash != ?`)
          .run(id, keepHash);
      } else {
        this.db.prepare(`DELETE FROM store_sessions WHERE store_id = ?`).run(id);
      }
    } else {
      this.db
        .prepare(`UPDATE stores SET store_name = ?, updated_at = ? WHERE id = ?`)
        .run(nextName, now, id);
    }

    return this.getStoreById(id);
  }

  deleteStore(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM stores WHERE id = ?`).run(id);
    return Number(res.changes || 0) > 0;
  }

  authenticateStore(storeCode: string, password: string): StoreRecord | null {
    const code = storeCode.trim().toUpperCase();
    const row = this.db
      .prepare(
        `SELECT id, store_code, store_name, password_hash, created_at, updated_at FROM stores WHERE store_code = ?`
      )
      .get(code) as any;
    if (!row) return null;
    if (!verifyStorePassword(password, String(row.password_hash))) {
      return null;
    }
    return {
      id: Number(row.id),
      storeCode: String(row.store_code),
      storeName: String(row.store_name),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  createSession(storeId: number): { token: string; expiresAt: string } {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(token);

    // Prune expired sessions opportunistically
    this.db.prepare(`DELETE FROM store_sessions WHERE expires_at <= ?`).run(nowIso);
    this.db
      .prepare(`INSERT INTO store_sessions (token_hash, store_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(tokenHash, storeId, nowIso, expiresAt);

    return { token, expiresAt };
  }

  verifySessionToken(token: string): StoreSessionInfo | null {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashSessionToken(token.trim());
    const nowIso = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT s.id AS store_id, s.store_code, s.store_name, sess.expires_at
         FROM store_sessions sess
         JOIN stores s ON s.id = sess.store_id
         WHERE sess.token_hash = ? AND sess.expires_at > ?`
      )
      .get(tokenHash, nowIso) as any;
    if (!row) return null;
    return {
      storeId: Number(row.store_id),
      storeCode: String(row.store_code),
      storeName: String(row.store_name),
      expiresAt: String(row.expires_at),
    };
  }

  revokeSessionToken(token: string): void {
    if (!token) return;
    const tokenHash = hashSessionToken(token.trim());
    this.db.prepare(`DELETE FROM store_sessions WHERE token_hash = ?`).run(tokenHash);
  }

  // ===== User Accounts, Permissions, Store Assignments & User Sessions =====

  private hydrateUserRow(row: any): UserRecord {
    const userId = Number(row.id);
    const role: UserRole = isValidUserRole(row.role) ? row.role : 'staff';
    let parsedPerms: unknown = [];
    try {
      parsedPerms = JSON.parse(String(row.permissions_json || '[]'));
    } catch {
      parsedPerms = [];
    }
    const storeRows = this.db
      .prepare(`SELECT store_id FROM user_stores WHERE user_id = ? ORDER BY store_id ASC`)
      .all(userId) as any[];
    return {
      id: userId,
      username: String(row.username),
      displayName: String(row.display_name),
      role,
      permissions: normalizePermissions(parsedPerms, role),
      allStores: Boolean(row.all_stores),
      assignedStoreIds: storeRows.map((sr) => Number(sr.store_id)),
      isActive: Boolean(row.is_active),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  countUsers(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as any;
    return Number(row?.cnt || 0);
  }

  listUsers(): UserRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, username, display_name, role, permissions_json, all_stores, is_active, created_at, updated_at
         FROM users ORDER BY id ASC`
      )
      .all() as any[];
    return rows.map((r) => this.hydrateUserRow(r));
  }

  getUserById(id: number): UserRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, username, display_name, role, permissions_json, all_stores, is_active, created_at, updated_at
         FROM users WHERE id = ?`
      )
      .get(id) as any;
    return row ? this.hydrateUserRow(row) : null;
  }

  getUserByUsername(username: string): UserRecord | null {
    const normalized = username.trim().toLowerCase();
    const row = this.db
      .prepare(
        `SELECT id, username, display_name, role, permissions_json, all_stores, is_active, created_at, updated_at
         FROM users WHERE username = ?`
      )
      .get(normalized) as any;
    return row ? this.hydrateUserRow(row) : null;
  }

  countActiveAdminsWithUserMgmt(excludeUserId?: number): number {
    const users = this.listUsers();
    return users.filter(
      (u) =>
        u.id !== excludeUserId &&
        u.isActive &&
        u.role === 'admin' &&
        u.permissions.includes('user_mgmt')
    ).length;
  }

  createUser(input: {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
    permissions: PermissionKey[];
    allStores: boolean;
    assignedStoreIds: number[];
    isActive?: boolean;
  }): UserRecord {
    const username = input.username.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const role: UserRole = isValidUserRole(input.role) ? input.role : 'staff';
    const permissions = normalizePermissions(input.permissions, role);
    const allStores = Boolean(input.allStores);
    const isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;
    const now = new Date().toISOString();
    const passwordHash = hashStorePassword(input.password);

    const uniqueStoreIds = Array.from(
      new Set(input.assignedStoreIds.filter((id) => Number.isInteger(id) && id > 0))
    );

    this.db.exec('BEGIN');
    try {
      const info = this.db
        .prepare(
          `INSERT INTO users
             (username, display_name, password_hash, role, permissions_json, all_stores, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          username,
          displayName,
          passwordHash,
          role,
          JSON.stringify(permissions),
          allStores ? 1 : 0,
          isActive ? 1 : 0,
          now,
          now
        );

      const userId = Number(info.lastInsertRowid);
      if (uniqueStoreIds.length > 0) {
        const insertStore = this.db.prepare(
          `INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?, ?)`
        );
        for (const sid of uniqueStoreIds) {
          insertStore.run(userId, sid);
        }
      }

      this.db.exec('COMMIT');
      return this.getUserById(userId)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  updateUser(
    id: number,
    updates: {
      displayName?: string;
      password?: string;
      role?: UserRole;
      permissions?: PermissionKey[];
      allStores?: boolean;
      assignedStoreIds?: number[];
      isActive?: boolean;
      keepToken?: string;
    }
  ): UserRecord | null {
    const existing = this.getUserById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextDisplayName =
      updates.displayName !== undefined ? updates.displayName.trim() : existing.displayName;
    const nextRole = updates.role !== undefined && isValidUserRole(updates.role) ? updates.role : existing.role;
    const nextPermissions = normalizePermissions(
      updates.permissions !== undefined ? updates.permissions : existing.permissions,
      nextRole
    );
    const nextAllStores = updates.allStores !== undefined ? Boolean(updates.allStores) : existing.allStores;
    const nextIsActive = updates.isActive !== undefined ? Boolean(updates.isActive) : existing.isActive;

    this.db.exec('BEGIN');
    try {
      if (updates.password !== undefined && updates.password !== '') {
        const nextHash = hashStorePassword(updates.password);
        this.db
          .prepare(
            `UPDATE users
             SET display_name = ?, password_hash = ?, role = ?, permissions_json = ?, all_stores = ?, is_active = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            nextDisplayName,
            nextHash,
            nextRole,
            JSON.stringify(nextPermissions),
            nextAllStores ? 1 : 0,
            nextIsActive ? 1 : 0,
            now,
            id
          );
      } else {
        this.db
          .prepare(
            `UPDATE users
             SET display_name = ?, role = ?, permissions_json = ?, all_stores = ?, is_active = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            nextDisplayName,
            nextRole,
            JSON.stringify(nextPermissions),
            nextAllStores ? 1 : 0,
            nextIsActive ? 1 : 0,
            now,
            id
          );
      }

      if (updates.assignedStoreIds !== undefined) {
        this.db.prepare(`DELETE FROM user_stores WHERE user_id = ?`).run(id);
        const uniqueStoreIds = Array.from(
          new Set(updates.assignedStoreIds.filter((sid) => Number.isInteger(sid) && sid > 0))
        );
        const insertStore = this.db.prepare(
          `INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?, ?)`
        );
        for (const sid of uniqueStoreIds) {
          insertStore.run(id, sid);
        }
      }

      // Revoke sessions if user was disabled or password changed
      if (!nextIsActive) {
        this.db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).run(id);
      } else if (updates.password !== undefined && updates.password !== '') {
        if (updates.keepToken) {
          const keepHash = hashSessionToken(updates.keepToken);
          this.db
            .prepare(`DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?`)
            .run(id, keepHash);
        } else {
          this.db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).run(id);
        }
      }

      this.db.exec('COMMIT');
      return this.getUserById(id);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  deleteUser(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    return Number(res.changes || 0) > 0;
  }

  authenticateUser(username: string, password: string): UserRecord | null {
    const normalized = username.trim().toLowerCase();
    const row = this.db
      .prepare(
        `SELECT id, username, display_name, password_hash, role, permissions_json, all_stores, is_active, created_at, updated_at
         FROM users WHERE username = ?`
      )
      .get(normalized) as any;
    if (!row || !Boolean(row.is_active)) return null;
    if (!verifyStorePassword(password, String(row.password_hash))) {
      return null;
    }
    return this.hydrateUserRow(row);
  }

  verifyUserPassword(userId: number, password: string): boolean {
    const row = this.db
      .prepare(`SELECT password_hash, is_active FROM users WHERE id = ?`)
      .get(userId) as any;
    if (!row || !Boolean(row.is_active)) return false;
    return verifyStorePassword(password, String(row.password_hash));
  }

  createUserSession(userId: number, activeStoreId: number | null = null): { token: string; expiresAt: string } {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(token);

    this.db.prepare(`DELETE FROM user_sessions WHERE expires_at <= ?`).run(nowIso);
    this.db
      .prepare(
        `INSERT INTO user_sessions (token_hash, user_id, active_store_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(tokenHash, userId, activeStoreId, nowIso, expiresAt);

    return { token, expiresAt };
  }

  verifyUserSessionToken(token: string): UserSessionInfo | null {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashSessionToken(token.trim());
    const nowIso = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT u.id AS user_id, sess.active_store_id, sess.expires_at
         FROM user_sessions sess
         JOIN users u ON u.id = sess.user_id
         WHERE sess.token_hash = ? AND sess.expires_at > ? AND u.is_active = 1`
      )
      .get(tokenHash, nowIso) as any;
    if (!row) return null;

    const user = this.getUserById(Number(row.user_id));
    if (!user || !user.isActive) return null;

    const allStores = this.listStores();
    const availableStores = filterAccessibleStores(user, allStores);
    const activeStoreId = row.active_store_id !== null && row.active_store_id !== undefined
      ? Number(row.active_store_id)
      : null;
    const activeStore = activeStoreId !== null
      ? availableStores.find((s) => s.id === activeStoreId) || null
      : null;

    return {
      user,
      activeStore,
      availableStores,
      expiresAt: String(row.expires_at),
    };
  }

  setSessionActiveStore(token: string, storeId: number | null): void {
    if (!token) return;
    const tokenHash = hashSessionToken(token.trim());
    this.db
      .prepare(`UPDATE user_sessions SET active_store_id = ? WHERE token_hash = ?`)
      .run(storeId, tokenHash);
  }

  revokeUserSessionToken(token: string): void {
    if (!token) return;
    const tokenHash = hashSessionToken(token.trim());
    this.db.prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).run(tokenHash);
  }

  // ===== Per-Store & Legacy Global DB Overrides =====

  getDbOverride(target: DbOverrideTarget, storeId?: number | null): DbOverrideRow | null {
    let row: any;
    if (storeId !== undefined && storeId !== null) {
      row = this.db
        .prepare(
          `SELECT target, server, port, database_name, username, password, encrypt, trust_server_certificate, updated_at
           FROM store_db_configs WHERE store_id = ? AND target = ?`
        )
        .get(storeId, target);
    } else {
      row = this.db
        .prepare(
          `SELECT target, server, port, database_name, username, password, encrypt, trust_server_certificate, updated_at
           FROM db_connection_overrides WHERE target = ?`
        )
        .get(target);
    }
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

  getAllDbOverrides(storeId?: number | null): { sklad: DbOverrideRow | null; saledata: DbOverrideRow | null } {
    return {
      sklad: this.getDbOverride('sklad', storeId),
      saledata: this.getDbOverride('saledata', storeId),
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
    },
    storeId?: number | null
  ): DbOverrideRow {
    const now = new Date().toISOString();
    if (storeId !== undefined && storeId !== null) {
      this.db
        .prepare(
          `INSERT INTO store_db_configs
             (store_id, target, server, port, database_name, username, password, encrypt, trust_server_certificate, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(store_id, target) DO UPDATE SET
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
          storeId,
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
    } else {
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
    }
    return {
      target,
      ...input,
      updated_at: now,
    };
  }

  clearAllDbOverrides(storeId?: number | null): void {
    if (storeId !== undefined && storeId !== null) {
      this.db.prepare(`DELETE FROM store_db_configs WHERE store_id = ?`).run(storeId);
    } else {
      this.db.prepare(`DELETE FROM db_connection_overrides`).run();
    }
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
