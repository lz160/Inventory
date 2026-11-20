import express, { Express } from 'express';
import { MetaStore, getMetaStore } from './core/db/metaStore';
import { SqliteSandbox, getSqliteSandbox } from './core/db/sqliteSandbox';
import {
  DbTarget,
  closeAllMssqlPools,
  getEffectiveMssqlConfig,
  getSanitizedDbConfig,
  isMssqlConfigured,
  probeMssqlTarget,
  setMssqlOverrideStore,
  testMssqlConnection,
  validateCustomMssqlConfig,
} from './core/db/pool';
import { apiErrorMiddleware, asyncHandler, sendSuccess, validationError } from './core/http/envelope';
import {
  MssqlInventoryRepository,
  SqliteInventoryRepository,
} from './modules/inventory/repository';
import { InventoryService } from './modules/inventory/service';
import { createInventoryRouter } from './modules/inventory/routes';
import {
  MssqlStocktakeRepository,
  SqliteStocktakeRepository,
} from './modules/stocktake/repository';
import { StocktakeService } from './modules/stocktake/service';
import { createStocktakeRouter } from './modules/stocktake/routes';
import {
  MssqlSalesRepository,
  SqliteSalesRepository,
} from './modules/sales/repository';
import { SalesService } from './modules/sales/service';
import { createSalesRouter } from './modules/sales/routes';

export interface MountImsOptions {
  dbMode?: 'mssql' | 'sqlite-seed';
  sandbox?: SqliteSandbox;
  metaStore?: MetaStore;
}

export function mountImsRoutes(app: Express, options: MountImsOptions = {}) {
  const mode =
    options.dbMode ||
    (process.env.IMS_DB_MODE === 'sqlite-seed' ? 'sqlite-seed' : 'mssql');

  const metaStore = options.metaStore || getMetaStore();
  setMssqlOverrideStore(metaStore);
  const sandbox =
    mode === 'sqlite-seed' ? options.sandbox || getSqliteSandbox() : undefined;

  const inventoryRepo = sandbox
    ? new SqliteInventoryRepository(sandbox)
    : new MssqlInventoryRepository();
  const stocktakeRepo = sandbox
    ? new SqliteStocktakeRepository(sandbox)
    : new MssqlStocktakeRepository();
  const salesRepo = sandbox
    ? new SqliteSalesRepository(sandbox)
    : new MssqlSalesRepository();

  const inventoryService = new InventoryService(inventoryRepo, metaStore);
  const stocktakeService = new StocktakeService(stocktakeRepo);
  const salesService = new SalesService(salesRepo, metaStore);

  const attachRequestTiming: express.RequestHandler = (req, _res, next) => {
    (req as any)._startedAt = Date.now();
    next();
  };
  app.use(['/api/g1', '/api/stocktakes', '/api/sales', '/api/ims'], attachRequestTiming);

  // Runtime context & database readiness endpoint for UI status banner
  app.get(
    '/api/ims/context',
    asyncHandler(async (req, res) => {
      const bypassCooldown = req.query.recheck === '1';
      const dbStatus =
        mode === 'sqlite-seed'
          ? {
              sklad: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SKLAD' } },
              saledata: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SaleData' } },
            }
          : {
              sklad: await probeMssqlTarget('sklad', { bypassCooldown }),
              saledata: await probeMssqlTarget('saledata', { bypassCooldown }),
            };

      sendSuccess(res, {
        dbMode: mode,
        mssqlConfigured: {
          sklad: isMssqlConfigured('sklad'),
          saledata: isMssqlConfigured('saledata'),
        },
        dbStatus,
        timezone: 'Europe/Bratislava',
        currency: 'EUR',
        vatRate: 0.23,
      });
    })
  );

  app.get('/api/ims/db-config', (_req, res) => {
    sendSuccess(res, {
      dbMode: mode,
      sklad: getSanitizedDbConfig('sklad'),
      saledata: getSanitizedDbConfig('saledata'),
    });
  });

  app.post(
    '/api/ims/db-config/test',
    asyncHandler(async (req, res) => {
      const target = req.body?.target;
      if (target !== 'sklad' && target !== 'saledata') {
        throw validationError('target 必须为 sklad 或 saledata');
      }
      const result = await testMssqlConnection(target, req.body?.config || {});
      sendSuccess(res, result);
    })
  );

  app.put(
    '/api/ims/db-config',
    asyncHandler(async (req, res) => {
      const targets: DbTarget[] = ['sklad', 'saledata'];
      const toSave: Array<{
        target: DbTarget;
        server: string;
        port: number;
        database_name: string;
        username: string;
        password: string;
        encrypt: boolean;
        trust_server_certificate: boolean;
      }> = [];

      let resolvedSkladPassword = getEffectiveMssqlConfig('sklad').cfg.password;

      for (const target of targets) {
        const input = req.body?.[target];
        if (!input || typeof input !== 'object') continue;

        const base = getEffectiveMssqlConfig(target).cfg;
        const server = String(input.server ?? base.server ?? '').trim();
        const rawPort = input.port !== undefined && input.port !== '' ? Number(input.port) : base.port;
        const port = Number.isInteger(rawPort) ? rawPort : NaN;
        const database = String(
          input.database ?? base.database ?? (target === 'sklad' ? 'SKLAD' : 'SaleData')
        ).trim();
        const user = String(input.user ?? base.user ?? '').trim();
        const encrypt = input.encrypt !== undefined ? Boolean(input.encrypt) : base.encrypt;
        const trustServerCertificate =
          input.trustServerCertificate !== undefined
            ? Boolean(input.trustServerCertificate)
            : base.trustServerCertificate;

        let password = base.password;
        if (typeof input.password === 'string' && input.password !== '') {
          password = input.password;
        } else if (target === 'saledata' && input.syncPasswordFromSklad) {
          password = resolvedSkladPassword;
        }

        if (target === 'sklad') {
          resolvedSkladPassword = password;
        }

        const validation = validateCustomMssqlConfig(target, {
          server,
          port,
          user,
          password,
          database,
          max: base.max,
          requestTimeoutMs: base.requestTimeoutMs,
          encrypt,
          trustServerCertificate,
        });

        if (!validation.valid) {
          throw validationError(validation.reason!);
        }

        toSave.push({
          target,
          server,
          port,
          database_name: database,
          username: user,
          password,
          encrypt,
          trust_server_certificate: trustServerCertificate,
        });
      }

      if (toSave.length === 0) {
        throw validationError('请至少提供 SKLAD 或 SaleData 的连接配置');
      }

      for (const item of toSave) {
        metaStore.upsertDbOverride(item.target, {
          server: item.server,
          port: item.port,
          database_name: item.database_name,
          username: item.username,
          password: item.password,
          encrypt: item.encrypt,
          trust_server_certificate: item.trust_server_certificate,
        });
      }

      await closeAllMssqlPools();

      const dbStatus =
        mode === 'sqlite-seed'
          ? {
              sklad: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SKLAD' } },
              saledata: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SaleData' } },
            }
          : {
              sklad: await probeMssqlTarget('sklad', { bypassCooldown: true }),
              saledata: await probeMssqlTarget('saledata', { bypassCooldown: true }),
            };

      sendSuccess(res, {
        dbMode: mode,
        sklad: getSanitizedDbConfig('sklad'),
        saledata: getSanitizedDbConfig('saledata'),
        dbStatus,
      });
    })
  );

  app.delete(
    '/api/ims/db-config',
    asyncHandler(async (_req, res) => {
      metaStore.clearAllDbOverrides();
      await closeAllMssqlPools();

      const dbStatus =
        mode === 'sqlite-seed'
          ? {
              sklad: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SKLAD' } },
              saledata: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SaleData' } },
            }
          : {
              sklad: await probeMssqlTarget('sklad', { bypassCooldown: true }),
              saledata: await probeMssqlTarget('saledata', { bypassCooldown: true }),
            };

      sendSuccess(res, {
        dbMode: mode,
        sklad: getSanitizedDbConfig('sklad'),
        saledata: getSanitizedDbConfig('saledata'),
        dbStatus,
      });
    })
  );

  app.use('/api/g1', createInventoryRouter(inventoryService));
  app.use('/api/stocktakes', createStocktakeRouter(stocktakeService));
  app.use('/api/sales', createSalesRouter(salesService));

  // Global error handler scoped to IMS /api/g1, /api/stocktakes, /api/sales, /api/ims paths
  app.use('/api/g1', apiErrorMiddleware);
  app.use('/api/stocktakes', apiErrorMiddleware);
  app.use('/api/sales', apiErrorMiddleware);
  app.use('/api/ims', apiErrorMiddleware);

  return {
    inventoryService,
    stocktakeService,
    salesService,
    metaStore,
    sandbox,
  };
}

export function createTestImsApp(options: MountImsOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  mountImsRoutes(app, options);
  return app;
}
