import type { MetaStore } from './metaStore';

type IdentityMethod =
  | 'countStores' | 'listStores' | 'getStoreById' | 'getStoreByCode'
  | 'createStore' | 'migrateLegacyOverridesToStore' | 'cloneStoreDbConfigs'
  | 'updateStore' | 'deleteStore'
  | 'countUsers' | 'listUsers' | 'getUserById' | 'getUserByUsername'
  | 'countActiveAdminsWithUserMgmt' | 'createUser' | 'updateUser' | 'deleteUser'
  | 'authenticateUser' | 'verifyUserPassword' | 'createUserSession'
  | 'verifyUserSessionToken' | 'setSessionActiveStore' | 'revokeUserSessionToken'
  | 'getDbOverride' | 'upsertDbOverride' | 'clearAllDbOverrides';

export type IdentityStore = {
  [K in IdentityMethod]: (...args: Parameters<MetaStore[K]>) =>
    ReturnType<MetaStore[K]> | Promise<ReturnType<MetaStore[K]>>;
};
