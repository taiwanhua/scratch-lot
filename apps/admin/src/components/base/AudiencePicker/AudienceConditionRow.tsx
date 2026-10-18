import { useTranslations } from "use-intl";

import { AUDIENCE_ORG_RANGES, type AudienceField } from "@repo/domain/audience";
import { SelectField } from "@repo/ui/select-field";

import { ConditionRow } from "@/components/base/condition-tree/ConditionRow";
import {
  type AudienceConditionDraft,
  newAudienceCondition,
} from "@/lib/base/audience-draft";

import { AudienceValueField } from "./AudienceValueField";
import type { AudiencePickerEnv } from "./audience-picker-env";

export interface AudienceConditionRowProps {
  condition: AudienceConditionDraft;
  childPath: readonly number[];
  env: AudiencePickerEnv;
  onChange: (next: AudienceConditionDraft) => void;
  onRemove: () => void;
}

/**
 * 人員條件的一條條件列(Figma `Draft/AudiencePicker`):欄位 → 條件 → 值 → (所屬組織)範圍 → 刪除。
 * 比較方式只有一種:「屬於」(權限欄顯示「持有」);換欄位就整條重建,不留上一個欄位的值。
 */
export const AudienceConditionRow = ({
  condition,
  childPath,
  env,
  onChange,
  onRemove,
}: AudienceConditionRowProps) => {
  const t = useTranslations("admin.audiencePicker");

  const issue = (["field", "value", "range", "node"] as const)
    .flatMap((target) => {
      const message = env.issueOf(childPath, target);
      return message === undefined ? [] : [{ target, message }];
    })
    .at(0);
  const isKnownField = env.fields.includes(condition.field);

  return (
    <ConditionRow<AudienceField>
      fieldOptions={env.fields.map((field) => ({
        value: field,
        label: t(`fields.${field}`),
      }))}
      field={isKnownField ? condition.field : ""}
      isFieldError={issue?.target === "field"}
      isReadOnly={env.isReadOnly}
      error={issue?.message}
      onFieldChange={(field) => {
        onChange(newAudienceCondition(field, env.orgSources));
      }}
      onRemove={onRemove}
    >
      {isKnownField && (
        <>
          <SelectField
            size="small"
            label={t("cond")}
            value="in"
            disabled={env.isReadOnly}
            sx={{ width: 110 }}
            options={[
              {
                value: "in",
                label:
                  condition.field === "permission"
                    ? t("condHold")
                    : t("condIn"),
              },
            ]}
            onChange={() => {
              // 只有一種比較方式,沒有東西可換
            }}
          />
          <AudienceValueField
            condition={condition}
            env={env}
            hasError={issue?.target === "value" || issue?.target === "node"}
            onChange={(value) => {
              onChange({ ...condition, value });
            }}
          />
          {condition.field === "org" && (
            <SelectField
              size="small"
              label={t("range")}
              value={condition.range ?? "self"}
              error={issue?.target === "range"}
              disabled={env.isReadOnly}
              sx={{ width: 130 }}
              options={AUDIENCE_ORG_RANGES.map((range) => ({
                value: range,
                label: t(`ranges.${range}`),
              }))}
              onChange={(range) => {
                onChange({ ...condition, range });
              }}
            />
          )}
        </>
      )}
    </ConditionRow>
  );
};
