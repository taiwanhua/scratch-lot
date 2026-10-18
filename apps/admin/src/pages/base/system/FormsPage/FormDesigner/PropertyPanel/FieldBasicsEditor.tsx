import { useTranslations } from "use-intl";

import { type FieldDef, LAYOUT_COLUMNS } from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { widgetKindsFor } from "@/components/base/form-engine/widgets/widget-registry";
import type { FieldKeyProblem } from "@/lib/base/form-engine/designer-ops";
import type { PropertySections } from "@/lib/base/form-engine/property-sections";
import { scalarText } from "@/lib/base/form-engine/value-text";

import { FieldKeyInput } from "./FieldKeyInput";

export interface FieldBasicsEditorProps {
  field: FieldDef;
  span: number | null;
  sections: PropertySections;
  keyProblemOf: (key: string) => FieldKeyProblem | null;
  onChange: (field: FieldDef) => void;
  onSpanChange: (span: number) => void;
}

const SPANS = Array.from(
  { length: LAYOUT_COLUMNS },
  (_item, index) => index + 1,
);
const PRECISIONS = [0, 1, 2, 3, 4, 5, 6];

/** 元件設定:空字串 = 拿掉這個設定(不存 `""` 進定義)。 */
const withWidgetSetting = (
  field: FieldDef,
  setting: string,
  value: unknown,
): FieldDef => {
  const widget = { ...field.widget };
  if (value === "" || value === undefined) {
    Reflect.deleteProperty(widget, setting);
  } else {
    widget[setting] = value;
  }
  return { ...field, widget };
};

/**
 * 欄位基本屬性:key(改的當下擋格式、保留字、重複)、標題、說明、寬度(12 格制)、
 * 元件(該型別有兩種以上畫法才出現)與元件設定(多行文字的列數、數字的單位)、小數位數(只有數字)。
 */
export const FieldBasicsEditor = ({
  field,
  span,
  sections,
  keyProblemOf,
  onChange,
  onSpanChange,
}: FieldBasicsEditorProps) => {
  const t = useTranslations("admin.forms.property");

  return (
    <Stack spacing={1.5}>
      <FieldKeyInput
        value={field.key}
        problemOf={keyProblemOf}
        onCommit={(key) => {
          onChange({ ...field, key });
        }}
      />
      <TextField
        label={t("label")}
        size="small"
        value={field.label}
        onChange={(event) => {
          onChange({ ...field, label: event.target.value });
        }}
      />
      <TextField
        label={t("type")}
        size="small"
        value={t(`types.${field.type}`)}
        disabled
      />
      {sections.widget && (
        <SelectField
          label={t("widget")}
          value={field.widget.kind}
          options={widgetKindsFor(field.type).map((kind) => ({
            value: kind,
            label: t(`widgets.${kind}`),
          }))}
          onChange={(kind) => {
            onChange({ ...field, widget: { ...field.widget, kind } });
          }}
          size="small"
        />
      )}
      {sections.widgetRows && (
        <TextField
          label={t("rows")}
          size="small"
          type="number"
          value={scalarText(field.widget.rows)}
          onChange={(event) => {
            const text = event.target.value.trim();
            onChange(
              withWidgetSetting(field, "rows", text === "" ? "" : Number(text)),
            );
          }}
        />
      )}
      {sections.widgetUnit && (
        <TextField
          label={t("unit")}
          size="small"
          value={scalarText(field.widget.unit)}
          onChange={(event) => {
            onChange(withWidgetSetting(field, "unit", event.target.value));
          }}
        />
      )}
      {!sections.span && (
        <Typography variant="caption" color="text.secondary">
          {t("spanFixed")}
        </Typography>
      )}
      {span !== null && sections.span && (
        <SelectField
          label={t("span")}
          value={String(span)}
          options={SPANS.map((item) => ({
            value: String(item),
            label: String(item),
          }))}
          onChange={(next) => {
            onSpanChange(Number(next));
          }}
          size="small"
        />
      )}
      {sections.numberRange && (
        <SelectField
          label={t("precision")}
          value={String(field.precision ?? 0)}
          options={PRECISIONS.map((item) => ({
            value: String(item),
            label: String(item),
          }))}
          onChange={(next) => {
            onChange({ ...field, precision: Number(next) });
          }}
          size="small"
        />
      )}
      <TextField
        label={t("help")}
        size="small"
        value={field.help ?? ""}
        onChange={(event) => {
          onChange({
            ...field,
            help: event.target.value === "" ? null : event.target.value,
          });
        }}
      />
    </Stack>
  );
};
