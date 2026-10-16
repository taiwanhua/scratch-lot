import { useState } from "react";
import { useTranslations } from "use-intl";

import type { Audience } from "@repo/domain/audience";
import type { FieldDef } from "@repo/domain/form";
import {
  ASSIGNEE_KINDS,
  type AssigneeKind,
  type AssigneeSource,
  isUserReferenceField,
} from "@repo/domain/workflow";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";

import { AudienceConditionDialog } from "./AudienceConditionDialog";
import { AudienceSourceSummary } from "./AudienceSourceSummary";
import { FieldSourceSelect } from "./FieldSourceSelect";
import { useApproverAudienceSetup } from "./useApproverAudienceSetup";
import type { CatalogForm } from "./useDesignerCatalog";

const MANAGER_LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * 換成「表單欄位 / 主管」時的起點(必要欄位先給空值,檢查器會指出還沒填的);
 * 「表單欄位」的表單固定是檢查用表單。換成「人員條件」不走這裡:先開條件對話框,[套用] 才換。
 */
const defaultSourceOf = (
  kind: Exclude<AssigneeKind, "audience">,
  checkFormKey: string | null,
): AssigneeSource => {
  switch (kind) {
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
  /** 關卡名稱(條件對話框的標題) */
  stepName: string;
  /** 共用流程:人員條件只能用權限與非指定的組織來源 */
  isShared: boolean;
  /** 表單目錄(顯示表單名稱用) */
  forms: readonly CatalogForm[];
  /** 「檢查用表單」與它目前版本的欄位:「表單欄位」來源與人員條件的「表單的組織欄位」從這裡選 */
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
 * 審核者來源的三種(《底座規格》3.3;Figma BS-02a / c):人員條件 / 表單欄位 / 主管。
 * 「人員條件」取代原本的「指定使用者」與「角色」:面板只放條件摘要與 [編輯條件],
 * 條件在對話框用 `AudiencePicker` 編輯(面板寬度放不下條件列)。從別的來源換成人員條件時
 * 先開對話框,**按 [套用] 才換**;[取消] 保留原本的來源與設定;
 * 「表單欄位」從「檢查用表單」目前版本的使用者型引用欄選(沒選檢查用表單時提示先選);
 * 「主管」從申請所屬組織往上找第幾層。
 */
export const AssigneeSourcePicker = ({
  value,
  onChange,
  stepName,
  isShared,
  forms,
  checkFormKey,
  checkFormFields,
  isDisabled,
}: AssigneeSourcePickerProps) => {
  const t = useTranslations("admin.workflows.assignee");
  /** 從別的來源換成人員條件、還沒按 [套用] */
  const [isSwitching, setIsSwitching] = useState(false);
  const setup = useApproverAudienceSetup(isShared, checkFormFields);
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
        }))}
        onChange={(kind) => {
          if (kind === value.kind) {
            return;
          }
          if (kind === "audience") {
            setIsSwitching(true);
            return;
          }
          onChange(defaultSourceOf(kind, checkFormKey));
        }}
      />
      {value.kind === "audience" && (
        <AudienceSourceSummary
          audience={value.audience}
          stepName={stepName}
          isShared={isShared}
          setup={setup}
          isDisabled={isDisabled}
          onChange={(audience) => {
            onChange({ kind: "audience", audience });
          }}
        />
      )}
      {isSwitching && (
        <AudienceConditionDialog
          stepName={stepName}
          isShared={isShared}
          initial={setup.initialDraftOf(null)}
          fields={setup.fields}
          orgSources={setup.orgSources}
          onCancel={() => {
            setIsSwitching(false);
          }}
          onApply={(audience) => {
            onChange({
              kind: "audience",
              audience: audience as unknown as Audience,
            });
            setIsSwitching(false);
          }}
        />
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
