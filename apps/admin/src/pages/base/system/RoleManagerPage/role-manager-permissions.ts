/**
 * 角色管理的權限 key(正本 `docs/modules/role-manager.md` 權限表;判斷走 ADR-0011「頁內功能」)。
 */
export const ROLE_MANAGER_MODULE_KEY = "system.role-manager";

export const ROLE_MANAGER_PERMISSIONS = {
  view: `${ROLE_MANAGER_MODULE_KEY}.view`,
  create: `${ROLE_MANAGER_MODULE_KEY}.create`,
  edit: `${ROLE_MANAGER_MODULE_KEY}.edit`,
  editMatrix: `${ROLE_MANAGER_MODULE_KEY}.edit-matrix`,
  assignUsers: `${ROLE_MANAGER_MODULE_KEY}.assign-users`,
  toggleEnabled: `${ROLE_MANAGER_MODULE_KEY}.toggle-enabled`,
  delete: `${ROLE_MANAGER_MODULE_KEY}.delete`,
} as const;

/**
 * 新增角色的「擁有組織」下拉來自 `orgTree`,而 api 把它掛在組織管理的檢視權限底下;
 * 沒有它就只剩「當前組織」一個選項(api 的預設值也是當前組織,GQL-06)。
 */
export const ORG_MANAGER_VIEW_PERMISSION = "system.org-manager.view";

/*
 * 這裡曾有 `USER_MANAGER_VIEW_PERMISSION`:「加入使用者」的候選清單借用 `users` query,
 * 連帶逼得這個彈窗需要使用者管理的檢視權限。補了 `roleUserCandidates`
 * (掛 `assign-users`)之後這個相依消失,常數一併移除。
 */
