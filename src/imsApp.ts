import express, { Express, Request } from 'express';
import {
  MetaStore,
  StoreSessionInfo,
  UserSessionInfo,
  getMetaStore,
} from './core/db/metaStore';
import { SqliteSandbox, getSqliteSandbox } from './core/db/sqliteSandbox';
import {
  DbTarget,
  closeAllMssqlPools,
  getEffectiveMssqlConfig,
  getSanitizedDbConfig,
  isMssqlConfigured,
  probeMssqlTarget,
  runWithStoreContext,
  setMssqlOverrideStore,
  testMssqlConnection,
  validateCustomMssqlConfig,
} from './core/db/pool';
import {
  apiErrorMiddleware,
  asyncHandler,
  conflictError,
  forbiddenError,
  notFoundError,
  sendSuccess,
  unauthorizedError,
  validationError,
} from './core/http/envelope';
import {
  PermissionKey,
  ROLE_DEFAULT_PERMISSIONS,
  UserRole,
  canAccessStore,
  filterAccessibleStores,
  hasAnyPermission,
  hasPermission,
  isValidUserRole,
  normalizePermissions,
} from './core/auth/permissions';
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

export function extractBearerToken(req: Request): string {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function createUserAuthMiddleware(metaStore: MetaStore): express.RequestHandler {
  return (req, _res, next) => {
    const token = extractBearerToken(req);
    const session = metaStore.verifyUserSessionToken(token);
    if (!session) {
      return next(unauthorizedError('未登录或账户会话已过期，请先登录'));
    }
    (req as any).userSession = session;
    (req as any)._authToken = token;
    if (session.activeStore) {
      (req as any).storeSession = {
        storeId: session.activeStore.id,
        storeCode: session.activeStore.storeCode,
        storeName: session.activeStore.storeName,
        expiresAt: session.expiresAt,
      } satisfies StoreSessionInfo;
    }
    return next();
  };
}

export function createStoreSelectedMiddleware(metaStore: MetaStore): express.RequestHandler {
  return (req, _res, next) => {
    const session = (req as any).userSession as UserSessionInfo | undefined;
    if (!session) {
      return next(unauthorizedError('未登录或账户会话已过期，请先登录'));
    }
    if (!session.activeStore) {
      return next(forbiddenError('请先选择要操作的门店后再继续'));
    }
    return runWithStoreContext(session.activeStore.id, () => next(), metaStore);
  };
}

export function createDbStoreContextMiddleware(metaStore: MetaStore): express.RequestHandler {
  return (req, _res, next) => {
    const session = (req as any).userSession as UserSessionInfo | undefined;
    if (!session) {
      return next(unauthorizedError('未登录或账户会话已过期，请先登录'));
    }

    const rawStoreId = req.query.storeId ?? req.body?.storeId;
    let targetStore = session.activeStore;

    if (rawStoreId !== undefined && rawStoreId !== null && rawStoreId !== '') {
      const requestedId = Number(rawStoreId);
      if (!Number.isInteger(requestedId) || requestedId <= 0) {
        return next(validationError('无效的门店 ID'));
      }
      if (session.user.role !== 'admin') {
        if (!session.activeStore) {
          return next(forbiddenError('请先选择要操作的门店后再继续'));
        }
        if (session.activeStore.id !== requestedId) {
          return next(forbiddenError('当前账户无权直接切换配置其他门店'));
        }
      }
      const found = metaStore.getStoreById(requestedId);
      if (!found) {
        return next(notFoundError('门店不存在'));
      }
      if (!canAccessStore(session.user, found.id)) {
        return next(forbiddenError('当前账户未被分配访问该门店的权限'));
      }
      targetStore = found;
    } else if (!targetStore && session.user.role === 'admin') {
      targetStore = session.availableStores[0] || metaStore.listStores()[0] || null;
    }

    if (!targetStore) {
      return next(forbiddenError('请先选择要操作的门店后再继续'));
    }

    (req as any).storeSession = {
      storeId: targetStore.id,
      storeCode: targetStore.storeCode,
      storeName: targetStore.storeName,
      expiresAt: session.expiresAt,
    } satisfies StoreSessionInfo;

    return runWithStoreContext(targetStore.id, () => next(), metaStore);
  };
}

export function createPermissionMiddleware(
  required: PermissionKey | readonly PermissionKey[]
): express.RequestHandler {
  const list = Array.isArray(required) ? required : [required];
  return (req, _res, next) => {
    const session = (req as any).userSession as UserSessionInfo | undefined;
    if (!session) {
      return next(unauthorizedError('未登录或账户会话已过期，请先登录'));
    }
    if (!hasAnyPermission(session.user, list)) {
      return next(forbiddenError('当前账户无权执行此模块操作'));
    }
    return next();
  };
}

export function createAdminOnlyMiddleware(): express.RequestHandler {
  return (req, _res, next) => {
    const session = (req as any).userSession as UserSessionInfo | undefined;
    if (!session) {
      return next(unauthorizedError('未登录或账户会话已过期，请先登录'));
    }
    if (session.user.role !== 'admin') {
      return next(forbiddenError('仅系统管理员有权查看或修改门店数据库连接配置'));
    }
    return next();
  };
}

function normalizeAndValidateStoreInput(body: any) {
  const rawCode = String(body?.storeCode ?? '').trim().toUpperCase();
  const rawName = String(body?.storeName ?? '').trim();

  if (!/^[A-Z0-9_-]{2,24}$/.test(rawCode)) {
    throw validationError('门店编号仅支持 2–24 位字母、数字、下划线或连字符（如 NAM01）');
  }
  if (!rawName || rawName.length > 60) {
    throw validationError('门店名称不能为空且不超过 60 个字符');
  }

  return { storeCode: rawCode, storeName: rawName };
}

function validateUsernameAndPassword(
  body: any,
  options: { requireUsername?: boolean; requirePassword?: boolean } = {}
) {
  const username = body?.username !== undefined ? String(body.username).trim().toLowerCase() : undefined;
  const displayName =
    body?.displayName !== undefined ? String(body.displayName).trim() : undefined;
  const password = body?.password !== undefined ? String(body.password) : undefined;

  if (options.requireUsername) {
    if (!username || !/^[a-z0-9_.-]{2,32}$/.test(username)) {
      throw validationError('登录账号仅支持 2–32 位字母、数字、点、下划线或连字符');
    }
  }
  if (displayName !== undefined && (!displayName || displayName.length > 60)) {
    throw validationError('姓名 / 昵称不能为空且不超过 60 个字符');
  }
  if (options.requirePassword) {
    if (!password || password.length < 4 || password.length > 128) {
      throw validationError('登录密码长度需为 4–128 位字符');
    }
  } else if (password !== undefined && password !== '' && (password.length < 4 || password.length > 128)) {
    throw validationError('登录密码长度需为 4–128 位字符');
  }

  return { username, displayName, password };
}

function resolveValidatedStoreIds(metaStore: MetaStore, rawStoreIds: unknown): number[] {
  if (!Array.isArray(rawStoreIds)) return [];
  const validStoreIds = new Set(metaStore.listStores().map((s) => s.id));
  const result: number[] = [];
  for (const raw of rawStoreIds) {
    const id = Number(raw);
    if (Number.isInteger(id) && validStoreIds.has(id) && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
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

  const requireAuth = createUserAuthMiddleware(metaStore);
  const requireStoreSelected = createStoreSelectedMiddleware(metaStore);
  const requireAdminOnly = createAdminOnlyMiddleware();

  const attachRequestTiming: express.RequestHandler = (req, _res, next) => {
    (req as any)._startedAt = Date.now();
    next();
  };
  app.use(
    ['/api/g1', '/api/stocktakes', '/api/sales', '/api/ims', '/api/auth', '/api/stores', '/api/users'],
    attachRequestTiming
  );

  // ===== Public Account Auth & Store Selection Routes =====

  app.get('/api/auth/status', (req, res) => {
    const token = extractBearerToken(req);
    const session = token ? metaStore.verifyUserSessionToken(token) : null;
    sendSuccess(res, {
      initialized: metaStore.countUsers() > 0,
      hasStores: metaStore.countStores() > 0,
      authenticated: Boolean(session),
      user: session ? session.user : null,
      currentStore: session?.activeStore
        ? {
            id: session.activeStore.id,
            storeCode: session.activeStore.storeCode,
            storeName: session.activeStore.storeName,
          }
        : null,
      availableStores: session
        ? session.availableStores.map((s) => ({
            id: s.id,
            storeCode: s.storeCode,
            storeName: s.storeName,
          }))
        : [],
    });
  });

  app.post(
    '/api/auth/bootstrap',
    asyncHandler(async (req, res) => {
      if (metaStore.countUsers() > 0) {
        throw forbiddenError('系统已初始化管理员账户，请直接登录');
      }

      const { username, displayName, password } = validateUsernameAndPassword(req.body, {
        requireUsername: true,
        requirePassword: true,
      });

      const existingStores = metaStore.listStores();
      let primaryStore = existingStores[0] || null;
      if (!primaryStore) {
        const { storeCode, storeName } = normalizeAndValidateStoreInput(req.body);
        primaryStore = metaStore.createStore({ storeCode, storeName });
        metaStore.migrateLegacyOverridesToStore(primaryStore.id);
      }

      const allStoreIds = metaStore.listStores().map((s) => s.id);
      const adminUser = metaStore.createUser({
        username: username!,
        displayName: displayName || username!,
        password: password!,
        role: 'admin',
        permissions: [...ROLE_DEFAULT_PERMISSIONS.admin],
        allStores: true,
        assignedStoreIds: allStoreIds,
        isActive: true,
      });

      // Admin manages accounts, permissions, and per-store SQL settings without entering a store
      const session = metaStore.createUserSession(adminUser.id, null);
      const availableStores = filterAccessibleStores(adminUser, metaStore.listStores());

      sendSuccess(
        res,
        {
          token: session.token,
          expiresAt: session.expiresAt,
          user: adminUser,
          currentStore: null,
          availableStores: availableStores.map((s) => ({
            id: s.id,
            storeCode: s.storeCode,
            storeName: s.storeName,
          })),
        },
        201
      );
    })
  );

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const username = String(req.body?.username ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!username || !password) {
        throw validationError('请输入登录账号和密码');
      }
      const user = metaStore.authenticateUser(username, password);
      if (!user) {
        throw unauthorizedError('账号或密码错误，或账号已被停用');
      }

      // After login, activeStore starts null so the user picks a store on the Store Selection screen
      const session = metaStore.createUserSession(user.id, null);
      const availableStores = filterAccessibleStores(user, metaStore.listStores());

      sendSuccess(res, {
        token: session.token,
        expiresAt: session.expiresAt,
        user,
        currentStore: null,
        availableStores: availableStores.map((s) => ({
          id: s.id,
          storeCode: s.storeCode,
          storeName: s.storeName,
        })),
      });
    })
  );

  app.post(
    '/api/auth/select-store',
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const token = String((req as any)._authToken || '');
      const rawStoreId = req.body?.storeId;

      if (session.user.role === 'admin' && rawStoreId !== null) {
        throw forbiddenError('系统管理员无需选择进入门店，请直接在设置中管理各门店 SQL 连接与账户权限');
      }

      if (rawStoreId === null) {
        metaStore.setSessionActiveStore(token, null);
        const refreshed = metaStore.verifyUserSessionToken(token)!;
        return sendSuccess(res, {
          user: refreshed.user,
          currentStore: null,
          availableStores: refreshed.availableStores.map((s) => ({
            id: s.id,
            storeCode: s.storeCode,
            storeName: s.storeName,
          })),
        });
      }

      const storeId = Number(rawStoreId);
      if (!Number.isInteger(storeId) || storeId <= 0) {
        throw validationError('无效的门店 ID');
      }
      const store = metaStore.getStoreById(storeId);
      if (!store) {
        throw notFoundError('门店不存在');
      }
      if (!canAccessStore(session.user, storeId)) {
        throw forbiddenError('当前账户未被分配访问该门店的权限');
      }

      metaStore.setSessionActiveStore(token, store.id);
      const refreshed = metaStore.verifyUserSessionToken(token)!;

      sendSuccess(res, {
        user: refreshed.user,
        currentStore: {
          id: store.id,
          storeCode: store.storeCode,
          storeName: store.storeName,
        },
        availableStores: refreshed.availableStores.map((s) => ({
          id: s.id,
          storeCode: s.storeCode,
          storeName: s.storeName,
        })),
      });
    })
  );

  app.post('/api/auth/logout', (req, res) => {
    const token = extractBearerToken(req);
    if (token) {
      metaStore.revokeUserSessionToken(token);
    }
    sendSuccess(res, { loggedOut: true });
  });

  app.post(
    '/api/auth/change-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const currentToken = String((req as any)._authToken || '');
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword =
        typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (!currentPassword) {
        throw validationError('请输入当前登录密码');
      }
      if (!metaStore.verifyUserPassword(session.user.id, currentPassword)) {
        throw validationError('当前登录密码不正确');
      }
      if (newPassword.length < 4 || newPassword.length > 128) {
        throw validationError('新密码长度需为 4–128 位字符');
      }

      metaStore.updateUser(session.user.id, {
        password: newPassword,
        keepToken: currentToken,
      });

      sendSuccess(res, { changed: true });
    })
  );

  // ===== Protected User Account, Role & Store Assignment Management =====

  app.get(
    '/api/users',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    (_req, res) => {
      sendSuccess(res, {
        rows: metaStore.listUsers(),
      });
    }
  );

  app.post(
    '/api/users',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const { username, displayName, password } = validateUsernameAndPassword(req.body, {
        requireUsername: true,
        requirePassword: true,
      });

      if (metaStore.getUserByUsername(username!)) {
        throw conflictError(`账号 ${username} 已存在`);
      }

      const role: UserRole = isValidUserRole(req.body?.role) ? req.body.role : 'staff';
      const permissions = normalizePermissions(req.body?.permissions, role);
      const allStores = Boolean(req.body?.allStores);
      const assignedStoreIds = resolveValidatedStoreIds(metaStore, req.body?.assignedStoreIds);
      const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

      const created = metaStore.createUser({
        username: username!,
        displayName: displayName || username!,
        password: password!,
        role,
        permissions,
        allStores,
        assignedStoreIds,
        isActive,
      });

      sendSuccess(res, created, 201);
    })
  );

  app.patch(
    '/api/users/:id',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw validationError('无效的账号 ID');
      }
      const existing = metaStore.getUserById(id);
      if (!existing) {
        throw notFoundError('账户不存在');
      }

      const { displayName, password } = validateUsernameAndPassword(req.body, {
        requireUsername: false,
        requirePassword: false,
      });

      const nextRole: UserRole =
        req.body?.role !== undefined
          ? isValidUserRole(req.body.role)
            ? req.body.role
            : (() => {
                throw validationError('无效的角色类型');
              })()
          : existing.role;
      const nextPermissions = normalizePermissions(
        req.body?.permissions !== undefined ? req.body.permissions : existing.permissions,
        nextRole
      );
      const nextAllStores =
        req.body?.allStores !== undefined ? Boolean(req.body.allStores) : existing.allStores;
      const nextAssignedStoreIds =
        req.body?.assignedStoreIds !== undefined
          ? resolveValidatedStoreIds(metaStore, req.body.assignedStoreIds)
          : existing.assignedStoreIds;
      const nextIsActive =
        req.body?.isActive !== undefined ? Boolean(req.body.isActive) : existing.isActive;

      const wasManagerAdmin =
        existing.isActive &&
        existing.role === 'admin' &&
        existing.permissions.includes('user_mgmt');
      const remainsManagerAdmin =
        nextIsActive && nextRole === 'admin' && nextPermissions.includes('user_mgmt');

      if (wasManagerAdmin && !remainsManagerAdmin) {
        if (metaStore.countActiveAdminsWithUserMgmt(id) === 0) {
          throw validationError('系统至少需要保留一名启用且拥有账户管理权限的管理员');
        }
      }

      const keepToken = id === session.user.id ? String((req as any)._authToken || '') : undefined;
      const updated = metaStore.updateUser(id, {
        displayName,
        password,
        role: nextRole,
        permissions: nextPermissions,
        allStores: nextAllStores,
        assignedStoreIds: nextAssignedStoreIds,
        isActive: nextIsActive,
        keepToken,
      });

      sendSuccess(res, updated);
    })
  );

  app.delete(
    '/api/users/:id',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw validationError('无效的账号 ID');
      }
      if (id === session.user.id) {
        throw validationError('不能删除当前正在登录的账户');
      }
      const existing = metaStore.getUserById(id);
      if (!existing) {
        throw notFoundError('账户不存在');
      }
      const isManagerAdmin =
        existing.isActive &&
        existing.role === 'admin' &&
        existing.permissions.includes('user_mgmt');
      if (isManagerAdmin && metaStore.countActiveAdminsWithUserMgmt(id) === 0) {
        throw validationError('不能删除系统最后一名管理员账户');
      }

      metaStore.deleteUser(id);
      sendSuccess(res, { deleted: true });
    })
  );

  // ===== Protected Multi-Store Management Routes =====

  app.get('/api/stores', requireAuth, (req, res) => {
    const session = (req as any).userSession as UserSessionInfo;
    const canManageAll = hasPermission(session.user, 'user_mgmt');
    const sourceStores = canManageAll ? metaStore.listStores() : session.availableStores;

    const rows = sourceStores.map((s) => {
      const skladCfg = metaStore.getDbOverride('sklad', s.id);
      const saleCfg = metaStore.getDbOverride('saledata', s.id);
      return {
        id: s.id,
        storeCode: s.storeCode,
        storeName: s.storeName,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isCurrent: s.id === session.activeStore?.id,
        hasSkladConfig: Boolean(skladCfg?.server),
        hasSaleDataConfig: Boolean(saleCfg?.server),
      };
    });
    sendSuccess(res, {
      currentStoreId: session.activeStore?.id ?? null,
      rows,
    });
  });

  app.post(
    '/api/stores',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const { storeCode, storeName } = normalizeAndValidateStoreInput(req.body);

      if (metaStore.getStoreByCode(storeCode)) {
        throw conflictError(`门店编号 ${storeCode} 已存在`);
      }

      const created = metaStore.createStore({ storeCode, storeName });
      const sourceStoreId = Number(req.body?.copyFromStoreId || session.activeStore?.id || 0);
      if (req.body?.copyDbFromCurrent && Number.isInteger(sourceStoreId) && sourceStoreId > 0) {
        metaStore.cloneStoreDbConfigs(sourceStoreId, created.id);
      }

      sendSuccess(
        res,
        {
          id: created.id,
          storeCode: created.storeCode,
          storeName: created.storeName,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
        201
      );
    })
  );

  app.patch(
    '/api/stores/:id',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw validationError('无效的门店 ID');
      }
      const existing = metaStore.getStoreById(id);
      if (!existing) {
        throw notFoundError('门店不存在');
      }

      const storeName =
        req.body?.storeName !== undefined ? String(req.body.storeName).trim() : existing.storeName;
      if (!storeName || storeName.length > 60) {
        throw validationError('门店名称不能为空且不超过 60 个字符');
      }

      const updated = metaStore.updateStore(id, { storeName });
      sendSuccess(res, updated);
    })
  );

  app.delete(
    '/api/stores/:id',
    requireAuth,
    createPermissionMiddleware('user_mgmt'),
    asyncHandler(async (req, res) => {
      const session = (req as any).userSession as UserSessionInfo;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw validationError('无效的门店 ID');
      }
      if (session.activeStore && id === session.activeStore.id) {
        throw validationError('不能删除当前正在操作的门店，请先切换到其他门店后再删除');
      }
      if (metaStore.countStores() <= 1) {
        throw validationError('至少需要保留一家门店');
      }
      const deleted = metaStore.deleteStore(id);
      if (!deleted) {
        throw notFoundError('门店不存在');
      }
      await closeAllMssqlPools(id);
      sendSuccess(res, { deleted: true });
    })
  );

  // ===== Protected Runtime Context & Per-Store DB Config Endpoints =====

  const resolveDbStoreContext = createDbStoreContextMiddleware(metaStore);

  app.get(
    '/api/ims/context',
    requireAuth,
    resolveDbStoreContext,
    asyncHandler(async (req, res) => {
      const userSession = (req as any).userSession as UserSessionInfo;
      const isAdmin = userSession.user.role === 'admin';
      const session = (req as any).storeSession as StoreSessionInfo;
      const bypassCooldown = req.query.recheck === '1';
      const rawDbStatus =
        mode === 'sqlite-seed'
          ? {
              sklad: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SKLAD' } },
              saledata: { ok: true, targetInfo: { server: 'sqlite-seed', port: 0, database: 'SaleData' } },
            }
          : {
              sklad: await probeMssqlTarget('sklad', { bypassCooldown }),
              saledata: await probeMssqlTarget('saledata', { bypassCooldown }),
            };

      const sanitizeTargetStatus = (st: typeof rawDbStatus.sklad) =>
        isAdmin
          ? st
          : {
              ok: st.ok,
              ...(st.errorCode ? { errorCode: st.errorCode } : {}),
              ...(!st.ok
                ? { reason: '当前门店数据库暂不可用，请联系系统管理员处理' }
                : {}),
            };

      sendSuccess(res, {
        dbMode: mode,
        store: {
          id: session.storeId,
          storeCode: session.storeCode,
          storeName: session.storeName,
        },
        mssqlConfigured: {
          sklad: isMssqlConfigured('sklad'),
          saledata: isMssqlConfigured('saledata'),
        },
        dbStatus: {
          sklad: sanitizeTargetStatus(rawDbStatus.sklad),
          saledata: sanitizeTargetStatus(rawDbStatus.saledata),
        },
        timezone: 'Europe/Bratislava',
        currency: 'EUR',
        vatRate: 0.23,
      });
    })
  );

  app.get(
    '/api/ims/db-config',
    requireAuth,
    requireAdminOnly,
    createPermissionMiddleware('db_settings'),
    resolveDbStoreContext,
    (req, res) => {
      const session = (req as any).storeSession as StoreSessionInfo;
      sendSuccess(res, {
        dbMode: mode,
        store: {
          id: session.storeId,
          storeCode: session.storeCode,
          storeName: session.storeName,
        },
        sklad: getSanitizedDbConfig('sklad'),
        saledata: getSanitizedDbConfig('saledata'),
      });
    }
  );

  app.post(
    '/api/ims/db-config/test',
    requireAuth,
    requireAdminOnly,
    createPermissionMiddleware('db_settings'),
    resolveDbStoreContext,
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
    requireAuth,
    requireAdminOnly,
    createPermissionMiddleware('db_settings'),
    resolveDbStoreContext,
    asyncHandler(async (req, res) => {
      const session = (req as any).storeSession as StoreSessionInfo;
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
        metaStore.upsertDbOverride(
          item.target,
          {
            server: item.server,
            port: item.port,
            database_name: item.database_name,
            username: item.username,
            password: item.password,
            encrypt: item.encrypt,
            trust_server_certificate: item.trust_server_certificate,
          },
          session.storeId
        );
      }

      await closeAllMssqlPools(session.storeId);

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
        store: {
          id: session.storeId,
          storeCode: session.storeCode,
          storeName: session.storeName,
        },
        sklad: getSanitizedDbConfig('sklad'),
        saledata: getSanitizedDbConfig('saledata'),
        dbStatus,
      });
    })
  );

  app.delete(
    '/api/ims/db-config',
    requireAuth,
    requireAdminOnly,
    createPermissionMiddleware('db_settings'),
    resolveDbStoreContext,
    asyncHandler(async (req, res) => {
      const session = (req as any).storeSession as StoreSessionInfo;
      metaStore.clearAllDbOverrides(session.storeId);
      await closeAllMssqlPools(session.storeId);

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
        store: {
          id: session.storeId,
          storeCode: session.storeCode,
          storeName: session.storeName,
        },
        sklad: getSanitizedDbConfig('sklad'),
        saledata: getSanitizedDbConfig('saledata'),
        dbStatus,
      });
    })
  );

  // Inventory routes: single-barcode lookup allowed for both inventory & stocktake; other g1 routes require inventory
  const g1PermissionGuard: express.RequestHandler = (req, res, next) => {
    if (req.method === 'GET' && /^\/products\/[^/]+$/.test(req.path)) {
      return createPermissionMiddleware(['inventory', 'stocktake'])(req, res, next);
    }
    return createPermissionMiddleware('inventory')(req, res, next);
  };

  app.use('/api/g1', requireAuth, g1PermissionGuard, requireStoreSelected, createInventoryRouter(inventoryService));
  app.use('/api/stocktakes', requireAuth, createPermissionMiddleware('stocktake'), requireStoreSelected, createStocktakeRouter(stocktakeService));
  app.use('/api/sales', requireAuth, createPermissionMiddleware('sales'), requireStoreSelected, createSalesRouter(salesService));

  // Global error handler scoped to protected API paths
  app.use('/api/g1', apiErrorMiddleware);
  app.use('/api/stocktakes', apiErrorMiddleware);
  app.use('/api/sales', apiErrorMiddleware);
  app.use('/api/ims', apiErrorMiddleware);
  app.use('/api/auth', apiErrorMiddleware);
  app.use('/api/stores', apiErrorMiddleware);
  app.use('/api/users', apiErrorMiddleware);

  return {
    inventoryService,
    stocktakeService,
    salesService,
    metaStore,
    sandbox,
    requireAuth,
    requireStoreSelected,
    requireReceivingAuth: [requireAuth, createPermissionMiddleware('receiving'), requireStoreSelected] as express.RequestHandler[],
  };
}

export function createTestImsApp(options: MountImsOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  mountImsRoutes(app, options);
  return app;
}
