import { useTranslations } from "use-intl";

import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";

import type {
  ReportExtraCondition,
  ReportExtraValue,
  ReportQueryInput,
} from "@/lib/base/reports/report-registry";

export interface ReportExtraConditionFieldProps {
  condition: ReportExtraCondition;
  value: ReportExtraValue;
  onChange: (value: ReportExtraValue) => void;
  /** 目前選的組織(自訂欄位用) */
  orgIds: readonly string[];
  /** 目前條件組成的查詢 input(自訂欄位用) */
  input: ReportQueryInput | null;
}

/** 報表登記的其他條件:勾選、下拉或報表自訂的欄位(文字是報表登記給的訊息 key)。 */
export const ReportExtraConditionField = ({
  condition,
  value,
  onChange,
  orgIds,
  input,
}: ReportExtraConditionFieldProps) => {
  const t = useTranslations("admin");
  if (condition.type === "custom") {
    const { Field } = condition;
    return (
      <Field
        label={t(condition.label)}
        value={typeof value === "string" ? value : condition.defaultValue}
        onChange={onChange}
        orgIds={orgIds}
        input={input}
      />
    );
  }
  if (condition.type === "boolean") {
    return (
      <FormControlLabel
        control={
          <Checkbox
            checked={value === true}
            onChange={(_event, checked) => {
              onChange(checked);
            }}
          />
        }
        label={t(condition.label)}
      />
    );
  }
  return (
    <SelectField
      label={t(condition.label)}
      size="small"
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
      options={condition.options.map((option) => ({
        value: option.value,
        label: t(option.label),
      }))}
    />
  );
};
