import { useTranslations } from "use-intl";

import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import type { FieldErrorTexts } from "@/lib/base/field-errors";

import type { DemandField, DemandValues } from "./demand-dialog-state";

export interface DemandTemplateCopyFieldsProps {
  values: DemandValues;
  /** 欄位 → 寫在欄位正下方的原因(REACT-18) */
  fieldErrors: FieldErrorTexts<DemandField>;
  onChange: <
    Key extends "saveAsTemplate" | "templateName" | "templateShortName",
  >(
    key: Key,
    value: DemandValues[Key],
  ) => void;
}

/**
 * 「同時存成人力需求範本」(SC-21d;規格 14.5):預設不勾;勾了要填範本名稱與簡稱(1–2 字),
 * 存檔時同時建立一筆屬於目前這一層組織的範本。只在新增、有 `edit-templates` 時由呼叫端放進來。
 */
export const DemandTemplateCopyFields = ({
  values,
  fieldErrors,
  onChange,
}: DemandTemplateCopyFieldsProps) => {
  const t = useTranslations("admin.schedule.roster.demandDialog");
  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        control={
          <Checkbox
            checked={values.saveAsTemplate}
            onChange={(event) => {
              onChange("saveAsTemplate", event.target.checked);
            }}
          />
        }
        label={t("saveAsTemplate")}
      />
      {values.saveAsTemplate && (
        <Stack direction="row" spacing={1.5}>
          {(["templateName", "templateShortName"] as const).map((field) => (
            <TextField
              key={field}
              label={t(field)}
              value={values[field]}
              required
              fullWidth
              error={fieldErrors[field] !== undefined}
              helperText={fieldErrors[field]}
              onChange={(event) => {
                onChange(field, event.target.value);
              }}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};
