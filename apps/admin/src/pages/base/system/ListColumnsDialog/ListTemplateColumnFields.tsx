import { useTranslations } from "use-intl";

import { VALUE_PLACEHOLDER_PREFIX } from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import {
  type ListColumnSpec,
  SUMMARY_SLOTS,
} from "@/lib/base/form-engine/list-columns";
import {
  TemplatePlaceholderInput,
  type TemplatePlaceholderOption,
} from "@/pages/base/system/TemplatePlaceholderInput";

import type { FieldCandidate } from "./useListColumnCandidates";

export interface ListTemplateColumnFieldsProps {
  row: ListColumnSpec;
  candidates: readonly FieldCandidate[];
  /** 共用表單(「限定表單」的選項) */
  forms: readonly { key: string; name: string }[];
  /** 欄名 / 模板格式錯的原因(api 定位到 `columns.<i>.label` / `.template`);undefined = 沒錯 */
  labelErrorText: string | undefined;
  templateErrorText: string | undefined;
  /** 整欄被擋(引用的欄位不在了、受保護、重複):限定表單的下拉標紅,原因由列寫在下方 */
  hasRowError: boolean;
  onChange: (row: ListColumnSpec) => void;
}

/** 「限定表單」沒限定的值。 */
const ANY_FORM = "";

/**
 * 組合欄的設定:欄名(表頭,root 輸入的顯示名稱)、限定表單(選填,同表單欄位的 `formKey`)、模板
 * (`TemplatePlaceholderInput`:摘要槽與表單欄位從「插入欄位」下拉挑;欄位只列可當列表欄的,限定了表單就只列那一張的)。
 */
export const ListTemplateColumnFields = ({
  row,
  candidates,
  forms,
  labelErrorText,
  templateErrorText,
  hasRowError,
  onChange,
}: ListTemplateColumnFieldsProps) => {
  const t = useTranslations("admin.moduleManager.listColumns");
  const formKey = row.formKey ?? null;
  const seen = new Set<string>();
  const fieldOptions: TemplatePlaceholderOption[] = candidates
    .filter((candidate) => formKey === null || candidate.formKey === formKey)
    .flatMap((candidate) => {
      // 沒限定表單時,幾張表單有同一個欄位 key 只列一次(模板只寫 key,每一筆依它的版本取值)
      if (seen.has(candidate.key)) {
        return [];
      }
      seen.add(candidate.key);
      return [
        {
          label: `${candidate.formName} / ${candidate.label}`,
          placeholder: `{{${VALUE_PLACEHOLDER_PREFIX}${candidate.key}}}`,
        },
      ];
    });
  const options: TemplatePlaceholderOption[] = [
    ...SUMMARY_SLOTS.map((slot) => ({
      label: t("slotPlaceholder", { name: t(`slots.${slot}`) }),
      placeholder: `{{${slot}}}`,
    })),
    ...fieldOptions,
  ];

  return (
    <Stack spacing={1} sx={{ flex: 1, minWidth: 240 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField
          label={t("templateLabel")}
          value={row.label ?? ""}
          error={labelErrorText !== undefined}
          helperText={labelErrorText ?? t("templateLabelHint")}
          onChange={(event) => {
            onChange({ ...row, label: event.target.value });
          }}
          size="small"
          sx={{ flex: 1, minWidth: 160 }}
        />
        <SelectField<string>
          label={t("templateForm")}
          value={formKey ?? ANY_FORM}
          displayEmpty
          options={[
            { value: ANY_FORM, label: t("anyForm") },
            ...forms.map((form) => ({ value: form.key, label: form.name })),
          ]}
          onChange={(value) => {
            onChange({ ...row, formKey: value === ANY_FORM ? null : value });
          }}
          error={hasRowError}
          size="small"
          sx={{ flex: 1, minWidth: 160 }}
        />
      </Stack>
      <TemplatePlaceholderInput
        value={row.key}
        options={options}
        onChange={(key) => {
          onChange({ ...row, key });
        }}
        text={{
          label: t("templateText"),
          hint: t("templateTextHint"),
          insert: t("insertPlaceholder"),
          insertHint: t("insertPlaceholderHint"),
        }}
        {...(templateErrorText !== undefined && {
          errorText: templateErrorText,
        })}
      />
    </Stack>
  );
};
