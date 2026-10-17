import { useTranslations } from "use-intl";

import {
  type ArrayColumnDef,
  type ColumnPrefill,
  type PrefillMapping,
  isPrefillCompatible,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useLookupFieldOptions } from "../useLookupCatalog";
import { useRowIds } from "../useRowIds";

export interface ColumnPrefillEditorProps {
  /** 引用子欄(來源 = 它的 `source`) */
  column: ArrayColumnDef;
  /** 同一明細的其他子欄 */
  siblings: readonly ArrayColumnDef[];
  /** 對應表清空 → null(拿掉 `prefill`) */
  onChange: (prefill: ColumnPrefill | null) => void;
}

const UNSET = "";

/**
 * 明細引用子欄的列內帶入(《底座規格》3.2 B2c):沿用表單層帶入規則的對應表(`PrefillEditor`)——
 * 每列「本列子欄位 ← 來源欄位」;子欄位只列同一列使用者填、不是引用的,來源欄位只列型別相容的
 * (`isPrefillCompatible`,與檢查器同一支)。選定 / 改選時覆蓋同列目標,之後可手動改;伺服器不強制。
 */
export const ColumnPrefillEditor = ({
  column,
  siblings,
  onChange,
}: ColumnPrefillEditorProps) => {
  const t = useTranslations("admin.forms.columns");
  const source = column.source ?? { provider: "user", labelField: "name" };
  const catalog = useLookupFieldOptions(source, null);
  const mapping: readonly PrefillMapping[] = column.prefill?.mapping ?? [];
  const rows = useRowIds(mapping.length);
  const targets = siblings.filter(
    (candidate) =>
      candidate.valueSource.kind === "input" && candidate.type !== "reference",
  );
  const commit = (next: PrefillMapping[]) => {
    onChange(next.length === 0 ? null : { mapping: next });
  };

  return (
    <Stack spacing={1} role="group" aria-label={t("prefill")}>
      <Stack spacing={0.25}>
        <Typography variant="body2">{t("prefill")}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t("prefillHint")}
        </Typography>
      </Stack>
      {mapping.map((entry, position) => {
        const target = targets.find(
          (candidate) => candidate.key === entry.fieldKey,
        );
        const choices = (catalog ?? []).filter(
          (option) =>
            target === undefined ||
            isPrefillCompatible(option.type, target.type),
        );
        return (
          <Stack
            key={rows.ids[position]}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <SelectField<string>
              label={t("prefillTarget")}
              value={entry.fieldKey}
              displayEmpty
              options={[
                { value: UNSET, label: t("prefillTargetUnset") },
                ...targets.map((candidate) => ({
                  value: candidate.key,
                  label: `${candidate.label}(${candidate.key})`,
                })),
              ]}
              onChange={(fieldKey) => {
                commit(
                  mapping.map((item, at) =>
                    at === position ? { ...item, fieldKey } : item,
                  ),
                );
              }}
              size="small"
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Typography aria-hidden>←</Typography>
            <SelectField<string>
              label={t("prefillSource")}
              value={catalog === null ? UNSET : entry.sourceField}
              displayEmpty
              disabled={catalog === null}
              options={[
                { value: UNSET, label: t("prefillSourceUnset") },
                ...choices.map(({ value, label }) => ({ value, label })),
                ...(entry.sourceField !== UNSET &&
                !choices.some((option) => option.value === entry.sourceField)
                  ? [{ value: entry.sourceField, label: entry.sourceField }]
                  : []),
              ]}
              onChange={(sourceField) => {
                commit(
                  mapping.map((item, at) =>
                    at === position ? { ...item, sourceField } : item,
                  ),
                );
              }}
              size="small"
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Button
              variant="text"
              size="small"
              onClick={() => {
                rows.removed(position);
                commit(mapping.filter((_item, at) => at !== position));
              }}
            >
              {t("removePrefill")}
            </Button>
          </Stack>
        );
      })}
      <Stack direction="row">
        <Button
          variant="text"
          size="small"
          disabled={targets.length === 0}
          onClick={() => {
            rows.added();
            commit([
              ...mapping,
              { sourceField: UNSET, fieldKey: targets.at(0)?.key ?? UNSET },
            ]);
          }}
        >
          {t("addPrefill")}
        </Button>
      </Stack>
    </Stack>
  );
};
