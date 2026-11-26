import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sql from 'mssql';

export function isHostedSqlEnabled() {
  return process.env.IMS_PERSISTENCE === 'hosted-sql';
}

export function hostedSecret(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trimEnd() : process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function hostedKey(name: string): Buffer {
  const hex = hostedSecret(name);
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error(`${name} must be a 32-byte hexadecimal key`);
  return Buffer.from(hex, 'hex');
}

export function hostedDbName(storeId: number) {
  if (!Number.isSafeInteger(storeId) || storeId <= 0 || storeId > 2147483647) {
    throw new Error('Invalid store identifier');
  }
  return `op_store_${storeId}`;
}

export function hostedStoreLogin(storeId: number) {
  const name = hostedDbName(storeId);
  return {
    user: name,
    password: `Op1!${createHmac('sha256', hostedKey('OP_STORE_LOGIN_KEY')).update(name).digest('hex')}`,
  };
}

export function hostedConnection(
  database: string,
  user: string,
  password: string
): sql.config {
  const port = Number(process.env.OP_SQL_PORT || 11433);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid OP_SQL_PORT');
  return {
    server: process.env.OP_SQL_HOST || '127.0.0.1',
    port, database, user, password,
    connectionTimeout: 5000,
    requestTimeout: 30000,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      serverName: process.env.OP_SQL_TLS_NAME || 'localhost',
      cryptoCredentialsDetails: { ca: readFileSync(hostedSecret('OP_SQL_CA_PATH')) },
    },
    pool: { min: 0, max: 4, idleTimeoutMillis: 30000 },
  };
}

const pools = new Map<string, Promise<sql.ConnectionPool>>();
function getPool(config: sql.config) {
  const name = config.database!;
  const current = pools.get(name);
  if (current) return current;
  const pool = new sql.ConnectionPool(config);
  pool.on('error', () => console.error(`Hosted database pool error for ${name}`));
  const pending = pool.connect().catch(async (error) => {
    pools.delete(name);
    await pool.close().catch(() => undefined);
    throw error;
  });
  pools.set(name, pending);
  return pending;
}

export const identityDbName = 'op_identity';
export const identityLogin = 'op_identity_app';

export function getHostedIdentityPool() {
  return getPool(hostedConnection(identityDbName, identityLogin, hostedSecret('OP_IDENTITY_SQL_PASSWORD')));
}

export async function getHostedStorePool(storeId: number) {
  const { user, password } = hostedStoreLogin(storeId);
  return getPool(hostedConnection(hostedDbName(storeId), user, password));
}

export async function closeHostedPools() {
  const pending = [...pools.values()];
  pools.clear();
  await Promise.allSettled(pending.map(async (pool) => (await pool).close()));
}
