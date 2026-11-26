import React, { useState } from 'react';
import {
  Store,
  ArrowRight,
  LogOut,
  Languages,
  Building2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';

export const StoreSelectScreen: React.FC = () => {
  const {
    lang,
    toggleLang,
    t,
    user,
    availableStores,
    selectStore,
    logout,
    showToast,
  } = useIms();
  const [selectingId, setSelectingId] = useState<number | null>(null);

  if (!user) return null;

  const roleLabel =
    user.role === 'admin'
      ? t('userRoleAdmin')
      : user.role === 'manager'
      ? t('userRoleManager')
      : t('userRoleStaff');

  const handleEnterStore = async (storeId: number, storeName: string) => {
    setSelectingId(storeId);
    try {
      await selectStore(storeId);
      showToast(
        lang === 'zh' ? `已进入门店：${storeName}` : `Aktívna predajňa: ${storeName}`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '进入门店失败', 'error');
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <div
      className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center px-4 py-8"
      data-testid="post-login-store-select-screen"
    >
      <div className="w-full max-w-2xl space-y-4">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-900 truncate">{t('appTitle')}</h1>
              <p className="text-xs text-slate-500 truncate">
                {user.displayName} ({user.username}) · {roleLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'zh' ? '中文' : 'SK'}</span>
            </button>
          </div>
        </div>

        {/* Store Selection Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900">{t('storeSelectTitle')}</h2>
            <p className="text-xs text-slate-500 leading-relaxed">{t('storeSelectSubtitle')}</p>
          </div>

          {availableStores.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-6 text-center space-y-2">
              <ShieldAlert className="w-7 h-7 text-amber-600 mx-auto" />
              <div className="text-sm font-bold text-slate-900">{t('storeSelectEmptyTitle')}</div>
              <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                {t('storeSelectEmptyDesc')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableStores.map((store) => {
                const isLoading = selectingId === store.id;
                return (
                  <button
                    key={store.id}
                    type="button"
                    data-testid={`select-store-card-${store.storeCode}`}
                    disabled={selectingId !== null}
                    onClick={() => handleEnterStore(store.id, store.storeName)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-500 hover:bg-indigo-50/40 transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <Store className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {store.storeName}
                        </div>
                        <div className="text-xs font-mono-numbers text-slate-500 mt-0.5">
                          {store.storeCode}
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 shrink-0 whitespace-nowrap">
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>{t('storeEnterBtn')}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Full-width red logout button at bottom */}
        <button
          type="button"
          data-testid="store-select-logout-btn"
          onClick={() => logout()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-xs font-semibold text-white shadow-2xs transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{t('authLogoutBtn')}</span>
        </button>
      </div>
    </div>
  );
};
