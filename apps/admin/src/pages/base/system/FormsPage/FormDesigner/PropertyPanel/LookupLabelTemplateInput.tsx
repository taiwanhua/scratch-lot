import { useTranslations } from "use-intl";

import {
  FORM_SUBMISSION_PROVIDER,
  LOOKUP_SUMMARY_SLOTS,
  type LookupSourceDescriptor,
  VALUE_PLACEHOLDER_PREFIX,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import type { LookupFieldOption } from "./useLookupCatalog";

export interface LookupLabelTemplateInputProps {
  value: LookupSourceDescriptor;
  /** 來源可挑的欄位;null = 還挑不了(表單提交還沒選表單、目錄載入中) */
  fieldOptions: readonly LookupFieldOption[] | null;
  onChange: (value: LookupSourceDescriptor) => void;
}

const UNSET = "";

/** 一個來源欄位在模板裡的寫法:表單提交的摘要槽 `{{title}}`、欄位 `{{value.<key>}}`;其他來源 `{{欄位}}`。 */
const placeholderOf = (provider: string, field: string): string =>
  provider === FORM_SUBMISSION_PROVIDER &&
  !(LOOKUP_SUMMARY_SLOTS as readonly string[]).includes(field)
    ? `{{${VALUE_PLACEHOLDER_PREFIX}${field}}}`
    : `{{${field}}}`;

/**
 * lookup 來源的顯示模板(`labelTemplate`,選填;`docs/concepts/form-engine.md`「lookup 來源」):文字框 + 「插入欄位」下拉
 * (欄位從來源可回的欄位挑,插到模板最後)。清空 = 拿掉 `labelTemplate`,顯示名回到顯示欄。
 * 顯示名由 api `formLookup` 在後端組好,這裡不預覽。
 */
export const LookupLabelTemplateInput = ({
  value,
  fieldOptions,
  onChange,
}: LookupLabelTemplateInputProps) => {
  const t = useTranslations("admin.forms.lookupSource");
  const template = value.labelTemplate ?? "";
  const change = (next: string) => {
    const source = { ...value, labelTemplate: next };
    if (next.trim() === "") {
      Reflect.deleteProperty(source, "labelTemplate");
    }
    onChange(source);
  };

  return (
    <Stack spacing={1}>
      <TextField
        label={t("labelTemplate")}
        value={template}
        helperText={t("labelTemplateHint")}
        onChange={(event) => {
          change(event.target.value);
        }}
        size="small"
      />
      <SelectField<string>
        label={t("insertPlaceholder")}
        value={UNSET}
        displayEmpty
        disabled={fieldOptions === null || fieldOptions.length === 0}
        helperText={t("insertPlaceholderHint")}
        options={[
          { value: UNSET, label: "—" },
          ...(fieldOptions ?? []).map((option) => ({
            value: option.value,
            label: option.label,
          })),
        ]}
        onChange={(field) => {
          if (field !== UNSET) {
            change(`${template}${placeholderOf(value.provider, field)}`);
          }
        }}
        size="small"
      />
    </Stack>
  );
};
