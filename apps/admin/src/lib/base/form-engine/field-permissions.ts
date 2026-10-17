import { type FieldDef, requiredShowFieldsFor } from "@repo/domain/form";

import type { FieldPermissionFacts } from "./field-states";

/**
 * 欄位級權限的兩個來源(docs/modules/forms.md「讀取投影」「abilities」):
 *
 * 1. **已有提交**(編輯、詳情):api 算好的 `fieldStates[].redacted` 與 `abilities.canEditField`,
 *    前端直接用 —— 權限列被刪、模組 `*` 不放行這類 mapper 規則只有 api 知道。
 * 2. **新增、草稿還沒建**:沒有提交可問,只能由操作者持有的權限 key 推
 *    (`<moduleKey>.show-<formKey>-<fieldKey>` / `edit-…`,Spec §6 命名);定義裡標 `redacted` 的骨架欄位
 *    (`formRuntimeVersion` 依讀者投影)直接算讀不到。推錯的代價只是畫面多顯示或
 *    少顯示一欄:寫入仍由 api 守(無權改的值送出去 → 403)。
 */

export interface SubmissionPermissionSource {
  fieldStates: readonly { key: string; redacted: boolean }[];
  abilities: { canEditField: readonly string[] };
}

export const permissionsOfSubmission = (
  submission: SubmissionPermissionSource,
): FieldPermissionFacts => {
  const redacted = new Set(
    submission.fieldStates
      .filter((state) => state.redacted)
      .map((state) => state.key),
  );
  const editable = new Set(submission.abilities.canEditField);
  return {
    canShow: (fieldKey) => !redacted.has(fieldKey),
    canEdit: (fieldKey) => editable.has(fieldKey),
  };
};

export const fieldPermissionKey = (
  moduleKey: string,
  action: "show" | "edit",
  formKey: string,
  fieldKey: string,
): string => `${moduleKey}.${action}-${formKey}-${fieldKey}`;

export interface HeldPermissionInput {
  moduleKey: string;
  formKey: string;
  fields: readonly FieldDef[];
  hasPermission: (key: string) => boolean;
}

export const permissionsFromHeld = ({
  moduleKey,
  formKey,
  fields,
  hasPermission,
}: HeldPermissionInput): FieldPermissionFacts => {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  // 定義是 api 依讀者投影過的:骨架(`redacted`)就是讀不到,不必再推(公式已省略,推不出依賴鏈)
  const canShow = (fieldKey: string): boolean =>
    byKey.get(fieldKey)?.redacted !== true &&
    requiredShowFieldsFor(fields, fieldKey).every((key) =>
      hasPermission(fieldPermissionKey(moduleKey, "show", formKey, key)),
    );
  return {
    canShow,
    canEdit: (fieldKey) => {
      const field = byKey.get(fieldKey);
      if (field === undefined || !canShow(fieldKey)) {
        return false;
      }
      return (
        field.permission?.edit !== true ||
        hasPermission(fieldPermissionKey(moduleKey, "edit", formKey, fieldKey))
      );
    },
  };
};
