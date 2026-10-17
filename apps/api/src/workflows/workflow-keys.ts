import { permissionKey } from "@repo/domain/permission";

/**
 * 審核流程用到的權限 key(seed 正本 `apps/db-migrator/seeds/base/modules/system.ts` 的 `system.workflows`、
 * `apps/db-migrator/seeds/base/modules/apply-center.ts`;模組文件 `docs/modules/workflows.md`)。
 */

/** 流程管理(`system.workflows`)。 */
export const WORKFLOWS_MODULE_KEY = "system.workflows";
export const WORKFLOWS_PERMISSIONS = {
  view: permissionKey(WORKFLOWS_MODULE_KEY, "view"),
  create: permissionKey(WORKFLOWS_MODULE_KEY, "create"),
  edit: permissionKey(WORKFLOWS_MODULE_KEY, "edit"),
  publish: permissionKey(WORKFLOWS_MODULE_KEY, "publish"),
  assign: permissionKey(WORKFLOWS_MODULE_KEY, "assign"),
} as const;

/**
 * 阻擋清單頁(隱藏頁 `system.workflows.blocked-page`)自有的權限:改派、新增審核者、重試推進、
 * 阻擋清單查詢。綁在隱藏頁底下,不靠父模組的 wildcard(同層語意)。
 */
export const WORKFLOW_REASSIGN_PERMISSION = permissionKey(
  `${WORKFLOWS_MODULE_KEY}.blocked-page`,
  "reassign",
);

/** 申請中心的模組 key(側欄計數信號 `badge:apply-center` 也用它)。 */
export const APPLY_CENTER_MODULE_KEY = "apply-center";

/** 申請中心(`apply-center`):我的申請 / 待我審核 / 新申請入口。 */
export const APPLY_CENTER_VIEW_PERMISSION = permissionKey(
  APPLY_CENTER_MODULE_KEY,
  "view",
);

/** 表單管理的編輯權限(流程綁定掛在表單管理列表上,沿用它)。 */
export const FORMS_EDIT_PERMISSION = permissionKey("system.forms", "edit");
