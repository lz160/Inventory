import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import sql from 'mssql';
import {
  hostedConnection, hostedDbName, hostedKey, hostedSecret, hostedStoreLogin,
  identityDbName, identityLogin,
} from '../src/core/db/hostedSql';
import { initializeHostedProductMetadata } from '../src/core/db/productMetadataStore';
import {
  encryptStoreConfig, identityQuery, identityTransaction,
} from '../src/core/db/sqlIdentityStore';
import type { DbOverrideTarget } from '../src/core/db/metaStore';

const schema = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const identitySchema = schema('003_hosted_identity.sql');
const identityTables = ['stores', 'users', 'user_stores', 'user_sessions', 'store_db_configs'];
const storeTables = ['ReceivingOrder', 'ReceivingLine', 'ReceivingOperation', 'product_meta'];
const literal = (value: string) => "N'" + value.replaceAll("'", "''") + "'";

async function adminPool(database = 'master') {
  const pool = new sql.ConnectionPool(hostedConnection(
    database,
    process.env.OP_SQL_ADMIN_USER || 'sa',
    hostedSecret('OP_SQL_ADMIN_PASSWORD')
  ));
  return pool.connect();
}

async function ensureDatabase(master: sql.ConnectionPool, database: string, user: string, password: string) {
  await master.request().batch(`
    IF DB_ID('${database}') IS NULL
    BEGIN
      EXEC('CREATE DATABASE [${database}]');
      ALTER DATABASE [${database}] SET AUTO_CLOSE OFF;
    END;
    IF SUSER_ID('${user}') IS NULL
      CREATE LOGIN [${user}] WITH PASSWORD = ${literal(password)},
        DEFAULT_DATABASE = [${database}], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
  `);
}

async function grantAccess(pool: sql.ConnectionPool, user: string, tables: string[]) {
  await pool.request().batch(`
    IF DATABASE_PRINCIPAL_ID('${user}') IS NULL CREATE USER [${user}] FOR LOGIN [${user}];
    ${tables.map((table) => `GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.[${table}] TO [${user}];`).join('\n')}
  `);
}

async function provisionStore(master: sql.ConnectionPool, id: number) {
  const dbName = hostedDbName(id);
  const { user, password } = hostedStoreLogin(id);
  await ensureDatabase(master, dbName, user, password);
  const pool = await adminPool(dbName);
  try {
    await identityTransaction(pool, async (tx) => {
      await tx.request().batch(schema('004_hosted_receiving.sql'));
    });
    await initializeHostedProductMetadata(pool);
    await grantAccess(pool, user, storeTables);
    await pool.request().batch(`GRANT SELECT ON OBJECT::dbo.categories TO [${user}];`);
  } finally {
    await pool.close();
  }
}

type LegacyStore = { id: number; store_code: string; store_name: string; created_at: string; updated_at: string };
type LegacyUser = {
  id: number; username: string; display_name: string; password_hash: string; role: string;
  permissions_json: string; all_stores: number; is_active: number; created_at: string; updated_at: string;
};
type LegacyAssignment = { user_id: number; store_id: number };
type LegacyConfig = {
  store_id: number; target: DbOverrideTarget; server: string; port: number; database_name: string; username: string;
  password: string; encrypt: number; trust_server_certificate: number; updated_at: string;
};

async function migrateLegacyIdentity(pool: sql.ConnectionPool, filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const snapshot = db.prepare('PRAGMA quick_check').get();
    if (snapshot?.quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    const stores = db.prepare('SELECT id, store_code, store_name, created_at, updated_at FROM stores').all() as LegacyStore[];
    const users = db.prepare('SELECT * FROM users').all() as LegacyUser[];
    const assignments = db.prepare('SELECT * FROM user_stores').all() as LegacyAssignment[];
    const configs = db.prepare('SELECT * FROM store_db_configs').all() as LegacyConfig[];
    const legacyConfigs = db.prepare('SELECT * FROM db_connection_overrides').all() as Omit<LegacyConfig, 'store_id'>[];
    const metadataCount = db.prepare('SELECT COUNT(*) AS n FROM product_meta').get()?.n;
    if (metadataCount !== 0) throw new Error('Legacy product metadata requires explicit store assignment');
    if (legacyConfigs.length && stores.length !== 1) throw new Error('Legacy global store connections have ambiguous store assignment');
    for (const row of legacyConfigs) {
      const store_id = stores[0].id;
      if (!configs.some((existing) => existing.store_id === store_id && existing.target === row.target)) {
        configs.push({ ...row, store_id });
      }
    }
    if (!stores.length || !users.some((user) => user.is_active && user.role === 'admin'
      && JSON.parse(user.permissions_json).includes('user_mgmt'))) throw new Error('No active administrator or store in source');
    if (users.some((user) => !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.password_hash))) {
      throw new Error('Unexpected password hash format');
    }

    const key = hostedKey('OP_CONFIG_KEY');
    await identityTransaction(pool, async (tx) => {
      const existing = await identityQuery<{ total: number }>(tx, 'SELECT COUNT(*) AS total FROM dbo.users WITH (HOLDLOCK, UPDLOCK)');
      if (existing.recordset[0].total) throw new Error('Target identity database is already initialized');
      await identityQuery(tx, `
        SET IDENTITY_INSERT dbo.stores ON;
        INSERT INTO dbo.stores (id, store_code, store_name, created_at, updated_at)
        SELECT id, store_code, store_name, created_at, updated_at
        FROM OPENJSON(@rows) WITH (
          id int, store_code varchar(32), store_name nvarchar(100),
          created_at varchar(24), updated_at varchar(24)
        );
        SET IDENTITY_INSERT dbo.stores OFF;
      `, { rows: JSON.stringify(stores) });
      await identityQuery(tx, `
        SET IDENTITY_INSERT dbo.users ON;
        INSERT INTO dbo.users (id, username, display_name, password_hash, role, permissions_json, all_stores, is_active, created_at, updated_at)
        SELECT id, username, display_name, password_hash, role, permissions_json, all_stores, is_active, created_at, updated_at
        FROM OPENJSON(@rows) WITH (
          id int, username varchar(64), display_name nvarchar(100), password_hash varchar(200),
          role varchar(12), permissions_json nvarchar(500), all_stores bit, is_active bit,
          created_at varchar(24), updated_at varchar(24)
        );
        SET IDENTITY_INSERT dbo.users OFF;
      `, { rows: JSON.stringify(users) });
      for (const row of assignments) {
        await identityQuery(tx, 'INSERT INTO dbo.user_stores (user_id, store_id) VALUES (@user_id, @store_id)', { ...row });
      }
      for (const { store_id, target, updated_at, encrypt, trust_server_certificate, ...config } of configs) {
        const ciphertext = encryptStoreConfig(key, store_id, target, {
          ...config, encrypt: Boolean(encrypt), trust_server_certificate: Boolean(trust_server_certificate),
        });
        await identityQuery(tx, `
          INSERT INTO dbo.store_db_configs (store_id, target, config_ciphertext, updated_at)
          VALUES (@store_id, @target, @ciphertext, @updated_at)
        `, { store_id, target, ciphertext, updated_at });
      }
    });
    console.log(`Migrated ${stores.length} stores, ${users.length} users, ${assignments.length} assignments, and ${configs.length} encrypted connections`);
  } finally {
    db.close();
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (!['init', 'sync-stores', 'provision-store', 'migrate-identity'].includes(command || '')) {
    throw new Error('Usage: provisionHostedSql.ts init | sync-stores | provision-store <id> | migrate-identity <sqlite-file>');
  }
  const master = await adminPool();
  try {
    if (command === 'provision-store') {
      const id = Number(argument);
      await provisionStore(master, id);
      return;
    }
    if (command === 'init') {
      await ensureDatabase(master, identityDbName, identityLogin, hostedSecret('OP_IDENTITY_SQL_PASSWORD'));
    }
    const identity = await adminPool(identityDbName);
    try {
      if (command === 'init') {
        await identityTransaction(identity, async (tx) => { await tx.request().batch(identitySchema); });
        await grantAccess(identity, identityLogin, identityTables);
      }
      if (command === 'migrate-identity') {
        if (!argument) throw new Error('SQLite file is required');
        await migrateLegacyIdentity(identity, argument);
      }
      if (command === 'sync-stores' || command === 'migrate-identity') {
        const { recordset } = await identity.query<{ id: number }>(`
          SELECT s.id FROM dbo.stores s
          WHERE NOT EXISTS (SELECT 1 FROM dbo.hosted_store_ready r WHERE r.store_id = s.id)
          ORDER BY s.id
        `);
        for (const { id } of recordset) {
          await provisionStore(master, id);
          await identityQuery(identity, `
            INSERT INTO dbo.hosted_store_ready (store_id)
            SELECT id FROM dbo.stores WHERE id = @id
              AND NOT EXISTS (SELECT 1 FROM dbo.hosted_store_ready WHERE store_id = @id)
          `, { id });
        }
      }
    } finally {
      await identity.close();
    }
  } finally {
    await master.close();
  }
}

main().catch((error) => {
  console.error('Hosted database provisioning failed:', error?.message || 'Unknown error');
  process.exitCode = 1;
});
