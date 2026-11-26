import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Store,
  Plus,
  PencilLine,
  Trash2,
  Database,
  Loader2,
  Languages,
  LogOut,
  ChevronRight,
  Building2,
} from 'lucide-react';
import { StoreSummary, useIms } from '../../context/ImsContext';
import { AccountMgmtPanel } from './AccountMgmtPanel';
import { StoreSqlConfigPanel } from './StoreSqlConfigPanel';

type AdminSidebarTab = 'accounts' | 'stores';

interface StoreRow {
  id: number;
  storeCode: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
  hasSkladConfig: boolean;
  hasSaleDataConfig: boolean;
}

export const AdminWorkspace: React.FC = () => {
  const { lang, toggleLang, t, user, apiCall, showToast, logout, refreshAuthStatus } = useIms();

  const [activeTab, setActiveTab] = useState<AdminSidebarTab>('accounts');
  const [storeRows, setStoreRows] = useState<StoreRow[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [debuggingStoreId, setDebuggingStoreId] = useState<number | null>(null);

  const [isAddStoreOpen, setIsAddStoreOpen] = useState(false);
  const [addStoreForm, setAddStoreForm] = useState({
    storeCode: '',
    storeName: '',
    copyDbFromCurrent: false,
    copyFromStoreId: 0,
  });
  const [addingStore, setAddingStore] = useState(false);

  const [editingStore, setEditingStore] = useState<StoreRow | null>(null);
  const [editStoreForm, setEditStoreForm] = useState({ storeName: '' });
  const [savingStoreEdit, setSavingStoreEdit] = useState(false);
  const [confirmDeleteStoreId, setConfirmDeleteStoreId] = useState<number | null>(null);

  const loadStores = useCallback(async () => {
    setLoadingStores(true);
    try {
      const res = await apiCall<{ rows: StoreRow[] }>('/api/stores');
      setStoreRows(res.rows);
      setDebuggingStoreId((prev) =>
        prev && res.rows.some((r) => r.id === prev) ? prev : null
      );
      setAddStoreForm((prev) => ({
        ...prev,
        copyFromStoreId:
          prev.copyFromStoreId && res.rows.some((r) => r.id === prev.copyFromStoreId)
            ? prev.copyFromStoreId
            : res.rows[0]?.id || 0,
      }));
    } catch (err: any) {
      showToast(err?.message || '读取门店列表失败', 'error');
    } finally {
      setLoadingStores(false);
    }
  }, [apiCall, showToast]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const debuggingStore: StoreSummary | null =
    debuggingStoreId !== null
      ? storeRows.find((s) => s.id === debuggingStoreId) || null
      : null;

  const handleSelectSidebarTab = (tab: AdminSidebarTab) => {
    setActiveTab(tab);
    if (tab === 'stores') {
      setDebuggingStoreId(null);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingStore(true);
    try {
      await apiCall('/api/stores', {
        method: 'POST',
        body: JSON.stringify({
          storeCode: addStoreForm.storeCode.trim().toUpperCase(),
          storeName: addStoreForm.storeName.trim(),
          copyDbFromCurrent: addStoreForm.copyDbFromCurrent,
          ...(addStoreForm.copyDbFromCurrent && addStoreForm.copyFromStoreId
            ? { copyFromStoreId: addStoreForm.copyFromStoreId }
            : {}),
        }),
      });
      setAddStoreForm((prev) => ({
        storeCode: '',
        storeName: '',
        copyDbFromCurrent: false,
        copyFromStoreId: prev.copyFromStoreId,
      }));
      setIsAddStoreOpen(false);
      await Promise.all([loadStores(), refreshAuthStatus()]);
      showToast(lang === 'zh' ? '门店已新增' : 'Predajňa pridaná', 'success');
    } catch (err: any) {
      showToast(err?.message || '新增门店失败', 'error');
    } finally {
      setAddingStore(false);
    }
  };

  const handleUpdateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStore) return;
    setSavingStoreEdit(true);
    try {
      await apiCall(`/api/stores/${editingStore.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          storeName: editStoreForm.storeName.trim(),
        }),
      });
      setEditingStore(null);
      await Promise.all([loadStores(), refreshAuthStatus()]);
      showToast(lang === 'zh' ? '门店信息已更新' : 'Predajňa aktualizovaná', 'success');
    } catch (err: any) {
      showToast(err?.message || '修改门店信息失败', 'error');
    } finally {
      setSavingStoreEdit(false);
    }
  };

  const handleDeleteStore = async (id: number) => {
    try {
      await apiCall(`/api/stores/${id}`, { method: 'DELETE' });
      setConfirmDeleteStoreId(null);
      if (debuggingStoreId === id) {
        setDebuggingStoreId(null);
      }
      await Promise.all([loadStores(), refreshAuthStatus()]);
      showToast(lang === 'zh' ? '门店已删除' : 'Predajňa vymazaná', 'success');
    } catch (err: any) {
      showToast(err?.message || '删除门店失败', 'error');
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-slate-50 flex text-slate-900 overflow-hidden">
      {/* Left Sidebar Navigation (Admin only) */}
      <aside
        data-testid="admin-sidebar"
        className="hidden md:flex w-60 shrink-0 flex-col justify-between bg-white border-r border-slate-200"
      >
        <div className="p-4 space-y-5">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">{t('adminConsoleTitle')}</div>
              <div className="text-[11px] text-slate-500 truncate">{t('appTitle')}</div>
            </div>
          </div>

          <nav className="space-y-1" aria-label="管理员侧边栏导航">
            <button
              type="button"
              data-testid="admin-nav-accounts"
              onClick={() => handleSelectSidebarTab('accounts')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'accounts'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Users
                className={`w-4 h-4 shrink-0 ${
                  activeTab === 'accounts' ? 'text-indigo-600' : 'text-slate-400'
                }`}
              />
              <span className="truncate">{t('adminNavAccounts')}</span>
            </button>

            <button
              type="button"
              data-testid="admin-nav-stores"
              onClick={() => handleSelectSidebarTab('stores')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'stores'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Store
                className={`w-4 h-4 shrink-0 ${
                  activeTab === 'stores' ? 'text-indigo-600' : 'text-slate-400'
                }`}
              />
              <span className="truncate">{t('adminNavStores')}</span>
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100 space-y-3">
          {user && (
            <div className="px-2 py-1 text-xs">
              <div className="font-semibold text-slate-900 truncate">{user.displayName}</div>
              <div className="text-[11px] text-slate-500 font-mono-numbers truncate">
                {user.username} · {t('userRoleAdmin')}
              </div>
            </div>
          )}

          <button
            type="button"
            data-testid="admin-sidebar-logout-btn"
            onClick={() => logout()}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-xs font-semibold text-white transition-colors whitespace-nowrap shadow-2xs"
            title={t('authLogoutBtn')}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{t('authLogoutBtn')}</span>
          </button>
        </div>
      </aside>

      {/* Right Workspace Column */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="shrink-0 z-20 bg-white border-b border-slate-200 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0 text-xs sm:text-sm">
            <span className="font-bold text-slate-900 whitespace-nowrap truncate">
              {t('adminConsoleTitle')}
            </span>
            <span className="text-slate-300 select-none">/</span>
            <button
              type="button"
              onClick={() => handleSelectSidebarTab(activeTab)}
              className={`font-semibold whitespace-nowrap truncate ${
                activeTab === 'stores' && debuggingStore
                  ? 'text-slate-500 hover:text-slate-900'
                  : 'text-indigo-700'
              }`}
            >
              {activeTab === 'accounts' ? t('adminNavAccounts') : t('adminNavStores')}
            </button>
            {activeTab === 'stores' && debuggingStore && (
              <>
                <span className="text-slate-300 select-none">/</span>
                <span className="font-semibold text-indigo-700 whitespace-nowrap truncate font-mono-numbers">
                  {debuggingStore.storeName} ({debuggingStore.storeCode})
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="admin-mobile-logout-btn"
              onClick={() => logout()}
              className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              title={t('authLogoutBtn')}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>{t('authLogoutBtn')}</span>
            </button>

            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              title="Switch zh / sk"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'zh' ? '中文' : 'SK'}</span>
            </button>
          </div>
        </header>

        {/* Mobile / Narrow Screen Top Tab Bar (replaces bottom nav) */}
        <div className="md:hidden shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSelectSidebarTab('accounts')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t('adminNavAccounts')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSidebarTab('stores')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${
              activeTab === 'stores'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>{t('adminNavStores')}</span>
          </button>
        </div>

        {/* Scrollable Content Viewport */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
          <main className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
            {activeTab === 'accounts' && (
              <div data-testid="admin-view-accounts">
                <AccountMgmtPanel stores={storeRows} />
              </div>
            )}

            {activeTab === 'stores' && !debuggingStore && (
              <section
                data-testid="admin-view-stores"
                className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Store className="w-4 h-4 text-indigo-600" />
                      <span>{t('storeMgmtTitle')}</span>
                    </h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {lang === 'zh'
                        ? '创建门店或点击任意门店进入该门店专属的 SKLAD / SaleData 数据库连接调试与配置界面。'
                        : 'Vytvorte predajňu alebo kliknutím na predajňu otvorte ladenie a konfiguráciu jej databáz SKLAD / SaleData.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="open-add-store-btn"
                    onClick={() => setIsAddStoreOpen((p) => !p)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap self-start sm:self-auto shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('storeAddBtn')}</span>
                  </button>
                </div>

                {/* Inline Add Store Form */}
                {isAddStoreOpen && (
                  <form
                    onSubmit={handleCreateStore}
                    data-testid="add-store-form"
                    className="rounded-xl border border-indigo-200 bg-slate-50/70 p-4 space-y-3"
                  >
                    <div className="text-xs font-bold text-slate-900">{t('storeAddTitle')}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                          {t('authStoreCodeLabel')}
                        </span>
                        <input
                          type="text"
                          name="new-store-code"
                          value={addStoreForm.storeCode}
                          onChange={(e) =>
                            setAddStoreForm((p) => ({
                              ...p,
                              storeCode: e.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="BA01"
                          required
                          className="w-full px-3 py-2 text-xs font-mono-numbers uppercase rounded-lg border border-slate-300 bg-white text-slate-900"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                          {t('authStoreNameLabel')}
                        </span>
                        <input
                          type="text"
                          name="new-store-name"
                          value={addStoreForm.storeName}
                          onChange={(e) =>
                            setAddStoreForm((p) => ({ ...p, storeName: e.target.value }))
                          }
                          placeholder={lang === 'zh' ? 'Bratislava 分店' : 'Bratislava Pobočka'}
                          required
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addStoreForm.copyDbFromCurrent}
                            onChange={(e) =>
                              setAddStoreForm((p) => ({
                                ...p,
                                copyDbFromCurrent: e.target.checked,
                              }))
                            }
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                          />
                          <span>
                            {lang === 'zh'
                              ? '从已有门店复制 SKLAD / SaleData 连接配置'
                              : 'Skopírovať nastavenia SKLAD / SaleData z predajne'}
                          </span>
                        </label>

                        {addStoreForm.copyDbFromCurrent && storeRows.length > 0 && (
                          <select
                            value={addStoreForm.copyFromStoreId}
                            onChange={(e) =>
                              setAddStoreForm((p) => ({
                                ...p,
                                copyFromStoreId: Number(e.target.value),
                              }))
                            }
                            className="px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                          >
                            {storeRows.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.storeName} ({s.storeCode})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsAddStoreOpen(false)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="submit"
                          data-testid="add-store-submit-btn"
                          disabled={addingStore}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          {addingStore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>{t('save')}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {/* Inline Edit Store Form */}
                {editingStore && (
                  <form
                    onSubmit={handleUpdateStore}
                    className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-3"
                  >
                    <div className="text-xs font-bold text-slate-900">
                      {t('storeEditTitle')} ·{' '}
                      <span className="font-mono-numbers">{editingStore.storeCode}</span>
                    </div>
                    <label className="block max-w-md">
                      <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {t('authStoreNameLabel')}
                      </span>
                      <input
                        type="text"
                        value={editStoreForm.storeName}
                        onChange={(e) => setEditStoreForm({ storeName: e.target.value })}
                        required
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                      />
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingStore(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 whitespace-nowrap"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="submit"
                        disabled={savingStoreEdit}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
                      >
                        {savingStoreEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{t('save')}</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Clickable Store Cards */}
                {loadingStores ? (
                  <div className="text-xs text-slate-500 py-4 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                    <span>{t('loading')}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {storeRows.map((s) => (
                      <div
                        key={s.id}
                        data-testid={`store-row-${s.storeCode}`}
                        className="rounded-xl border border-slate-200 bg-white hover:border-indigo-300 transition-colors flex flex-col justify-between"
                      >
                        <button
                          type="button"
                          data-testid={`store-card-enter-${s.storeCode}`}
                          onClick={() => setDebuggingStoreId(s.id)}
                          className="w-full text-left p-4 flex items-center justify-between gap-3 group"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 truncate">
                                {s.storeName}
                              </span>
                              <span className="text-xs font-mono-numbers text-slate-500 shrink-0">
                                {s.storeCode}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              SKLAD: {s.hasSkladConfig ? '已单独配置' : '默认/环境'} · SaleData:{' '}
                              {s.hasSaleDataConfig ? '已单独配置' : '默认/环境'}
                            </div>
                          </div>

                          <div className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 whitespace-nowrap shrink-0">
                            <Database className="w-3.5 h-3.5" />
                            <span>{t('storeEnterDebugBtn')}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </button>

                        <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStore(s);
                              setEditStoreForm({ storeName: s.storeName });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <PencilLine className="w-3 h-3" />
                            <span>{t('storeEditAction')}</span>
                          </button>

                          {storeRows.length > 1 && (
                            confirmDeleteStoreId === s.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStore(s.id)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                                >
                                  {t('confirm')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteStoreId(null)}
                                  className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 whitespace-nowrap"
                                >
                                  {t('cancel')}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStoreId(s.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50 whitespace-nowrap"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>{t('storeDeleteAction')}</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'stores' && debuggingStore && (
              <div data-testid="admin-view-store-debug">
                <StoreSqlConfigPanel
                  store={debuggingStore}
                  stores={storeRows}
                  onSelectStoreId={(id) => setDebuggingStoreId(id)}
                  onBackToStores={() => setDebuggingStoreId(null)}
                  onConfigChanged={loadStores}
                />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
