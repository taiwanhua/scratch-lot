import { useTranslations } from "use-intl";

import {
  type FieldDef,
  type Prefill,
  isPrefillCompatible,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { LookupSourceEditor } from "../PropertyPanel/LookupSourceEditor";
import {
  type LookupFieldOption,
  type SelfFormCatalog,
  useLookupFieldOptions,
} from "../PropertyPanel/useLookupCatalog";
import { useRowIds } from "../PropertyPanel/useRowIds";

export interface PrefillEditorProps {
  prefill: Prefill;
  index: number;
  fields: readonly FieldDef[];
  /** 目前在設計的表單(key / 名稱):來源可選自己,欄位目錄用草稿欄位(`fields`) */
  form: { key: string; name: string };
  onChange: (prefill: Prefill) => void;
  onRemove: () => void;
}

const UNSET = "";

/** 來源欄位的選項:只列能帶進目標欄位的(型別相容,與檢查器同一支 `isPrefillCompatible`);目前的值照樣列出。 */
const sourceChoicesOf = (
  catalog: readonly LookupFieldOption[],
  target: FieldDef | undefined,
  current: string,
): { value: string; label: string }[] => {
  const compatible = catalog.filter(
    (option) =>
      target === undefined || isPrefillCompatible(option.type, target.type),
  );
  const choices = compatible.map(({ value, label }) => ({ value, label }));
  return current === UNSET || choices.some((choice) => choice.value === current)
    ? choices
    : [...choices, { value: current, label: current }];
};

/**
 * 一條帶入規則(Spec 6a §5「帶入」),照填寫時的四步排:規則名稱(帶入跳窗的來源下拉顯示它)→ 來源 / 表單 /
 * 顯示欄 / 固定條件(`LookupSourceEditor`)→ 對應表。對應表每列兩個下拉:本表單欄位只列「使用者填」的
 * (不能帶進計算 / 固定值 / 引用)← 來源欄位只列型別相容的。來源欄位存在與型別相容仍由檢查器把關。
 */
export const PrefillEditor = ({
  prefill,
  index,
  fields,
  form,
  onChange,
  onRemove,
}: PrefillEditorProps) => {
  const t = useTranslations("admin.forms.prefill");
  const self: SelfFormCatalog = { key: form.key, name: form.name, fields };
  const catalog = useLookupFieldOptions(prefill.source, self);
  // 對應表的列以穩定內部 id 當 React key(不用內容:換欄位時整列重掛會失焦)
  const rows = useRowIds(prefill.mapping.length);
  const targets = fields.filter(
    (field) =>
      field.valueSource.kind === "input" &&
      field.type !== "reference" &&
      field.type !== "array",
  );
  const setMapping = (
    position: number,
    patch: Partial<Prefill["mapping"][number]>,
  ) => {
    onChange({
      ...prefill,
      mapping: prefill.mapping.map((item, at) =>
        at === position ? { ...item, ...patch } : item,
      ),
    });
  };

  return (
    <Stack
      spacing={1.5}
      role="group"
      aria-label={t("rule", { index: index + 1 })}
    >
      <TextField
        label={t("label")}
        size="small"
        value={prefill.label}
        helperText={t("labelHint")}
        onChange={(event) => {
          onChange({ ...prefill, label: event.target.value });
        }}
      />
      <LookupSourceEditor
        value={prefill.source}
        hasValueField={false}
        selfForm={self}
        onChange={(source) => {
          onChange({ ...prefill, source });
        }}
      />
      <Stack spacing={0.25}>
        <Typography variant="body2">{t("mapping")}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t("mappingHint")}
        </Typography>
      </Stack>
      {prefill.mapping.map((entry, position) => {
        const target = targets.find((field) => field.key === entry.fieldKey);
        return (
          <Stack
            key={rows.ids[position]}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <SelectField
              label={t("targetField")}
              value={entry.fieldKey}
              displayEmpty
              options={[
                { value: UNSET, label: t("targetUnset") },
                ...targets.map((field) => ({
                  value: field.key,
                  label: `${field.label}(${field.key})`,
                })),
              ]}
              onChange={(fieldKey) => {
                setMapping(position, { fieldKey });
              }}
              size="small"
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Typography aria-hidden>←</Typography>
            <SelectField
              label={t("sourceField")}
              value={catalog === null ? UNSET : entry.sourceField}
              displayEmpty
              disabled={catalog === null}
              options={[
                { value: UNSET, label: t("sourceFieldUnset") },
                ...(catalog === null
                  ? []
                  : sourceChoicesOf(catalog, target, entry.sourceField)),
              ]}
              onChange={(sourceField) => {
                setMapping(position, { sourceField });
              }}
              size="small"
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Button
              variant="text"
              size="small"
              onClick={() => {
                rows.removed(position);
                onChange({
                  ...prefill,
                  mapping: prefill.mapping.filter(
                    (_item, at) => at !== position,
                  ),
                });
              }}
            >
              {t("removeMapping")}
            </Button>
          </Stack>
        );
      })}
      <Stack direction="row" spacing={1}>
        <Button
          variant="text"
          size="small"
          disabled={targets.length === 0}
          onClick={() => {
            rows.added();
            onChange({
              ...prefill,
              mapping: [
                ...prefill.mapping,
                { sourceField: UNSET, fieldKey: targets.at(0)?.key ?? UNSET },
              ],
            });
          }}
        >
          {t("addMapping")}
        </Button>
        <Button variant="text" size="small" color="error" onClick={onRemove}>
          {t("remove")}
        </Button>
      </Stack>
    </Stack>
  );
};
