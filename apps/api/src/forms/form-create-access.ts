import {
  type PermissionHolding,
  holdsPermission,
} from "../permission/permission-resolver";
import {
  formCreatePermissionKey,
  formCreatePermissionPrefix,
  formModulePermission,
} from "./form-permission-keys";

/** 判斷新增資格要知道的模組事實:key 與是否開啟依表單分開新增權限(B9b,`modules.perFormCreate`)。 */
export interface FormCreateModule {
  key: string;
  perFormCreate: boolean;
}

/**
 * 用某張表單在某表單模組新增的資格(B9b 的唯一判準;`FormAccessService.canCreateWithForm` 包它):
 * 模組開啟 → `<模組>.create-<formKey>`(模組 `create` 不算);沒開 → 模組 `create`。
 */
export function formCreateKeyOf(
  module: FormCreateModule,
  formKey: string,
): string {
  return module.perFormCreate
    ? formCreatePermissionKey(module.key, formKey)
    : formModulePermission(module.key, "create");
}

/**
 * 在這個表單模組有沒有**任何**新增資格(不指定表單時用:執行端讀模組層資料、表單附件上傳)。
 * 開啟 B9b → 持有任一張表單的 `create-<formKey>`(或模組 `*`);沒開 → 模組 `create`。
 */
export function canCreateInFormModule(
  holding: PermissionHolding,
  module: FormCreateModule,
): boolean {
  if (!module.perFormCreate) {
    return holdsPermission(holding, formModulePermission(module.key, "create"));
  }
  if (holdsPermission(holding, `${module.key}.*`)) {
    return true;
  }
  const prefix = formCreatePermissionPrefix(module.key);
  for (const key of holding.permissionKeys) {
    if (key.startsWith(prefix) && holdsPermission(holding, key)) {
      return true;
    }
  }
  return false;
}
