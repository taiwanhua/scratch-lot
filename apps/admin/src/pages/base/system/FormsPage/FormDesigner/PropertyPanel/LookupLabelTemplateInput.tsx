import { useTranslations } from "use-intl";

import {
  FORM_SUBMISSION_PROVIDER,
  LOOKUP_SUMMARY_SLOTS,
  type LookupSourceDescriptor,
  VALUE_PLACEHOLDER_PREFIX,
} from "@repo/domain/form";

import { TemplatePlaceholderInput } from "@/pages/base/system/TemplatePlaceholderInput";

import type { LookupFieldOption } from "./useLookupCatalog";

export interface LookupLabelTemplateInputProps {
  value: LookupSourceDescriptor;
  /** 來源可挑的欄位;null = 還挑不了(表單提交還沒選表單、目錄載入中) */
  fieldOptions: readonly LookupFieldOption[] | null;
  onChange: (value: LookupSourceDescriptor) => void;
}

/** 一個來源欄位在模板裡的寫法:表單提交的摘要槽 `{{title}}`、欄位 `{{value.<key>}}`;其他來源 `{{欄位}}`。 */
const placeholderOf = (provider: string, field: string): string =>
  provider === FORM_SUBMISSION_PROVIDER &&
  !(LOOKUP_SUMMARY_SLOTS as readonly string[]).includes(field)
    ? `{{${VALUE_PLACEHOLDER_PREFIX}${field}}}`
    : `{{${field}}}`;

/**
 * lookup 來源的顯示模板(`labelTemplate`,選填;`docs/concepts/form-engine.md`「lookup 來源」):文字框 + 「插入欄位」下拉
 * (`TemplatePlaceholderInput`,與列表欄位配置的組合欄共用;欄位從來源可回的欄位挑,插到模板最後)。
 * 清空 = 拿掉 `labelTemplate`,顯示名回到顯示欄。
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
    <TemplatePlaceholderInput
      value={template}
      options={
        fieldOptions === null
          ? null
          : fieldOptions.map((option) => ({
              label: option.label,
              placeholder: placeholderOf(value.provider, option.value),
            }))
      }
      onChange={change}
      text={{
        label: t("labelTemplate"),
        hint: t("labelTemplateHint"),
        insert: t("insertPlaceholder"),
        insertHint: t("insertPlaceholderHint"),
      }}
    />
  );
};
