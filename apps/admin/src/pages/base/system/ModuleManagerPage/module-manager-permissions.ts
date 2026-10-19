/**
 * 模組與權限的權限 key(正本 `docs/modules/module-manager.md` 權限表;判斷走 ADR-0011「頁內功能」)。
 *
 * 本模組 `isRootOnly`(seed 層),租戶管理員模板不含它 — 所以「非根組織不該進這一頁」
 * 由 `me.modules` 就擋掉了(路由集合裡根本沒有這條),頁面不必再判一次身分。
 * api 端另有一道:三個端點都要求「當前組織是根組織」,否則 `FORBIDDEN`。
 */
export const MODULE_MANAGER_MODULE_KEY = "system.module-manager";

export const MODULE_MANAGER_PERMISSIONS = {
  view: `${MODULE_MANAGER_MODULE_KEY}.view`,
  toggleEnabled: `${MODULE_MANAGER_MODULE_KEY}.toggle-enabled`,
  /**
   * 側欄圖示:**獨立於 `.toggle-enabled`** —— 換圖示只改側欄長相、隨時換得回來,
   * 停用卻會讓所有租戶少掉整塊功能(正本 `docs/modules/module-manager.md` 權限表)。
   */
  setIcon: `${MODULE_MANAGER_MODULE_KEY}.set-icon`,
  /** 退役權限清理(表單的欄位級權限;三層檢查由 api 做,docs/modules/forms.md「退役權限清理」) */
  deleteRetiredPermission: `${MODULE_MANAGER_MODULE_KEY}.delete-retired-permission`,
} as const;

/**
 * 表單模組的列表欄位配置:權限掛在表單管理(`system.forms.edit`),api 另守「站在根組織」
 * (docs/modules/forms.md「列表欄位配置」)。
 */
export const LIST_COLUMNS_PERMISSION = "system.forms.edit";

/**
 * 自鎖保護(前端的低成本防呆):
 * api 目前**允許**停用 `system.module-manager` 自己 — 一旦關掉,這一頁與它的
 * `toggle-enabled` 權限同時失效,沒有任何畫面能把它開回來(只剩改資料庫)。
 * 在 api 補上防護之前,前端先把這一枝(模組本身、它底下的子模組、以及它們的權限)
 * 的開關停用,避免誤觸;真正的把關仍屬 api。
 */
export const isSelfLockedModuleKey = (key: string): boolean =>
  key === MODULE_MANAGER_MODULE_KEY ||
  key.startsWith(`${MODULE_MANAGER_MODULE_KEY}.`);
