import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ImsLang, TRANSLATIONS, TranslationKey } from '../i18n/translations';
import { ImsApiError, imsFetch } from '../utils/imsApi';

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

interface ImsContextValue {
  lang: ImsLang;
  setLang: (lang: ImsLang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
  dbMode: 'mssql' | 'sqlite-seed';
  dbContextReady: boolean;
  checkingDb: boolean;
  mssqlConfigured: { sklad: boolean; saledata: boolean };
  dbStatus: { sklad: DbTargetStatus; saledata: DbTargetStatus };
  refreshContext: (recheck?: boolean) => Promise<void>;
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

  const [dbMode, setDbMode] = useState<'mssql' | 'sqlite-seed'>('mssql');
  const [dbContextReady, setDbContextReady] = useState(false);
  const [checkingDb, setCheckingDb] = useState(true);
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

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
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

  const refreshContext = useCallback(async (recheck = false) => {
    setCheckingDb(true);
    try {
      const url = recheck ? '/api/ims/context?recheck=1' : '/api/ims/context';
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

  useEffect(() => {
    refreshContext(false);
  }, [refreshContext]);

  return (
    <ImsContext.Provider
      value={{
        lang,
        setLang,
        toggleLang,
        t,
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
          className="fixed top-14 right-4 z-[90] flex flex-col gap-2 max-w-xs w-full pointer-events-none"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`pointer-events-auto cursor-pointer rounded-lg border px-3.5 py-2.5 text-xs font-medium shadow-lg transition-all ${
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
