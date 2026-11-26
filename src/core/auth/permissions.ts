export type UserRole = 'admin' | 'manager' | 'staff';

export type PermissionKey =
  | 'receiving'
  | 'inventory'
  | 'stocktake'
  | 'sales'
  | 'db_settings'
  | 'user_mgmt';

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = [
  'receiving',
  'inventory',
  'stocktake',
  'sales',
  'db_settings',
  'user_mgmt',
] as const;

export const ALL_USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'staff'] as const;

export const ADMIN_ALLOWED_PERMISSIONS: readonly PermissionKey[] = [
  'db_settings',
  'user_mgmt',
] as const;

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly PermissionKey[]> = {
  admin: ['db_settings', 'user_mgmt'],
  manager: ['receiving', 'inventory', 'stocktake', 'sales'],
  staff: ['receiving', 'stocktake'],
};

export type PermittedWorkspace = 'receiving' | 'inventory' | 'stocktake' | 'sales' | 'settings';

export interface PermissionSubject {
  role: UserRole;
  permissions: readonly PermissionKey[];
}

export interface StoreAccessSubject {
  allStores: boolean;
  assignedStoreIds: readonly number[];
}

export function isValidUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'manager' || value === 'staff';
}

export function isPermissionAllowedForRole(role: UserRole, perm: PermissionKey): boolean {
  if (role === 'admin') {
    return (ADMIN_ALLOWED_PERMISSIONS as readonly string[]).includes(perm);
  }
  return !(ADMIN_ALLOWED_PERMISSIONS as readonly string[]).includes(perm);
}

export function normalizePermissions(raw: unknown, fallbackRole?: UserRole): PermissionKey[] {
  if (!Array.isArray(raw)) {
    return fallbackRole ? [...ROLE_DEFAULT_PERMISSIONS[fallbackRole]] : [];
  }
  const set = new Set<PermissionKey>();
  for (const item of raw) {
    if (typeof item === 'string' && (ALL_PERMISSION_KEYS as readonly string[]).includes(item)) {
      const perm = item as PermissionKey;
      if (!fallbackRole || isPermissionAllowedForRole(fallbackRole, perm)) {
        set.add(perm);
      }
    }
  }
  // Order deterministically according to ALL_PERMISSION_KEYS
  return ALL_PERMISSION_KEYS.filter((key) => set.has(key));
}

export function hasPermission(subject: PermissionSubject | null | undefined, perm: PermissionKey): boolean {
  if (!subject) return false;
  return subject.permissions.includes(perm);
}

export function hasAnyPermission(
  subject: PermissionSubject | null | undefined,
  perms: readonly PermissionKey[]
): boolean {
  if (!subject) return false;
  return perms.some((perm) => subject.permissions.includes(perm));
}

export function canAccessStore(subject: StoreAccessSubject | null | undefined, storeId: number): boolean {
  if (!subject || !Number.isInteger(storeId) || storeId <= 0) return false;
  if (subject.allStores) return true;
  return subject.assignedStoreIds.includes(storeId);
}

export function filterAccessibleStores<T extends { id: number }>(
  subject: StoreAccessSubject | null | undefined,
  stores: readonly T[]
): T[] {
  if (!subject) return [];
  if (subject.allStores) return [...stores];
  const allowed = new Set(subject.assignedStoreIds);
  return stores.filter((s) => allowed.has(s.id));
}

export function getFirstPermittedWorkspace(
  subject: PermissionSubject | null | undefined
): PermittedWorkspace | null {
  if (!subject) return null;
  if (hasPermission(subject, 'receiving')) return 'receiving';
  if (hasPermission(subject, 'inventory')) return 'inventory';
  if (hasPermission(subject, 'stocktake')) return 'stocktake';
  if (hasPermission(subject, 'sales')) return 'sales';
  if (hasAnyPermission(subject, ['db_settings', 'user_mgmt'])) return 'settings';
  return null;
}

export function isWorkspacePermitted(
  subject: PermissionSubject | null | undefined,
  workspace: PermittedWorkspace
): boolean {
  if (!subject) return false;
  if (workspace === 'receiving') return hasPermission(subject, 'receiving');
  if (workspace === 'inventory') return hasPermission(subject, 'inventory');
  if (workspace === 'stocktake') return hasPermission(subject, 'stocktake');
  if (workspace === 'sales') return hasPermission(subject, 'sales');
  if (workspace === 'settings') return true;
  return false;
}
