import { useTranslations } from "use-intl";

import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";

import type {
  ReportExtraCondition,
  ReportExtraValue,
} from "@/lib/project/reports/report-registry";

export interface ReportExtraConditionFieldProps {
  condition: ReportExtraCondition;
  value: ReportExtraValue;
  onChange: (value: ReportExtraValue) => void;
}

/** 報表登記的其他條件:勾選或下拉(文字是報表登記給的訊息 key)。 */
export const ReportExtraConditionField = ({
  condition,
  value,
  onChange,
}: ReportExtraConditionFieldProps) => {
  const t = useTranslations("admin");
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
