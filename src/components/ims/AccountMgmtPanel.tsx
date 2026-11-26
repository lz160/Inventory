import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Plus,
  PencilLine,
  Trash2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { UserSummary, useIms } from '../../context/ImsContext';
import {
  ALL_PERMISSION_KEYS,
  ALL_USER_ROLES,
  PermissionKey,
  ROLE_DEFAULT_PERMISSIONS,
  UserRole,
  isPermissionAllowedForRole,
} from '../../core/auth/permissions';

interface StoreOption {
  id: number;
  storeCode: string;
  storeName: string;
}

interface AccountMgmtPanelProps {
  stores: StoreOption[];
}

interface AccountFormState {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  permissions: PermissionKey[];
  allStores: boolean;
  assignedStoreIds: number[];
  isActive: boolean;
}

const EMPTY_FORM = (defaultStoreId?: number): AccountFormState => ({
  username: '',
  displayName: '',
  password: '',
  role: 'staff',
  permissions: [...ROLE_DEFAULT_PERMISSIONS.staff],
  allStores: false,
  assignedStoreIds: defaultStoreId ? [defaultStoreId] : [],
  isActive: true,
});

export const AccountMgmtPanel: React.FC<AccountMgmtPanelProps> = ({ stores }) => {
  const { lang, t, apiCall, showToast, user: currentUser, refreshAuthStatus } = useIms();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AccountFormState>(() => EMPTY_FORM(stores[0]?.id));
  const [creating, setCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [editForm, setEditForm] = useState<AccountFormState>(() => EMPTY_FORM());
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall<{ rows: UserSummary[] }>('/api/users');
      setUsers(res.rows);
    } catch (err: any) {
      showToast(err?.message || '读取账户列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const roleLabel = (role: UserRole) => {
    if (role === 'admin') return t('userRoleAdmin');
    if (role === 'manager') return t('userRoleManager');
    return t('userRoleStaff');
  };

  const permLabel = (perm: PermissionKey) => {
    switch (perm) {
      case 'receiving':
        return t('userPermReceiving');
      case 'inventory':
        return t('userPermInventory');
      case 'stocktake':
        return t('userPermStocktake');
      case 'sales':
        return t('userPermSales');
      case 'db_settings':
        return t('userPermDbSettings');
      case 'user_mgmt':
        return t('userPermUserMgmt');
    }
  };

  const togglePermInForm = (
    setter: React.Dispatch<React.SetStateAction<AccountFormState>>,
    perm: PermissionKey
  ) => {
    setter((prev) => {
      if (!isPermissionAllowedForRole(prev.role, perm)) {
        return prev;
      }
      const exists = prev.permissions.includes(perm);
      const next = exists
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm];
      return { ...prev, permissions: next };
    });
  };

  const toggleStoreInForm = (
    setter: React.Dispatch<React.SetStateAction<AccountFormState>>,
    storeId: number
  ) => {
    setter((prev) => {
      const exists = prev.assignedStoreIds.includes(storeId);
      const next = exists
        ? prev.assignedStoreIds.filter((id) => id !== storeId)
        : [...prev.assignedStoreIds, storeId];
      return { ...prev, assignedStoreIds: next };
    });
  };

  const handleRoleChange = (
    setter: React.Dispatch<React.SetStateAction<AccountFormState>>,
    nextRole: UserRole
  ) => {
    setter((prev) => ({
      ...prev,
      role: nextRole,
      permissions: [...ROLE_DEFAULT_PERMISSIONS[nextRole]],
      allStores: nextRole === 'admin' ? true : prev.allStores,
    }));
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await apiCall('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: addForm.username.trim().toLowerCase(),
          displayName: addForm.displayName.trim(),
          password: addForm.password,
          role: addForm.role,
          permissions: addForm.permissions,
          allStores: addForm.allStores,
          assignedStoreIds: addForm.allStores ? [] : addForm.assignedStoreIds,
          isActive: addForm.isActive,
        }),
      });
      setAddForm(EMPTY_FORM(stores[0]?.id));
      setIsAddOpen(false);
      await loadUsers();
      showToast(lang === 'zh' ? '账户已创建' : 'Účet vytvorený', 'success');
    } catch (err: any) {
      showToast(err?.message || '创建账户失败', 'error');
    } finally {
      setCreating(false);
    }
  };

  const startEditUser = (target: UserSummary) => {
    setEditingUser(target);
    setEditForm({
      username: target.username,
      displayName: target.displayName,
      password: '',
      role: target.role,
      permissions: [...target.permissions],
      allStores: target.allStores,
      assignedStoreIds: [...target.assignedStoreIds],
      isActive: target.isActive,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await apiCall(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: editForm.displayName.trim(),
          ...(editForm.password ? { password: editForm.password } : {}),
          role: editForm.role,
          permissions: editForm.permissions,
          allStores: editForm.allStores,
          assignedStoreIds: editForm.allStores ? [] : editForm.assignedStoreIds,
          isActive: editForm.isActive,
        }),
      });
      setEditingUser(null);
      await Promise.all([loadUsers(), refreshAuthStatus()]);
      showToast(lang === 'zh' ? '账户权限与门店分配已更新' : 'Oprávnenia účtu uložené', 'success');
    } catch (err: any) {
      showToast(err?.message || '更新账户失败', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await apiCall(`/api/users/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await loadUsers();
      showToast(lang === 'zh' ? '账户已删除' : 'Účet vymazaný', 'success');
    } catch (err: any) {
      showToast(err?.message || '删除账户失败', 'error');
    }
  };

  const renderPermissionAndStoreFields = (
    form: AccountFormState,
    setter: React.Dispatch<React.SetStateAction<AccountFormState>>,
    prefix: string
  ) => (
    <div className="space-y-3 pt-1">
      {/* Role Selector */}
      <div>
        <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
          {t('userRoleLabel')}
        </span>
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100">
          {ALL_USER_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              data-testid={`${prefix}-role-${r}`}
              onClick={() => handleRoleChange(setter, r)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                form.role === r
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
      </div>

      {/* Granular Permission Checkboxes */}
      <div>
        <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
          {t('userPermLabel')}
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ALL_PERMISSION_KEYS.filter((perm) => isPermissionAllowedForRole(form.role, perm)).map((perm) => {
            const checked = form.permissions.includes(perm);
            return (
              <label
                key={perm}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs select-none cursor-pointer ${
                  checked
                    ? 'border-indigo-300 bg-indigo-50/50 text-slate-900 font-semibold'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  data-testid={`${prefix}-perm-${perm}`}
                  checked={checked}
                  onChange={() => togglePermInForm(setter, perm)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                />
                <span>{permLabel(perm)}</span>
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">
          {form.role === 'admin'
            ? lang === 'zh'
              ? '系统管理员仅负责管理账户、权限与各门店 SQL 连接设置（不操作业务模块）。'
              : 'Správca spravuje iba účty, oprávnenia a SQL nastavenia predajní.'
            : lang === 'zh'
            ? '店长与店员仅可操作业务模块并在「设置」中修改各自登录密码，无权读写门店数据库连接配置。'
            : 'Vedúci a personál môžu meniť iba svoje heslo; konfigurácia DB predajne je vyhradená pre admina.'}
        </p>
      </div>

      {/* Store Assignment */}
      <div>
        <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
          {t('userStoresLabel')}
        </span>
        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid={`${prefix}-all-stores`}
              checked={form.allStores}
              onChange={(e) => setter((prev) => ({ ...prev, allStores: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600"
            />
            <span>{t('userAllStoresLabel')}</span>
          </label>

          {!form.allStores && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {stores.map((store) => {
                const checked = form.assignedStoreIds.includes(store.id);
                return (
                  <label
                    key={store.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer select-none ${
                      checked
                        ? 'border-indigo-300 bg-indigo-50/50 text-slate-900 font-semibold'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`${prefix}-store-${store.storeCode}`}
                      checked={checked}
                      onChange={() => toggleStoreInForm(setter, store.id)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span className="truncate">
                      {store.storeName}{' '}
                      <span className="font-mono-numbers text-slate-500">({store.storeCode})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Active Status Toggle */}
      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
        <input
          type="checkbox"
          data-testid={`${prefix}-is-active`}
          checked={form.isActive}
          onChange={(e) => setter((prev) => ({ ...prev, isActive: e.target.checked }))}
          className="w-4 h-4 rounded border-slate-300 text-indigo-600"
        />
        <span className="font-medium">
          {t('userStatusLabel')}: {form.isActive ? t('userStatusActive') : t('userStatusDisabled')}
        </span>
      </label>
    </div>
  );

  const summarizeUserStores = (u: UserSummary) => {
    if (u.allStores) return t('userAllStoresLabel');
    if (u.assignedStoreIds.length === 0) return t('userNoStoreAssigned');
    const storeMap = new Map(stores.map((s) => [s.id, s]));
    return u.assignedStoreIds
      .map((sid) => storeMap.get(sid))
      .filter(Boolean)
      .map((s) => `${s!.storeName} (${s!.storeCode})`)
      .join(' · ');
  };

  return (
    <section
      data-testid="account-mgmt-panel"
      className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <span>{t('userMgmtTitle')}</span>
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">{t('userMgmtSubtitle')}</p>
        </div>
        <button
          type="button"
          data-testid="open-add-user-btn"
          onClick={() => {
            setAddForm(EMPTY_FORM(stores[0]?.id));
            setIsAddOpen((p) => !p);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('userAddBtn')}</span>
        </button>
      </div>

      {/* Add Account Form */}
      {isAddOpen && (
        <form
          onSubmit={handleCreateUser}
          data-testid="add-user-form"
          className="rounded-xl border border-indigo-200 bg-slate-50/70 p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-900">{t('userAddTitle')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('authUsernameLabel')}
              </span>
              <input
                type="text"
                name="new-user-username"
                value={addForm.username}
                onChange={(e) => setAddForm((p) => ({ ...p, username: e.target.value }))}
                placeholder="clerk01"
                required
                className="w-full px-3 py-2 text-xs font-mono-numbers rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('authDisplayNameLabel')}
              </span>
              <input
                type="text"
                name="new-user-display-name"
                value={addForm.displayName}
                onChange={(e) => setAddForm((p) => ({ ...p, displayName: e.target.value }))}
                placeholder={lang === 'zh' ? '王店员' : 'Pokladník 1'}
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('authPasswordLabel')}
              </span>
              <input
                type="password"
                name="new-user-password"
                value={addForm.password}
                onChange={(e) => setAddForm((p) => ({ ...p, password: e.target.value }))}
                placeholder={t('authPasswordPlaceholder')}
                required
                minLength={4}
                autoComplete="new-password"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </label>
          </div>

          {renderPermissionAndStoreFields(addForm, setAddForm, 'add-user')}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/70">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              data-testid="add-user-submit-btn"
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('save')}</span>
            </button>
          </div>
        </form>
      )}

      {/* Edit Account Form */}
      {editingUser && (
        <form
          onSubmit={handleSaveEdit}
          data-testid="edit-user-form"
          className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-900">
            {t('userEditTitle')} · <span className="font-mono-numbers">{editingUser.username}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('authDisplayNameLabel')}
              </span>
              <input
                type="text"
                value={editForm.displayName}
                onChange={(e) => setEditForm((p) => ({ ...p, displayName: e.target.value }))}
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('storeNewPasswordHint')}
              </span>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="••••"
                minLength={4}
                autoComplete="new-password"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </label>
          </div>

          {renderPermissionAndStoreFields(editForm, setEditForm, 'edit-user')}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/70">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              data-testid="edit-user-submit-btn"
              disabled={savingEdit}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('save')}</span>
            </button>
          </div>
        </form>
      )}

      {/* User List */}
      {loading ? (
        <div className="text-xs text-slate-500 py-2">{t('loading')}</div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {users.map((u) => {
            const isSelf = currentUser?.id === u.id;
            return (
              <div
                key={u.id}
                data-testid={`user-row-${u.username}`}
                className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isSelf ? 'bg-indigo-50/25' : 'bg-white'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-bold text-slate-900">{u.displayName}</span>
                    <span className="font-mono-numbers text-slate-500">{u.username}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-indigo-700 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {roleLabel(u.role)}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className={u.isActive ? 'text-emerald-700 font-medium' : 'text-rose-600 font-medium'}>
                      {u.isActive ? t('userStatusActive') : t('userStatusDisabled')}
                    </span>
                    {isSelf && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-indigo-700 font-semibold">{t('userSelfBadge')}</span>
                      </>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">{t('userStoresLabel')}: </span>
                    <span>{summarizeUserStores(u)}</span>
                  </div>

                  <div className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">{t('userPermLabel')}: </span>
                    <span>
                      {u.permissions.length > 0
                        ? u.permissions.map((p) => permLabel(p)).join(' · ')
                        : t('userNoPermAssigned')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    data-testid={`edit-user-btn-${u.username}`}
                    onClick={() => startEditUser(u)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    <PencilLine className="w-3 h-3" />
                    <span>{t('storeEditAction')}</span>
                  </button>

                  {!isSelf && (
                    confirmDeleteId === u.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`confirm-delete-user-${u.username}`}
                          onClick={() => handleDeleteUser(u.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-700"
                        >
                          {t('confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 bg-white text-slate-600"
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`delete-user-btn-${u.username}`}
                        onClick={() => setConfirmDeleteId(u.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{t('delete')}</span>
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
