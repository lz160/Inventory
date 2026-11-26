import { AsyncLocalStorage } from 'node:async_hooks';
import sql from 'mssql';
import { serverError } from '../http/envelope';
import { isHostedSqlEnabled } from './hostedSql';
import type { DbOverrideRow, DbOverrideTarget, InventoryTable } from './metaStore';

export type DbTarget = DbOverrideTarget;

export interface DbOverrideStore {
  getDbOverride(target: DbTarget, storeId?: number | null): DbOverrideRow | null;
}

export interface StoreRequestContext {
  storeId: number | null;
  overrideStore?: DbOverrideStore | null;
}

const storeContextAls = new AsyncLocalStorage<StoreRequestContext>();

export function runWithStoreContext<T>(
  storeId: number | null,
  fn: () => T,
  overrideStore?: DbOverrideStore | null
): T {
  return storeContextAls.run({ storeId, overrideStore }, fn);
}

export function getActiveStoreId(): number | null {
  return storeContextAls.getStore()?.storeId ?? null;
}

function getActiveOverrideStore(): DbOverrideStore | null {
  const ctx = storeContextAls.getStore();
  if (ctx && ctx.overrideStore !== undefined) {
    return ctx.overrideStore;
  }
  return activeOverrideStore;
}

export interface MssqlPoolConfig {
  server: string;
  port: number;
  user: string;
  password: string;
  database: string;
  inventoryTable?: InventoryTable;
  max: number;
  requestTimeoutMs: number;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface SanitizedDbConfig {
  target: DbTarget;
  server: string;
  port: number;
  database: string;
  user: string;
  hasPassword: boolean;
  encrypt: boolean;
  trustServerCertificate: boolean;
  source: 'override' | 'env' | 'unconfigured';
  updatedAt?: string;
}

export interface DbConnectionTestResult {
  ok: boolean;
  durationMs: number;
  reason?: string;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST' | 'UNREACHABLE';
  targetInfo: {
    server: string;
    port: number;
    database: string;
  };
}

let activeOverrideStore: DbOverrideStore | null = null;

export function setMssqlOverrideStore(store: DbOverrideStore | null): void {
  activeOverrideStore = store;
}

const poolCache = new Map<string, sql.ConnectionPool>();
const poolConnecting = new Map<string, Promise<sql.ConnectionPool>>();
const failedPoolCache = new Map<string, { until: number; message: string }>();

const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
const FAILURE_COOLDOWN_MS = 10000;

export interface MssqlHealthResult {
  ok: boolean;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST' | 'UNREACHABLE';
  reason?: string;
  targetInfo: {
    server: string;
    port: number;
    database: string;
  };
}

export function getMssqlConfigFromEnv(target: DbTarget): MssqlPoolConfig {
  const prefix = target === 'sklad' ? 'MSSQL_SKLAD' : 'MSSQL_SALEDATA';
  const server = (process.env[`${prefix}_SERVER`] || '').trim();
  const rawPort = (process.env[`${prefix}_PORT`] || '1433').trim();
  const parsedPort = Number(rawPort);
  const port = Number.isInteger(parsedPort) ? parsedPort : NaN;
  const user = (process.env[`${prefix}_USER`] || '').trim();
  const password = process.env[`${prefix}_PASSWORD`] || '';
  const database = (
    process.env[`${prefix}_DATABASE`] || (target === 'sklad' ? 'SKLAD' : 'SaleData')
  ).trim();
  const max = Math.max(1, Math.min(50, Number(process.env.MSSQL_POOL_MAX || '10') || 10));
  const requestTimeoutMs = Math.max(
    1000,
    Number(process.env.MSSQL_REQUEST_TIMEOUT_MS || '30000') || 30000
  );
  const encrypt = String(process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true';
  const trustServerCertificate =
    String(process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false';

  return {
    server,
    port,
    user,
    password,
    database,
    max,
    requestTimeoutMs,
    encrypt,
    trustServerCertificate,
  };
}

export function getEffectiveMssqlConfig(
  target: DbTarget,
  explicitStoreId?: number | null
): {
  cfg: MssqlPoolConfig;
  source: 'override' | 'env';
  updatedAt?: string;
} {
  const storeId = explicitStoreId !== undefined ? explicitStoreId : getActiveStoreId();
  const envCfg = getMssqlConfigFromEnv(target);
  const override = getActiveOverrideStore()?.getDbOverride(target, storeId) || null;
  if (!override) {
    const cfg = isHostedSqlEnabled() && storeId !== null
      ? { ...envCfg, server: '', user: '', password: '' }
      : envCfg;
    return { cfg, source: 'env' };
  }

  return {
    cfg: {
      server: override.server.trim(),
      port: Number(override.port || 1433),
      user: override.username.trim(),
      password: override.password,
      database: override.database_name.trim() || (target === 'sklad' ? 'SKLAD' : 'SaleData'),
      inventoryTable: target === 'sklad' ? override.inventory_table : undefined,
      max: envCfg.max,
      requestTimeoutMs: envCfg.requestTimeoutMs,
      encrypt: override.encrypt,
      trustServerCertificate: override.trust_server_certificate,
    },
    source: 'override',
    updatedAt: override.updated_at,
  };
}

export function getInventoryTable(): '[dbo].[g1]' | '[dbo].[sklad1]' {
  const table = getEffectiveMssqlConfig('sklad').cfg.inventoryTable;
  return table === 'sklad1' ? '[dbo].[sklad1]' : '[dbo].[g1]';
}

export function getSanitizedDbConfig(target: DbTarget): SanitizedDbConfig {
  const { cfg, source, updatedAt } = getEffectiveMssqlConfig(target);
  const isConfigured = Boolean(cfg.server && cfg.user);
  return {
    target,
    server: cfg.server,
    port: Number.isFinite(cfg.port) ? cfg.port : 1433,
    database: cfg.database,
    user: cfg.user,
    hasPassword: Boolean(cfg.password),
    encrypt: cfg.encrypt,
    trustServerCertificate: cfg.trustServerCertificate,
    source: source === 'override' ? 'override' : isConfigured ? 'env' : 'unconfigured',
    updatedAt,
  };
}

export function validateCustomMssqlConfig(
  target: DbTarget,
  cfg: MssqlPoolConfig
): {
  valid: boolean;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST';
  reason?: string;
  cfg: MssqlPoolConfig;
} {
  const prefix = target === 'sklad' ? 'MSSQL_SKLAD' : 'MSSQL_SALEDATA';
  const defaultDb = target === 'sklad' ? 'SKLAD' : 'SaleData';

  if (!cfg.server || !cfg.user) {
    return {
      valid: false,
      errorCode: 'UNCONFIGURED',
      reason: `门店数据库 (${cfg.database || defaultDb}) 尚未配置连接参数（请设置主机地址与用户名密码，或配置 ${prefix}_SERVER）`,
      cfg,
    };
  }

  if (/^\d+$/.test(cfg.server) || /\s/.test(cfg.server)) {
    return {
      valid: false,
      errorCode: 'INVALID_HOST',
      reason: `门店数据库 (${cfg.database || defaultDb}) 主机地址 "${cfg.server}" 无效：应填写 SQL Server IP 或域名（标准库名为 ${defaultDb}，端口为 1433），请勿填写端口或账号`,
      cfg,
    };
  }

  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    return {
      valid: false,
      errorCode: 'INVALID_HOST',
      reason: `门店数据库 (${cfg.database || defaultDb}) 端口配置无效：必须为 1–65535 之间的整数（通常为 1433）`,
      cfg,
    };
  }

  if (!cfg.database) {
    return {
      valid: false,
      errorCode: 'INVALID_HOST',
      reason: `数据库名称不能为空（默认应为 ${defaultDb}）`,
      cfg,
    };
  }

  return { valid: true, cfg };
}

export function validateMssqlConfig(target: DbTarget): {
  valid: boolean;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST';
  reason?: string;
  cfg: MssqlPoolConfig;
} {
  const { cfg } = getEffectiveMssqlConfig(target);
  return validateCustomMssqlConfig(target, cfg);
}

export function isMssqlConfigured(target: DbTarget): boolean {
  const { cfg } = getEffectiveMssqlConfig(target);
  return Boolean(cfg.server && cfg.user);
}

function getPoolKey(cfg: MssqlPoolConfig, storeId?: number | null): string {
  const sid = storeId !== undefined ? storeId : getActiveStoreId();
  const prefix = sid !== null && sid !== undefined ? `store:${sid}` : 'store:global';
  return `${prefix}:${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user}/${cfg.encrypt ? 1 : 0}/${cfg.trustServerCertificate ? 1 : 0}`;
}

/**
 * Retrieves or builds a cached MSSQL ConnectionPool (§7.2).
 * Implements config validation, failure cooldown, health checks, and self-healing cache eviction.
 */
export async function getMssqlPool(
  target: DbTarget,
  options: { bypassCooldown?: boolean } = {}
): Promise<sql.ConnectionPool> {
  const validation = validateMssqlConfig(target);
  const { cfg } = validation;
  if (!validation.valid) {
    throw serverError(validation.reason!);
  }

  const key = getPoolKey(cfg);

  // Health check existing pool
  const existing = poolCache.get(key);
  if (existing) {
    if (existing.connected) {
      failedPoolCache.delete(key);
      return existing;
    }
    poolCache.delete(key);
    try {
      await existing.close();
    } catch {
      // ignore close error on broken pool
    }
  }

  // Fast-fail if recent connection failed within cooldown window
  if (!options.bypassCooldown) {
    const recentFail = failedPoolCache.get(key);
    if (recentFail && Date.now() < recentFail.until) {
      throw serverError(recentFail.message);
    }
  }

  // Deduplicate concurrent connection attempts
  const pending = poolConnecting.get(key);
  if (pending) {
    return pending;
  }

  const connectionTimeout = Math.max(
    1000,
    Math.min(
      15000,
      Number(process.env.MSSQL_CONNECTION_TIMEOUT_MS || String(DEFAULT_CONNECTION_TIMEOUT_MS)) ||
        DEFAULT_CONNECTION_TIMEOUT_MS
    )
  );

  const connectPromise = (async () => {
    const pool = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      pool: {
        max: cfg.max,
        min: 0,
        idleTimeoutMillis: 30000,
      },
      connectionTimeout,
      requestTimeout: cfg.requestTimeoutMs,
      options: {
        encrypt: cfg.encrypt,
        trustServerCertificate: cfg.trustServerCertificate,
      },
    });

    // Self-healing: evict pool on async error so next request reconnects cleanly
    pool.on('error', (err) => {
      console.error(`[MSSQL-POOL] Pool error on ${key}: ${err?.message || err}`);
      if (poolCache.get(key) === pool) {
        poolCache.delete(key);
      }
      pool.close().catch(() => {});
    });

    try {
      await pool.connect();
      failedPoolCache.delete(key);
      poolCache.set(key, pool);
      return pool;
    } catch (err: any) {
      try {
        await pool.close();
      } catch {}
      const message = `门店 SQL Server (${cfg.database}) 连接不可达: ${
        err?.message || '请检查网络与数据库地址配置'
      }`;
      failedPoolCache.set(key, {
        until: Date.now() + FAILURE_COOLDOWN_MS,
        message,
      });
      throw serverError(message);
    } finally {
      poolConnecting.delete(key);
    }
  })();

  poolConnecting.set(key, connectPromise);
  return connectPromise;
}

/**
 * Tests a candidate SQL Server configuration using a short-lived ephemeral pool.
 * Never mutates live pooled connections or exposes credentials.
 */
export async function testMssqlConnection(
  target: DbTarget,
  draft?: Partial<{
    server: string;
    port: number | string;
    database: string;
    user: string;
    password: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
    syncPasswordFromSklad: boolean;
  }>
): Promise<DbConnectionTestResult> {
  const startedAt = Date.now();
  const base = getEffectiveMssqlConfig(target).cfg;
  const rawPort = draft?.port !== undefined ? Number(draft.port) : base.port;
  const port = Number.isInteger(rawPort) ? rawPort : NaN;

  let resolvedPassword = base.password;
  if (draft?.password !== undefined && draft.password !== '') {
    resolvedPassword = draft.password;
  } else if (draft?.syncPasswordFromSklad) {
    resolvedPassword = getEffectiveMssqlConfig('sklad').cfg.password;
  }

  const candidate: MssqlPoolConfig = {
    server: (draft?.server !== undefined ? String(draft.server) : base.server).trim(),
    port,
    database: (draft?.database !== undefined ? String(draft.database) : base.database).trim(),
    user: (draft?.user !== undefined ? String(draft.user) : base.user).trim(),
    password: resolvedPassword,
    max: 1,
    requestTimeoutMs: 5000,
    encrypt: draft?.encrypt !== undefined ? Boolean(draft.encrypt) : base.encrypt,
    trustServerCertificate:
      draft?.trustServerCertificate !== undefined
        ? Boolean(draft.trustServerCertificate)
        : base.trustServerCertificate,
  };

  const targetInfo = {
    server: candidate.server,
    port: Number.isFinite(candidate.port) ? candidate.port : 1433,
    database: candidate.database,
  };

  const validation = validateCustomMssqlConfig(target, candidate);
  if (!validation.valid) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      errorCode: validation.errorCode,
      reason: validation.reason,
      targetInfo,
    };
  }

  const pool = new sql.ConnectionPool({
    server: candidate.server,
    port: candidate.port,
    user: candidate.user,
    password: candidate.password,
    database: candidate.database,
    pool: { max: 1, min: 0, idleTimeoutMillis: 2000 },
    connectionTimeout: 5000,
    requestTimeout: 5000,
    options: {
      encrypt: candidate.encrypt,
      trustServerCertificate: candidate.trustServerCertificate,
    },
  });

  try {
    await pool.connect();
    await pool.request().query('SELECT 1 AS ok');
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      targetInfo,
    };
  } catch (err: any) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      errorCode: 'UNREACHABLE',
      reason: `门店 SQL Server (${candidate.database}) 连接测试失败: ${
        err?.message || '请检查主机、端口、账号密码及网络可达性'
      }`,
      targetInfo,
    };
  } finally {
    try {
      await pool.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Non-throwing health probe for UI context banner & preflight readiness checks.
 * Never leaks credentials (only server/port/database).
 */
export async function probeMssqlTarget(
  target: DbTarget,
  options: { bypassCooldown?: boolean } = {}
): Promise<MssqlHealthResult> {
  const validation = validateMssqlConfig(target);
  const targetInfo = {
    server: validation.cfg.server,
    port: Number.isFinite(validation.cfg.port) ? validation.cfg.port : 1433,
    database: validation.cfg.database,
  };

  if (!validation.valid) {
    return {
      ok: false,
      errorCode: validation.errorCode,
      reason: validation.reason,
      targetInfo,
    };
  }

  try {
    await getMssqlPool(target, options);
    return {
      ok: true,
      targetInfo,
    };
  } catch (err: any) {
    return {
      ok: false,
      errorCode: 'UNREACHABLE',
      reason: err?.message || `门店 SQL Server (${targetInfo.database}) 连接不可达`,
      targetInfo,
    };
  }
}

/**
 * Closes cached pools (scoped to a storeId if supplied, or all pools).
 */
export async function closeAllMssqlPools(storeId?: number | null): Promise<void> {
  if (storeId !== undefined && storeId !== null) {
    const prefix = `store:${storeId}:`;
    const matching: sql.ConnectionPool[] = [];
    for (const [k, p] of poolCache.entries()) {
      if (k.startsWith(prefix)) {
        matching.push(p);
        poolCache.delete(k);
      }
    }
    for (const k of Array.from(poolConnecting.keys())) {
      if (k.startsWith(prefix)) poolConnecting.delete(k);
    }
    for (const k of Array.from(failedPoolCache.keys())) {
      if (k.startsWith(prefix)) failedPoolCache.delete(k);
    }
    await Promise.all(
      matching.map(async (p) => {
        try {
          await p.close();
        } catch {}
      })
    );
    return;
  }

  const pools = Array.from(poolCache.values());
  poolCache.clear();
  poolConnecting.clear();
  failedPoolCache.clear();
  await Promise.all(
    pools.map(async (p) => {
      try {
        await p.close();
      } catch {
        // ignore shutdown error
      }
    })
  );
}
