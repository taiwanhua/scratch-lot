import { permissionKey } from "@repo/domain/permission";

/**
 * 表單引擎用到的權限 key(seed 正本 `apps/db-migrator/seeds/base/modules/system.ts`、各表單模組的 seed 宣告)。
 */

/** 表單管理(`system.forms`)模組 key 與權限。 */
export const FORMS_MODULE_KEY = "system.forms";
export const FORMS_PERMISSIONS = {
  view: `${FORMS_MODULE_KEY}.view`,
  create: `${FORMS_MODULE_KEY}.create`,
  edit: `${FORMS_MODULE_KEY}.edit`,
  assign: `${FORMS_MODULE_KEY}.assign`,
  setEnabled: `${FORMS_MODULE_KEY}.set-enabled`,
} as const;

/** 模組與權限頁的「刪除退役權限」(根組織專屬模組)。 */
export const DELETE_RETIRED_PERMISSION =
  "system.module-manager.delete-retired-permission";
export const MODULE_MANAGER_VIEW = "system.module-manager.view";

/** 表單模組的四筆個別權限(seed 宣告的形狀;見 `seeds/base/form-module-declaration.ts`)。 */
export type FormModuleAction = "view" | "create" | "edit" | "delete";

export function formModulePermission(
  moduleKey: string,
  action: FormModuleAction,
): string {
  return permissionKey(moduleKey, action);
}

/** 欄位級權限的兩種動作。 */
export type FieldPermissionAction = "show" | "edit";

/**
 * 欄位級權限 key:`<moduleKey>.show-<formKey>-<fieldKey>` / `<moduleKey>.edit-<formKey>-<fieldKey>`
 * (Spec 6a §6)。formKey 與 fieldKey 不含 `-` / `.`,所以動作段一定能唯一拆回。
 */
export function fieldPermissionKey(
  moduleKey: string,
  action: FieldPermissionAction,
  formKey: string,
  fieldKey: string,
): string {
  return permissionKey(moduleKey, `${action}-${formKey}-${fieldKey}`);
}

/** 某張表單全部欄位級權限的 key 前綴(`<moduleKey>.show-<formKey>-`),發布步驟 3 找「不再宣告的」用。 */
export function fieldPermissionPrefix(
  moduleKey: string,
  action: FieldPermissionAction,
  formKey: string,
): string {
  return permissionKey(moduleKey, `${action}-${formKey}-`);
}

/**
 * 依表單分開的新增權限 key(B9b):`<moduleKey>.create-<formKey>`。只有宣告 `perFormCreate: true` 的表單模組
 * 在發布步驟 3 建立;判斷一律走 `FormAccessService.canCreateWithForm`。
 */
export function formCreatePermissionKey(
  moduleKey: string,
  formKey: string,
): string {
  return permissionKey(moduleKey, `create-${formKey}`);
}

/** 依表單分開的新增權限顯示名:「<表單名> 新增」(隨表單改名,在下次發布時更新)。 */
export function formCreatePermissionName(formName: string): string {
  return `${formName} 新增`;
}

/** 某表單模組全部依表單新增權限的 key 前綴(`<moduleKey>.create-`)。 */
export function formCreatePermissionPrefix(moduleKey: string): string {
  return permissionKey(moduleKey, "create-");
}

export interface ParsedFieldPermissionKey {
  moduleKey: string;
  action: FieldPermissionAction;
  formKey: string;
  fieldKey: string;
}

/** 依表單分開的新增權限 `<moduleKey>.create-<formKey>`(建立歸 B9b;此處只負責認得)。 */
export interface ParsedFormCreatePermissionKey {
  moduleKey: string;
  action: "create";
  formKey: string;
}

/** 表單動態權限(`permissions.source = "dynamic"` 的兩種形狀):欄位級 `show-` / `edit-`,或依表單新增 `create-`。 */
export type ParsedFormPermissionKey =
  ParsedFieldPermissionKey | ParsedFormCreatePermissionKey;

const FIELD_ACTION = /^(show|edit)-([a-z][a-z0-9_]*)-([a-z][a-z0-9_]*)$/;
const CREATE_ACTION = /^create-([a-z][a-z0-9_]*)$/;

/**
 * 把表單動態權限 key 拆回各段(`show-` / `edit-<formKey>-<fieldKey>`、`create-<formKey>`);
 * 不是這些形狀回 null。要「這張表單是誰的」時用它(例:過濾別租戶客製表單的動態權限)。
 */
export function parseFormPermissionKey(
  key: string,
): ParsedFormPermissionKey | null {
  const separator = key.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const moduleKey = key.slice(0, separator);
  const action = key.slice(separator + 1);
  const field = FIELD_ACTION.exec(action);
  if (field) {
    const [, fieldAction, formKey, fieldKey] = field;
    if (!fieldAction || !formKey || !fieldKey) {
      return null;
    }
    return {
      moduleKey,
      action: fieldAction as FieldPermissionAction,
      formKey,
      fieldKey,
    };
  }
  const formKey = CREATE_ACTION.exec(action)?.[1];
  return formKey ? { moduleKey, action: "create", formKey } : null;
}

/**
 * 只認欄位級權限(`show-` / `edit-`);`create-<formKey>` 回 null —— 它不是欄位級權限,
 * 不能被當成欄位處理(例:退役權限清理只列、只刪欄位級權限)。
 */
export function parseFieldPermissionKey(
  key: string,
): ParsedFieldPermissionKey | null {
  const parsed = parseFormPermissionKey(key);
  return parsed === null || parsed.action === "create" ? null : parsed;
}

/** 權限顯示名:「<表單名> / <欄位 label> 可見 / 可改」(矩陣靠它顯示)。 */
export function fieldPermissionName(
  formName: string,
  fieldLabel: string,
  action: FieldPermissionAction,
): string {
  return `${formName} / ${fieldLabel} ${action === "show" ? "可見" : "可改"}`;
}
