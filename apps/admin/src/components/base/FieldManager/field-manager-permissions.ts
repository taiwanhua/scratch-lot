/**
 * 欄位管理的權限 key(正本 `docs/modules/field-manager.md` 權限表;判斷走 ADR-0011「頁內功能」)。
 *
 * 本模組**不是**根組織專屬:每個組織都能自訂自己的選項。唯一的例外是**管理類別**
 * (新增 / 改名 / 停用類別):它掛在隱藏的權限容器 `category-ops`(`isRootOnly`,無路由)底下,
 * 租戶管理員模板拿不到;api 另守「站在根組織」。
 *
 * 「這一列能不能按」除了權限還要看組織關係(種子 / 上層 / 自己 / 下層),那一半由 **api**
 * 逐列算好成 `canEdit` / `canToggleEnabled`,前端只跟權限取交集 —— 見 `field-source.ts`。
 */
export const FIELD_MANAGER_MODULE_KEY = "system.field-manager";

export const FIELD_MANAGER_PERMISSIONS = {
  view: `${FIELD_MANAGER_MODULE_KEY}.view`,
  create: `${FIELD_MANAGER_MODULE_KEY}.create`,
  edit: `${FIELD_MANAGER_MODULE_KEY}.edit`,
  toggleEnabled: `${FIELD_MANAGER_MODULE_KEY}.toggle-enabled`,
  manageCategories: `${FIELD_MANAGER_MODULE_KEY}.category-ops.manage-categories`,
} as const;
