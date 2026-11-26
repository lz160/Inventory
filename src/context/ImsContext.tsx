import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ImsLang, TRANSLATIONS, TranslationKey } from '../i18n/translations';
import {
  ImsApiError,
  imsFetch,
  setImsAuthToken,
  setUnauthorizedHandler,
} from '../utils/imsApi';

import {
  PermissionKey,
  UserRole,
  hasAnyPermission,
  hasPermission,
} from '../core/auth/permissions';

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface DbTargetStatus {
  ok: boolean;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST' | 'UNREACHABLE';
  reason?: string;
  targetInfo?: {
    server: string;
    port: number;
    database: string;
  };
}

export interface StoreSummary {
  id: number;
  storeCode: string;
  storeName: string;
}

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: PermissionKey[];
  allStores: boolean;
  assignedStoreIds: number[];
  isActive: boolean;
}

interface ImsContextValue {
  lang: ImsLang;
  setLang: (lang: ImsLang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
  // User Account, RBAC Permissions & Post-Login Store Selection
  authReady: boolean;
  initialized: boolean;
  hasStores: boolean;
  user: UserSummary | null;
  availableStores: StoreSummary[];
  currentStore: StoreSummary | null;
  hasPerm: (perm: PermissionKey) => boolean;
  hasAnyPerm: (perms: readonly PermissionKey[]) => boolean;
  refreshAuthStatus: () => Promise<void>;
  bootstrapAccount: (input: {
    username: string;
    displayName: string;
    password: string;
    storeCode?: string;
    storeName?: string;
  }) => Promise<void>;
  loginAccount: (input: { username: string; password: string }) => Promise<void>;
  selectStore: (storeId: number | null) => Promise<void>;
  logout: () => Promise<void>;
  // Database runtime context
  dbMode: 'mssql' | 'sqlite-seed';
  dbContextReady: boolean;
  checkingDb: boolean;
  mssqlConfigured: { sklad: boolean; saledata: boolean };
  dbStatus: { sklad: DbTargetStatus; saledata: DbTargetStatus };
  refreshContext: (recheck?: boolean, storeId?: number | null) => Promise<void>;
  updateDbStatus: (
    nextStatus: { sklad: DbTargetStatus; saledata: DbTargetStatus },
    configured?: { sklad: boolean; saledata: boolean }
  ) => void;
  openSettings: () => void;
  registerSettingsNavigator: (fn: () => void) => void;
  apiCall: <T>(url: string, options?: RequestInit) => Promise<T>;
  toasts: ToastItem[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: number) => void;
}

const ImsContext = createContext<ImsContextValue | null>(null);

export const ImsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<ImsLang>(() => {
    try {
      const saved = localStorage.getItem('ims_lang');
      return saved === 'sk' ? 'sk' : 'zh';
    } catch {
      return 'zh';
    }
  });

  const [authReady, setAuthReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [hasStores, setHasStores] = useState(false);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [availableStores, setAvailableStores] = useState<StoreSummary[]>([]);
  const [currentStore, setCurrentStore] = useState<StoreSummary | null>(null);

  const [dbMode, setDbMode] = useState<'mssql' | 'sqlite-seed'>('mssql');
  const [dbContextReady, setDbContextReady] = useState(false);
  const [checkingDb, setCheckingDb] = useState(false);
  const [mssqlConfigured, setMssqlConfigured] = useState<{ sklad: boolean; saledata: boolean }>({
    sklad: false,
    saledata: false,
  });
  const [dbStatus, setDbStatus] = useState<{ sklad: DbTargetStatus; saledata: DbTargetStatus }>({
    sklad: { ok: false },
    saledata: { ok: false },
  });

  const settingsNavigatorRef = useRef<(() => void) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const setLang = useCallback((next: ImsLang) => {
    setLangState(next);
    try {
      localStorage.setItem('ims_lang', next);
    } catch {}
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'zh' ? 'sk' : 'zh');
  }, [lang, setLang]);

  const t = useCallback(
    (key: TranslationKey) => {
      return TRANSLATIONS[lang][key] || TRANSLATIONS.zh[key];
    },
    [lang]
  );

  const hasPerm = useCallback(
    (perm: PermissionKey) => hasPermission(user, perm),
    [user]
  );

  const hasAnyPerm = useCallback(
    (perms: readonly PermissionKey[]) => hasAnyPermission(user, perms),
    [user]
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-1), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }, []);

  const apiCall = useCallback(async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
    return imsFetch<T>(url, options);
  }, []);

  const updateDbStatus = useCallback(
    (
      nextStatus: { sklad: DbTargetStatus; saledata: DbTargetStatus },
      configured?: { sklad: boolean; saledata: boolean }
    ) => {
      setDbStatus(nextStatus);
      if (configured) {
        setMssqlConfigured(configured);
      }
      setDbContextReady(true);
    },
    []
  );

  const registerSettingsNavigator = useCallback((fn: () => void) => {
    settingsNavigatorRef.current = fn;
  }, []);

  const openSettings = useCallback(() => {
    settingsNavigatorRef.current?.();
  }, []);

  const refreshContext = useCallback(async (recheck = false, storeId?: number | null) => {
    setCheckingDb(true);
    try {
      const params = new URLSearchParams();
      if (recheck) params.set('recheck', '1');
      if (storeId && Number.isInteger(storeId) && storeId > 0) {
        params.set('storeId', String(storeId));
      }
      const qs = params.toString();
      const url = qs ? `/api/ims/context?${qs}` : '/api/ims/context';
      const ctx = await imsFetch<{
        dbMode: 'mssql' | 'sqlite-seed';
        mssqlConfigured: { sklad: boolean; saledata: boolean };
        dbStatus?: { sklad: DbTargetStatus; saledata: DbTargetStatus };
      }>(url);
      setDbMode(ctx.dbMode);
      setMssqlConfigured(ctx.mssqlConfigured);
      if (ctx.dbStatus) {
        setDbStatus(ctx.dbStatus);
      } else {
        setDbStatus({
          sklad: { ok: ctx.dbMode === 'sqlite-seed' || ctx.mssqlConfigured.sklad },
          saledata: { ok: ctx.dbMode === 'sqlite-seed' || ctx.mssqlConfigured.saledata },
        });
      }
    } catch {
      // ignore context check failure
    } finally {
      setDbContextReady(true);
      setCheckingDb(false);
    }
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await imsFetch<{
        initialized: boolean;
        hasStores: boolean;
        authenticated: boolean;
        user: UserSummary | null;
        currentStore: StoreSummary | null;
        availableStores: StoreSummary[];
      }>('/api/auth/status');
      setInitialized(status.initialized);
      setHasStores(status.hasStores);
      setUser(status.authenticated ? status.user : null);
      setAvailableStores(status.authenticated ? status.availableStores : []);
      setCurrentStore(status.authenticated ? status.currentStore : null);
    } catch {
      // ignore
    } finally {
      setAuthReady(true);
    }
  }, []);

  const bootstrapAccount = useCallback(
    async (input: {
      username: string;
      displayName: string;
      password: string;
      storeCode?: string;
      storeName?: string;
    }) => {
      const res = await imsFetch<{
        token: string;
        user: UserSummary;
        currentStore: StoreSummary | null;
        availableStores: StoreSummary[];
      }>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setImsAuthToken(res.token);
      setUser(res.user);
      setAvailableStores(res.availableStores);
      setCurrentStore(res.currentStore);
      setInitialized(true);
      setHasStores(true);
      setDbContextReady(false);
      if (res.currentStore || res.user.role === 'admin') {
        await refreshContext(true);
      }
    },
    [refreshContext]
  );

  const loginAccount = useCallback(
    async (input: { username: string; password: string }) => {
      const res = await imsFetch<{
        token: string;
        user: UserSummary;
        currentStore: StoreSummary | null;
        availableStores: StoreSummary[];
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setImsAuthToken(res.token);
      setUser(res.user);
      setAvailableStores(res.availableStores);
      setCurrentStore(res.currentStore);
      setInitialized(true);
      setDbContextReady(false);
      if (res.user.role === 'admin') {
        await refreshContext(true);
      }
    },
    [refreshContext]
  );

  const selectStore = useCallback(
    async (storeId: number | null) => {
      const res = await imsFetch<{
        user: UserSummary;
        currentStore: StoreSummary | null;
        availableStores: StoreSummary[];
      }>('/api/auth/select-store', {
        method: 'POST',
        body: JSON.stringify({ storeId }),
      });
      setUser(res.user);
      setAvailableStores(res.availableStores);
      setCurrentStore(res.currentStore);
      setDbContextReady(false);
      if (res.currentStore) {
        await refreshContext(true);
      }
    },
    [refreshContext]
  );

  const logout = useCallback(async () => {
    try {
      await imsFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // best effort
    } finally {
      setImsAuthToken(null);
      setUser(null);
      setAvailableStores([]);
      setCurrentStore(null);
      setDbContextReady(false);
      await refreshAuthStatus();
    }
  }, [refreshAuthStatus]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setAvailableStores([]);
      setCurrentStore(null);
      setDbContextReady(false);
      showToast(
        lang === 'zh' ? '登录会话已失效，请重新登录账户' : 'Relácia vypršala, prihláste sa znova',
        'error'
      );
      refreshAuthStatus();
    });
    return () => setUnauthorizedHandler(null);
  }, [lang, refreshAuthStatus, showToast]);

  useEffect(() => {
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  return (
    <ImsContext.Provider
      value={{
        lang,
        setLang,
        toggleLang,
        t,
        authReady,
        initialized,
        hasStores,
        user,
        availableStores,
        currentStore,
        hasPerm,
        hasAnyPerm,
        refreshAuthStatus,
        bootstrapAccount,
        loginAccount,
        selectStore,
        logout,
        dbMode,
        dbContextReady,
        checkingDb,
        mssqlConfigured,
        dbStatus,
        refreshContext,
        updateDbStatus,
        openSettings,
        registerSettingsNavigator,
        apiCall,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
      {/* Floating Toast Container */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-20 right-3 sm:right-4 z-[90] flex flex-col items-end gap-1.5 w-auto max-w-[calc(100vw-1.5rem)] sm:max-w-xs pointer-events-none"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`pointer-events-auto cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium shadow-md transition-all ${
                toast.type === 'error'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : toast.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-white text-slate-800 border-slate-200'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </ImsContext.Provider>
  );
};

export function useIms() {
  const ctx = useContext(ImsContext);
  if (!ctx) {
    throw new Error('useIms must be used inside ImsProvider');
  }
  return ctx;
}

export function isConflict40901(err: unknown): boolean {
  return err instanceof ImsApiError && err.code === 40901;
}
