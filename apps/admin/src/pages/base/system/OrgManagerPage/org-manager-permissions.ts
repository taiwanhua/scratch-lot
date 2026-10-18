/**
 * 組織管理的權限 key(正本 `docs/modules/org-manager.md` 權限表;判斷走 ADR-0011「頁內功能」)。
 *
 * `tenant-ops.*` 是**隱藏的子模組**(`isRootOnly`,無路由):開通租戶、撤銷開通與轉移擁有者
 * 是根組織專屬動作,放在自己的模組裡,租戶管理員模板複製時整個模組被扣除(ADR-0009 第 3 步),
 * 所以租戶拿到 `system.org-manager.*` 也不會連帶拿到那幾筆。彈窗仍然開在組織管理頁上。
 *
 * **可見範圍開關例外**:2026-09-19 從 tenant-ops 搬到組織管理層(ADR-0005)—
 * 它是租戶自己的資料政策,租戶管理員模板靠 `system.org-manager.*` 自動取得;
 * 能設哪些租戶頂層由 api 以管理範圍守門,前端只管「有沒有這筆權限」。租戶時區(`set-timezone`)同理。
 */
export const ORG_MANAGER_MODULE_KEY = "system.org-manager";

const TENANT_OPS_MODULE_KEY = `${ORG_MANAGER_MODULE_KEY}.tenant-ops`;

export const ORG_MANAGER_PERMISSIONS = {
  view: `${ORG_MANAGER_MODULE_KEY}.view`,
  createChild: `${ORG_MANAGER_MODULE_KEY}.create-child`,
  edit: `${ORG_MANAGER_MODULE_KEY}.edit`,
  toggleEnabled: `${ORG_MANAGER_MODULE_KEY}.toggle-enabled`,
  move: `${ORG_MANAGER_MODULE_KEY}.move`,
  delete: `${ORG_MANAGER_MODULE_KEY}.delete`,
  viewMembers: `${ORG_MANAGER_MODULE_KEY}.view-members`,
  addMembers: `${ORG_MANAGER_MODULE_KEY}.add-members`,
  provision: `${TENANT_OPS_MODULE_KEY}.provision`,
  revokeProvision: `${TENANT_OPS_MODULE_KEY}.revoke-provision`,
  transferOwner: `${TENANT_OPS_MODULE_KEY}.transfer-owner`,
  setVisibility: `${ORG_MANAGER_MODULE_KEY}.set-visibility`,
  setTimezone: `${ORG_MANAGER_MODULE_KEY}.set-timezone`,
} as const;

/**
 * 使用者清單的權限(api `users` / `user` 都掛在它底下)。
 * 本頁只為了兩件事要它:擁有者欄位顯示名字、轉移擁有者的候選人清單。
 * 沒有它時那兩處退成「看不到名字 / 不能轉移」,頁面其餘部分照常(寫法同使用者管理的反向引用)。
 */
export const USER_MANAGER_VIEW_PERMISSION = "system.user-manager.view";
