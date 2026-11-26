import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import sql from 'mssql';
import { filterAccessibleStores, normalizePermissions } from '../auth/permissions';
import { conflictError, validationError } from '../http/envelope';
import { getHostedIdentityPool, hostedKey } from './hostedSql';
import type { IdentityStore } from './identityStore';
import {
  hashStorePassword, verifyStorePassword,
  type DbOverrideRow, type DbOverrideTarget, type StoreRecord, type UserRecord,
} from './metaStore';

type Db = sql.ConnectionPool | sql.Transaction;
type Params = Record<string, string | boolean | number | null>;
type UserInput = Parameters<IdentityStore['createUser']>[0];
type UserUpdate = Parameters<IdentityStore['updateUser']>[1];
type ConnectionConfig = Parameters<IdentityStore['upsertDbOverride']>[1];

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: UserRecord['role'];
  permissions_json: string;
  password_hash: string;
  all_stores: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const storeColumns = 'id, store_code AS storeCode, store_name AS storeName, created_at AS createdAt, updated_at AS updatedAt';
const now = () => new Date().toISOString();
const tokenHash = (token: string) => createHash('sha256').update(token.trim()).digest('hex');

export async function identityQuery<T = Record<string, unknown>>(db: Db, query: string, params: Params = {}) {
  const request = db.request();
  for (const [key, value] of Object.entries(params)) request.input(key, value);
  return request.query<T>(query);
}

export async function identityTransaction<T>(pool: sql.ConnectionPool, work: (tx: sql.Transaction) => Promise<T>) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

async function identityWriteLock(tx: sql.Transaction) {
  await identityQuery(tx, `
    DECLARE @result int;
    EXEC @result = sys.sp_getapplock @Resource = 'op_identity_write', @LockMode = 'Exclusive',
      @LockOwner = 'Transaction', @LockTimeout = 5000;
    IF @result < 0 THROW 51000, 'Identity write lock unavailable', 1;
  `);
}

function aad(storeId: number, target: DbOverrideTarget) {
  return Buffer.from(`op-config-v1:${storeId}:${target}`);
}

export function encryptStoreConfig(key: Buffer, storeId: number, target: DbOverrideTarget, input: ConnectionConfig) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(storeId, target));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(input), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptStoreConfig(key: Buffer, storeId: number, target: DbOverrideTarget, value: string): ConnectionConfig {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid store connection ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
  decipher.setAAD(aad(storeId, target));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

async function replaceAssignments(db: Db, id: number, storeIds: number[]) {
  await identityQuery(db, `
    DELETE FROM dbo.user_stores WHERE user_id = @id;
    INSERT INTO dbo.user_stores (user_id, store_id)
      SELECT @id, CONVERT(int, value) FROM OPENJSON(@stores);
  `, { id, stores: JSON.stringify([...new Set(storeIds)]) });
}

export class SqlIdentityStore implements IdentityStore {
  private readonly key = hostedKey('OP_CONFIG_KEY');

  async assertReady() {
    if (!(await this.countUsers())) throw new Error('Hosted identity database has no users');
    const pool = await getHostedIdentityPool();
    const { recordset } = await identityQuery<{ store_id: number; target: DbOverrideTarget; config_ciphertext: string }>(
      pool, 'SELECT store_id, target, config_ciphertext FROM dbo.store_db_configs'
    );
    for (const row of recordset) decryptStoreConfig(this.key, row.store_id, row.target, row.config_ciphertext);
  }

  private async count(table: 'users' | 'stores') {
    const { recordset } = await identityQuery<{ total: number }>(
      await getHostedIdentityPool(), `SELECT COUNT(*) AS total FROM dbo.${table}`
    );
    return recordset[0].total;
  }

  countStores() { return this.count('stores'); }
  countUsers() { return this.count('users'); }

  async listStores() {
    return (await identityQuery<StoreRecord>(
      await getHostedIdentityPool(), `SELECT ${storeColumns} FROM dbo.stores ORDER BY id`
    )).recordset;
  }

  async getStoreById(id: number) {
    const { recordset } = await identityQuery<StoreRecord>(
      await getHostedIdentityPool(), `SELECT ${storeColumns} FROM dbo.stores WHERE id = @id`, { id }
    );
    return recordset[0] ?? null;
  }

  async getStoreByCode(storeCode: string) {
    const { recordset } = await identityQuery<StoreRecord>(
      await getHostedIdentityPool(), `SELECT ${storeColumns} FROM dbo.stores WHERE store_code = @code`,
      { code: storeCode.trim().toUpperCase() }
    );
    return recordset[0] ?? null;
  }

  async createStore(input: { storeCode: string; storeName: string }) {
    const pool = await getHostedIdentityPool();
    try {
      const { recordset } = await identityQuery<{ id: number }>(pool, `
        INSERT INTO dbo.stores (store_code, store_name, created_at, updated_at)
          OUTPUT inserted.id VALUES (@code, @name, @now, @now);
      `, { code: input.storeCode.trim().toUpperCase(), name: input.storeName.trim(), now: now() });
      return (await this.getStoreById(recordset[0].id))!;
    } catch (error) {
      if ([2601, 2627].includes((error as { number?: number }).number ?? 0)) throw conflictError('门店编号已存在');
      throw error;
    }
  }

  async updateStore(id: number, updates: { storeName?: string }) {
    if (updates.storeName !== undefined) {
      await identityQuery(await getHostedIdentityPool(),
        'UPDATE dbo.stores SET store_name = @name, updated_at = @now WHERE id = @id',
        { id, name: updates.storeName.trim(), now: now() }
      );
    }
    return this.getStoreById(id);
  }

  async deleteStore(id: number) {
    return identityTransaction(await getHostedIdentityPool(), async (tx) => {
      await identityWriteLock(tx);
      const { rowsAffected } = await identityQuery(tx, `
        DELETE FROM dbo.stores WHERE id = @id AND (SELECT COUNT(*) FROM dbo.stores) > 1;
      `, { id });
      return rowsAffected[0] > 0;
    });
  }

  // Global configuration is only supported by the SQLite adapter. Migration handles it explicitly.
  migrateLegacyOverridesToStore(_storeId: number) {}

  async cloneStoreDbConfigs(fromStoreId: number, toStoreId: number) {
    for (const target of ['sklad', 'saledata'] as const) {
      const row = await this.getDbOverride(target, fromStoreId);
      if (row) {
        const { target: _, updated_at: __, ...config } = row;
        await this.upsertDbOverride(target, config, toStoreId);
      }
    }
  }

  private async hydrate(db: Db, rows: UserRow[]) {
    if (rows.length === 0) return [];
    const { recordset: assignments } = await identityQuery<{ user_id: number; store_id: number }>(
      db, 'SELECT user_id, store_id FROM dbo.user_stores WHERE user_id IN (SELECT CONVERT(int, value) FROM OPENJSON(@ids)) ORDER BY store_id',
      { ids: JSON.stringify(rows.map((row) => row.id)) }
    );
    const byUser = new Map<number, number[]>();
    for (const { user_id, store_id } of assignments) {
      const ids = byUser.get(user_id) ?? [];
      ids.push(store_id);
      byUser.set(user_id, ids);
    }
    return rows.map((row): UserRecord => ({
      id: row.id, username: row.username, displayName: row.display_name,
      role: row.role, permissions: normalizePermissions(JSON.parse(row.permissions_json), row.role),
      allStores: row.all_stores, assignedStoreIds: byUser.get(row.id) ?? [],
      isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  private async readUsers(db: Db, where = '', params: Params = {}) {
    const { recordset } = await identityQuery<UserRow>(db, `SELECT * FROM dbo.users ${where} ORDER BY id`, params);
    return this.hydrate(db, recordset);
  }

  async listUsers() { return this.readUsers(await getHostedIdentityPool()); }

  async getUserById(id: number) {
    return (await this.readUsers(await getHostedIdentityPool(), 'WHERE id = @id', { id }))[0] ?? null;
  }

  async getUserByUsername(username: string) {
    return (await this.readUsers(await getHostedIdentityPool(), 'WHERE username = @username', {
      username: username.trim().toLowerCase(),
    }))[0] ?? null;
  }

  private async countManagers(db: Db, exclude: number | null) {
    const { recordset } = await identityQuery<{ total: number }>(db, `
      SELECT COUNT(*) AS total FROM dbo.users
      WHERE (@exclude IS NULL OR id <> @exclude) AND is_active = 1 AND role = 'admin'
        AND EXISTS (SELECT 1 FROM OPENJSON(permissions_json) WHERE value = 'user_mgmt')
    `, { exclude });
    return recordset[0].total;
  }

  async countActiveAdminsWithUserMgmt(exclude?: number) {
    return this.countManagers(await getHostedIdentityPool(), exclude ?? null);
  }

  async createUser(input: UserInput) {
    const pool = await getHostedIdentityPool();
    const hash = hashStorePassword(input.password);
    try {
      return await identityTransaction(pool, async (tx) => {
        const { recordset } = await identityQuery<{ id: number }>(tx, `
          INSERT INTO dbo.users
            (username, display_name, password_hash, role, permissions_json, all_stores, is_active, created_at, updated_at)
          OUTPUT inserted.id VALUES (@username, @name, @hash, @role, @permissions, @allStores, @active, @now, @now);
        `, {
          username: input.username.trim().toLowerCase(), name: input.displayName.trim(), hash, role: input.role,
          permissions: JSON.stringify(normalizePermissions(input.permissions, input.role)),
          allStores: input.allStores, active: input.isActive ?? true, now: now(),
        });
        const id = recordset[0].id;
        await replaceAssignments(tx, id, input.assignedStoreIds);
        return (await this.readUsers(tx, 'WHERE id = @id', { id }))[0];
      });
    } catch (error) {
      if ([2601, 2627].includes((error as { number?: number }).number ?? 0)) throw conflictError('账号已存在');
      throw error;
    }
  }

  async updateUser(id: number, updates: UserUpdate) {
    const hash = updates.password ? hashStorePassword(updates.password) : null;
    return identityTransaction(await getHostedIdentityPool(), async (tx) => {
      await identityWriteLock(tx);
      const [existing] = await this.readUsers(tx, 'WHERE id = @id', { id });
      if (!existing) return null;
      const role = updates.role ?? existing.role;
      const active = updates.isActive ?? existing.isActive;
      const permissions = normalizePermissions(updates.permissions ?? existing.permissions, role);
      if (existing.isActive && existing.role === 'admin' && existing.permissions.includes('user_mgmt')
        && !(active && role === 'admin' && permissions.includes('user_mgmt'))
        && (await this.countManagers(tx, id)) === 0) {
        throw validationError('系统至少需要保留一名启用且拥有账户管理权限的管理员');
      }
      await identityQuery(tx, `
        UPDATE dbo.users SET display_name = @name, password_hash = COALESCE(@hash, password_hash),
          role = @role, permissions_json = @permissions, all_stores = @allStores,
          is_active = @active, updated_at = @now WHERE id = @id
      `, {
        id, hash, role, active, name: updates.displayName?.trim() ?? existing.displayName,
        permissions: JSON.stringify(permissions), allStores: updates.allStores ?? existing.allStores, now: now(),
      });
      if (updates.assignedStoreIds) await replaceAssignments(tx, id, updates.assignedStoreIds);
      if (hash || !active) {
        await identityQuery(tx, 'DELETE FROM dbo.user_sessions WHERE user_id = @id AND (@keep IS NULL OR token_hash <> @keep)', {
          id, keep: active && updates.keepToken ? tokenHash(updates.keepToken) : null,
        });
      }
      return (await this.readUsers(tx, 'WHERE id = @id', { id }))[0];
    });
  }

  async deleteUser(id: number) {
    return identityTransaction(await getHostedIdentityPool(), async (tx) => {
      await identityWriteLock(tx);
      const [user] = await this.readUsers(tx, 'WHERE id = @id', { id });
      if (user?.isActive && user.role === 'admin' && user.permissions.includes('user_mgmt') && (await this.countManagers(tx, id)) === 0) {
        throw validationError('不能删除系统最后一名管理员账户');
      }
      const { rowsAffected } = await identityQuery(tx, 'DELETE FROM dbo.users WHERE id = @id', { id });
      return rowsAffected[0] > 0;
    });
  }

  async authenticateUser(username: string, password: string) {
    if (password.length > 128) return null;
    const pool = await getHostedIdentityPool();
    const { recordset } = await identityQuery<UserRow>(
      pool, 'SELECT * FROM dbo.users WHERE username = @username AND is_active = 1',
      { username: username.trim().toLowerCase() }
    );
    const user = recordset[0];
    if (!user || !verifyStorePassword(password, user.password_hash)) return null;
    return (await this.hydrate(pool, [user]))[0];
  }

  async verifyUserPassword(id: number, password: string) {
    const { recordset } = await identityQuery<{ password_hash: string }>(
      await getHostedIdentityPool(), 'SELECT password_hash FROM dbo.users WHERE id = @id AND is_active = 1', { id }
    );
    return Boolean(recordset[0] && verifyStorePassword(password, recordset[0].password_hash));
  }

  async createUserSession(userId: number, activeStoreId: number | null = null) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await identityQuery(await getHostedIdentityPool(), `
      DELETE FROM dbo.user_sessions WHERE expires_at <= @now;
      INSERT INTO dbo.user_sessions (token_hash, user_id, active_store_id, expires_at)
        VALUES (@hash, @userId, @activeStoreId, @expiresAt);
    `, { hash: tokenHash(token), userId, activeStoreId, expiresAt, now: now() });
    return { token, expiresAt };
  }

  async verifyUserSessionToken(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const pool = await getHostedIdentityPool();
    const { recordset } = await identityQuery<UserRow & { active_store_id: number | null; expires_at: string }>(pool, `
      SELECT u.*, s.active_store_id, s.expires_at
      FROM dbo.user_sessions s JOIN dbo.users u ON u.id = s.user_id
      WHERE s.token_hash = @hash AND s.expires_at > @now AND u.is_active = 1
    `, { hash: tokenHash(token), now: now() });
    const row = recordset[0];
    if (!row) return null;
    const [user] = await this.hydrate(pool, [row]);
    const availableStores = filterAccessibleStores(user, await this.listStores());
    return { user, availableStores, activeStore: availableStores.find((store) => store.id === row.active_store_id) ?? null, expiresAt: row.expires_at };
  }

  async setSessionActiveStore(token: string, storeId: number | null) {
    await identityQuery(await getHostedIdentityPool(),
      'UPDATE dbo.user_sessions SET active_store_id = @storeId WHERE token_hash = @hash',
      { hash: tokenHash(token), storeId }
    );
  }

  async revokeUserSessionToken(token: string) {
    await identityQuery(await getHostedIdentityPool(), 'DELETE FROM dbo.user_sessions WHERE token_hash = @hash',
      { hash: tokenHash(token) }
    );
  }

  async getDbOverride(target: DbOverrideTarget, storeId?: number | null): Promise<DbOverrideRow | null> {
    if (!storeId) return null;
    const { recordset } = await identityQuery<{ config_ciphertext: string; updated_at: string }>(
      await getHostedIdentityPool(), 'SELECT config_ciphertext, updated_at FROM dbo.store_db_configs WHERE store_id = @storeId AND target = @target',
      { storeId, target }
    );
    const row = recordset[0];
    if (!row) return null;
    return { target, ...decryptStoreConfig(this.key, storeId, target, row.config_ciphertext), updated_at: row.updated_at };
  }

  async upsertDbOverride(target: DbOverrideTarget, input: ConnectionConfig, storeId?: number | null) {
    if (!storeId) throw new Error('Store is required for connection configuration');
    const ciphertext = encryptStoreConfig(this.key, storeId, target, input);
    const updated_at = now();
    await identityTransaction(await getHostedIdentityPool(), async (tx) => {
      await identityQuery(tx, `
        UPDATE dbo.store_db_configs WITH (UPDLOCK, SERIALIZABLE)
          SET config_ciphertext = @ciphertext, updated_at = @now WHERE store_id = @storeId AND target = @target;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.store_db_configs (store_id, target, config_ciphertext, updated_at)
          VALUES (@storeId, @target, @ciphertext, @now);
      `, { target, storeId, ciphertext, now: updated_at });
    });
    return { target, ...input, updated_at };
  }

  async clearAllDbOverrides(storeId?: number | null) {
    if (!storeId) throw new Error('Store is required for connection configuration');
    await identityQuery(await getHostedIdentityPool(), 'DELETE FROM dbo.store_db_configs WHERE store_id = @storeId', { storeId });
  }
}
