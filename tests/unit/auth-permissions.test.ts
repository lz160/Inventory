import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_DEFAULT_PERMISSIONS,
  canAccessStore,
  filterAccessibleStores,
  getFirstPermittedWorkspace,
  hasAnyPermission,
  hasPermission,
  isWorkspacePermitted,
  normalizePermissions,
} from '../../src/core/auth/permissions';

test('normalizePermissions filters unknown keys and preserves canonical order', () => {
  const result = normalizePermissions(['sales', 'bogus_perm', 'receiving', 'sales']);
  assert.deepEqual(result, ['receiving', 'sales']);
});

test('normalizePermissions falls back to role defaults and enforces admin-only permission boundary', () => {
  assert.deepEqual(normalizePermissions(undefined, 'admin'), ['db_settings', 'user_mgmt']);
  assert.deepEqual(normalizePermissions(undefined, 'manager'), ['receiving', 'inventory', 'stocktake', 'sales']);
  assert.deepEqual(normalizePermissions(null, 'staff'), ['receiving', 'stocktake']);
  assert.deepEqual(
    normalizePermissions(['receiving', 'inventory', 'stocktake', 'sales', 'db_settings', 'user_mgmt'], 'admin'),
    ['db_settings', 'user_mgmt']
  );
  assert.deepEqual(
    normalizePermissions(['receiving', 'db_settings', 'user_mgmt'], 'manager'),
    ['receiving']
  );
  assert.deepEqual(
    normalizePermissions(['stocktake', 'db_settings', 'user_mgmt'], 'staff'),
    ['stocktake']
  );
});

test('hasPermission and hasAnyPermission evaluate explicit user permissions accurately', () => {
  const staff = { role: 'staff' as const, permissions: ['receiving', 'stocktake'] as const };
  assert.equal(hasPermission(staff, 'receiving'), true);
  assert.equal(hasPermission(staff, 'sales'), false);
  assert.equal(hasAnyPermission(staff, ['inventory', 'stocktake']), true);
  assert.equal(hasAnyPermission(staff, ['db_settings', 'user_mgmt']), false);
});

test('canAccessStore and filterAccessibleStores enforce allStores vs assignedStoreIds', () => {
  const stores = [
    { id: 1, storeCode: 'S01' },
    { id: 2, storeCode: 'S02' },
    { id: 3, storeCode: 'S03' },
  ];

  const allUser = { allStores: true, assignedStoreIds: [] };
  assert.equal(canAccessStore(allUser, 2), true);
  assert.deepEqual(
    filterAccessibleStores(allUser, stores).map((s) => s.id),
    [1, 2, 3]
  );

  const scopedUser = { allStores: false, assignedStoreIds: [2] };
  assert.equal(canAccessStore(scopedUser, 1), false);
  assert.equal(canAccessStore(scopedUser, 2), true);
  assert.deepEqual(
    filterAccessibleStores(scopedUser, stores).map((s) => s.id),
    [2]
  );
});

test('getFirstPermittedWorkspace and isWorkspacePermitted route users safely to allowed tabs', () => {
  const stocktakeOnly = { role: 'staff' as const, permissions: ['stocktake'] as const };
  assert.equal(getFirstPermittedWorkspace(stocktakeOnly), 'stocktake');
  assert.equal(isWorkspacePermitted(stocktakeOnly, 'receiving'), false);
  assert.equal(isWorkspacePermitted(stocktakeOnly, 'stocktake'), true);
  assert.equal(isWorkspacePermitted(stocktakeOnly, 'settings'), true);

  const adminUser = { role: 'admin' as const, permissions: ROLE_DEFAULT_PERMISSIONS.admin };
  assert.equal(getFirstPermittedWorkspace(adminUser), 'settings');
  assert.equal(isWorkspacePermitted(adminUser, 'receiving'), false);
  assert.equal(isWorkspacePermitted(adminUser, 'inventory'), false);
  assert.equal(isWorkspacePermitted(adminUser, 'sales'), false);
  assert.equal(isWorkspacePermitted(adminUser, 'settings'), true);

  const noPerms = { role: 'staff' as const, permissions: [] as const };
  assert.equal(getFirstPermittedWorkspace(noPerms), null);
});
