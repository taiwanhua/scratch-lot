import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import {
  ASSIGNEE_KINDS,
  type AssigneeKind,
  type AssigneeSource,
  isUserReferenceField,
} from "@repo/domain/workflow";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";

import { FieldSourceSelect } from "./FieldSourceSelect";
import { UsersField } from "./UsersField";
import type { CatalogForm, CatalogRole } from "./useDesignerCatalog";

const MANAGER_LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * 換來源種類時的起點(各自的必要欄位先給空值,檢查器會指出還沒填的);
 * 「表單欄位」的表單固定是檢查用表單。
 */
const defaultSourceOf = (
  kind: AssigneeKind,
  checkFormKey: string | null,
): AssigneeSource => {
  switch (kind) {
    case "users": {
      return { kind, userIds: [] };
    }
    case "role": {
      return { kind, roleId: null, placeholder: null };
    }
    case "field": {
      return { kind, formKey: checkFormKey ?? "", fieldKey: "" };
    }
    case "manager": {
      return { kind, level: 1 };
    }
  }
};

export interface AssigneeSourcePickerProps {
  value: AssigneeSource;
  onChange: (value: AssigneeSource) => void;
  /** 共用流程:不能指定使用者、角色只能填佔位(Spec 6b §5「審核者來源」) */
  isShared: boolean;
  /** 表單目錄(顯示表單名稱用) */
  forms: readonly CatalogForm[];
  roles: readonly CatalogRole[];
  /** 「檢查用表單」與它目前版本的欄位:「表單欄位」來源從這裡選 */
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
  isDisabled: boolean;
}

/** 「表單欄位」來源可選的欄:使用者型引用欄、非受保護欄位。 */
const assigneeFieldsOf = (fields: readonly FieldDef[] | null): FieldDef[] =>
  conditionFieldsOf(fields ?? [], null, true).filter((field) =>
    isUserReferenceField(field),
  );

/**
 * 審核者來源的四種(Spec 6b §8 零件 `<AssigneeSourcePicker>`):指定使用者 / 角色 / 表單欄位 / 主管。
 * 共用流程的「角色」只存佔位名稱(租戶以它為基底建客製流程後,再指到自己的角色);
 * 「表單欄位」從「檢查用表單」目前版本的使用者型引用欄選(沒選檢查用表單時提示先選);
 * 「主管」從申請所屬組織往上找第幾層。
 */
export const AssigneeSourcePicker = ({
  value,
  onChange,
  isShared,
  forms,
  roles,
  checkFormKey,
  checkFormFields,
  isDisabled,
}: AssigneeSourcePickerProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const formNameOf = (formKey: string): string =>
    forms.find((form) => form.key === formKey)?.name ?? formKey;

  return (
    <Stack spacing={1.5} role="group" aria-label={t("region")}>
      <SelectField<AssigneeKind>
        label={t("kind")}
        value={value.kind}
        size="small"
        disabled={isDisabled}
        options={ASSIGNEE_KINDS.map((kind) => ({
          value: kind,
          label: t(`kinds.${kind}`),
          disabled: isShared && kind === "users",
        }))}
        helperText={isShared ? t("sharedHint") : ""}
        onChange={(kind) => {
          if (kind !== value.kind) {
            onChange(defaultSourceOf(kind, checkFormKey));
          }
        }}
      />
      {value.kind === "users" && (
        <UsersField
          value={value.userIds}
          isDisabled={isDisabled}
          onChange={(userIds) => {
            onChange({ ...value, userIds });
          }}
        />
      )}
      {value.kind === "role" && isShared && (
        <TextField
          label={t("placeholder")}
          value={value.placeholder ?? ""}
          size="small"
          disabled={isDisabled}
          helperText={t("placeholderHint")}
          onChange={(event) => {
            onChange({ ...value, placeholder: event.target.value });
          }}
        />
      )}
      {value.kind === "role" && !isShared && (
        <>
          {value.placeholder !== null && value.placeholder !== "" && (
            <Typography variant="body2" color="text.secondary">
              {t("placeholderFrom", { placeholder: value.placeholder })}
            </Typography>
          )}
          <SelectField
            label={t("role")}
            value={value.roleId ?? ""}
            displayEmpty
            size="small"
            disabled={isDisabled}
            options={[
              { value: "", label: t("roleUnset") },
              ...roles.map((role) => ({ value: role.id, label: role.name })),
            ]}
            onChange={(roleId) => {
              onChange({ ...value, roleId: roleId === "" ? null : roleId });
            }}
          />
        </>
      )}
      {value.kind === "field" && (
        <FieldSourceSelect
          value={value}
          onChange={onChange}
          checkFormKey={checkFormKey}
          choices={assigneeFieldsOf(checkFormFields)}
          isLoaded={checkFormFields !== null}
          formNameOf={formNameOf}
          isDisabled={isDisabled}
        />
      )}
      {value.kind === "manager" && (
        <SelectField
          label={t("level")}
          value={String(value.level)}
          size="small"
          disabled={isDisabled}
          helperText={t("levelHint")}
          options={MANAGER_LEVELS.map((level) => ({
            value: String(level),
            label: t("levelOption", { level }),
          }))}
          onChange={(level) => {
            onChange({ ...value, level: Number(level) });
          }}
        />
      )}
    </Stack>
  );
};
