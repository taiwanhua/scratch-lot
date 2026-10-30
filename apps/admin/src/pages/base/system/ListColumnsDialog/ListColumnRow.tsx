import { useTranslations } from "use-intl";

import { ModuleListColumnKind } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useFieldErrorText } from "@/components/base/FieldErrorText/useFieldErrorText";
import {
  LIST_COLUMN_WIDTH,
  type ListColumnSpec,
  SUMMARY_SLOTS,
} from "@/lib/base/form-engine/list-columns";

import { ListTemplateColumnFields } from "./ListTemplateColumnFields";
import type { FieldCandidate } from "./useListColumnCandidates";

export interface ListColumnRowProps {
  row: ListColumnSpec;
  index: number;
  count: number;
  candidates: readonly FieldCandidate[];
  /** 共用表單(組合欄「限定表單」的選項) */
  forms: readonly { key: string; name: string }[];
  /** 這一列被 api 擋下的原因(REACT-18;寫在這一列正下方);undefined = 沒錯 */
  errorText: string | undefined;
  /** 組合欄:欄名 / 模板格式錯的原因(寫在那一格下) */
  labelErrorText: string | undefined;
  templateErrorText: string | undefined;
  onChange: (row: ListColumnSpec) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

const candidateId = (formKey: string | null | undefined, key: string) =>
  `${formKey ?? ""}:${key}`;

/** 一欄:摘要槽 / 表單欄位 / 組合欄(欄名 + 限定表單 + 模板)、欄寬(40–2000)、上移 / 下移 / 移除。 */
export const ListColumnRow = ({
  row,
  index,
  count,
  candidates,
  forms,
  errorText,
  labelErrorText,
  templateErrorText,
  onChange,
  onMove,
  onRemove,
}: ListColumnRowProps) => {
  const t = useTranslations("admin.moduleManager.listColumns");
  const isSlot = row.kind === ModuleListColumnKind.Slot;
  const isTemplate = row.kind === ModuleListColumnKind.Template;
  const hasError = errorText !== undefined;
  // 這一列被擋下的原因寫在列正下方,並連到這一列的群組(REACT-18)
  const rowError = useFieldErrorText(errorText);
  const current = candidateId(row.formKey, row.key);
  const fieldOptions = candidates.map((candidate) => ({
    value: candidateId(candidate.formKey, candidate.key),
    label: `${candidate.formName} / ${candidate.label}`,
  }));
  if (
    row.kind === ModuleListColumnKind.Field &&
    !fieldOptions.some((option) => option.value === current)
  ) {
    // 目前的版本已沒有這個欄位(改版後):仍列出來,讓 root 看得到並自己換掉
    fieldOptions.push({
      value: current,
      label: t("missingField", { key: row.key }),
    });
  }

  return (
    <Stack spacing={0.5}>
      <Stack
        direction="row"
        spacing={1}
        role="group"
        aria-label={t("row", { index: index + 1 })}
        aria-describedby={rowError.describedBy}
        useFlexGap
        // 窄螢幕(手機寬)放不下一列時換行,不撐出橫向捲動
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        {isTemplate && (
          <ListTemplateColumnFields
            row={row}
            candidates={candidates}
            forms={forms}
            labelErrorText={labelErrorText}
            templateErrorText={templateErrorText}
            hasRowError={hasError}
            onChange={onChange}
          />
        )}
        {isSlot && (
          <SelectField<string>
            label={t("slot")}
            value={row.key}
            options={SUMMARY_SLOTS.map((slot) => ({
              value: slot,
              label: t(`slots.${slot}`),
            }))}
            onChange={(key) => {
              onChange({ ...row, key });
            }}
            error={hasError}
            size="small"
            sx={{ minWidth: 200 }}
          />
        )}
        {row.kind === ModuleListColumnKind.Field && (
          <SelectField<string>
            label={t("field")}
            value={current}
            options={fieldOptions}
            onChange={(value) => {
              const picked = candidates.find(
                (candidate) =>
                  candidateId(candidate.formKey, candidate.key) === value,
              );
              if (picked !== undefined) {
                onChange({ ...row, key: picked.key, formKey: picked.formKey });
              }
            }}
            error={hasError}
            size="small"
            sx={{ minWidth: 260 }}
          />
        )}
        <TextField
          label={t("width")}
          type="number"
          size="small"
          value={String(row.width)}
          slotProps={{
            htmlInput: {
              min: LIST_COLUMN_WIDTH.min,
              max: LIST_COLUMN_WIDTH.max,
            },
          }}
          onChange={(event) => {
            onChange({ ...row, width: Number(event.target.value) });
          }}
          sx={{ width: 110 }}
        />
        <Button
          variant="text"
          size="small"
          disabled={index === 0}
          onClick={() => {
            onMove(-1);
          }}
        >
          {t("up")}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={index === count - 1}
          onClick={() => {
            onMove(1);
          }}
        >
          {t("down")}
        </Button>
        <Button variant="text" size="small" color="error" onClick={onRemove}>
          {t("remove")}
        </Button>
      </Stack>
      {rowError.errorText}
    </Stack>
  );
};
