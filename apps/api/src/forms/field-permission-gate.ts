import {
  type FieldDef,
  type FieldProtection,
  fieldProtections,
} from "@repo/domain/form";

import type { FormOperatorFacts } from "./form-access.service";
import { fieldPermissionKey } from "./form-permission-keys";

/**
 * 欄位級權限的判定。
 *
 * **mapper 規則,不走 `hasPermission`**:
 * - 非超級管理員:有效權限集合裡要有**那一個具體 key**。`PermissionResolver` 已把 `<模組>.*`
 *   展開成該模組「存在且啟用」的每一筆權限,所以持模組 `*` 的人自動涵蓋;
 *   但權限列被刪了就不會被展開 —— 此時 `hasPermission` 仍會因 `*` 而放行,這裡不會
 *   (不然刪權限等於對持 `*` 者公開)
 * - 超級管理員(root):一律放行,權限列被刪後「只有 root 看得到」的那個 root 就是它
 *
 * 讀得到某欄 = 它自己的 `show`(若設)且沿計算依賴鏈引用到的每個受保護欄位的 `show` 都有
 * (`@repo/domain/form` 的 `fieldProtections`;只因依賴而受保護的欄位不另建權限)。
 */
export interface FieldGate {
  /** 這位操作者讀得到某欄嗎(看的是**這一版**的定義)。 */
  canShow(fields: readonly FieldDef[], fieldKey: string): boolean;
  /** 權限層面改得動某欄嗎(使用者填的欄位;看不到的一律改不動)。條件唯讀另由 `readonlyWhen` 判。 */
  canEdit(fields: readonly FieldDef[], field: FieldDef): boolean;
}

const protectionsCache = new WeakMap<
  readonly FieldDef[],
  Map<string, FieldProtection>
>();

function protectionsOf(
  fields: readonly FieldDef[],
): Map<string, FieldProtection> {
  const cached = protectionsCache.get(fields);
  if (cached) {
    return cached;
  }
  const computed = fieldProtections(fields);
  protectionsCache.set(fields, computed);
  return computed;
}

/** 讀某欄要哪些欄位的 `show`(自己設了 show 也算);空陣列 = 公開欄位。 */
export function requiredShowKeys(
  fields: readonly FieldDef[],
  fieldKey: string,
): string[] {
  const protection = protectionsOf(fields).get(fieldKey);
  if (!protection) {
    return [];
  }
  return protection.self ? [fieldKey, ...protection.via] : protection.via;
}

export function fieldGateOf(
  facts: FormOperatorFacts,
  moduleKey: string,
  formKey: string,
): FieldGate {
  const holds = (key: string): boolean =>
    facts.isSuperAdmin || facts.permissionKeys.has(key);
  const canShow = (fields: readonly FieldDef[], fieldKey: string): boolean =>
    requiredShowKeys(fields, fieldKey).every((key) =>
      holds(fieldPermissionKey(moduleKey, "show", formKey, key)),
    );
  return {
    canShow,
    canEdit: (fields, field) => {
      if (field.valueSource.kind !== "input") {
        return false;
      }
      if (!canShow(fields, field.key)) {
        return false;
      }
      return field.permission?.edit === true
        ? holds(fieldPermissionKey(moduleKey, "edit", formKey, field.key))
        : true;
    },
  };
}
