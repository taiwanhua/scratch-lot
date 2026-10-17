import { useTranslations } from "use-intl";

import {
  DATE_ADD_DIRECTIONS,
  DEFAULT_DATE_DIFF_UNIT,
  type DateDiffUnit,
  type Expression,
  type FieldDef,
  LOCAL_CALENDAR_UNITS,
  type LiteralParamKind,
  PICKABLE_DATE_DIFF_UNITS,
  arrayColumnsOf,
  isCalendarUnit,
  isDateAddDirection,
  isDateDiffUnit,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";

/** 選擇器畫成下拉的字面值參數(日期常數的 ISO 由常數編輯處理,不在這裡)。 */
export type SpecialArgKind = Exclude<LiteralParamKind, "dateLiteral">;

export interface SpecialArgEditorProps {
  /**
   * `dateUnit` = `dateDiff` 的單位;`dateDirection` / `calendarUnit` = `dateAdd` 的方向 / 日曆單位;
   * `optionField` = `optionLabel` 要取顯示名的選項欄位
   */
  kind: SpecialArgKind;
  value: Expression | undefined;
  onChange: (value: Expression) => void;
  fields: readonly FieldDef[];
  /** 這個運算節點的全部參數(彙總的子欄下拉要看第一個參數挑了哪個明細欄) */
  args?: readonly Expression[];
}

const SMALL = { size: "small", sx: { minWidth: 120 } } as const;

/**
 * 不是一般值的參數位置(Spec 6a §5 表 B):`dateDiff` 的單位下拉(天 = 日曆日、小時 / 分鐘 = 精確差;
 * 缺參數視為天)、`dateAdd` 的方向(之前 / 之後)與日曆單位(天 / 週 / 月 / 年)下拉、
 * `optionLabel` 的選項欄位下拉(只列單選 / 多選欄,存欄位 key 字串)、彙總的明細欄 / 數字子欄下拉(存 key 字串)。
 */
export const SpecialArgEditor = ({
  kind,
  value,
  onChange,
  fields,
  args = [],
}: SpecialArgEditorProps) => {
  const t = useTranslations("admin.forms.expression");
  const tForms = useTranslations("admin.forms");
  const keyPicker = (
    label: string,
    unset: string,
    choices: readonly { key: string; label: string }[],
  ) => (
    <SelectField
      label={label}
      value={typeof value === "string" ? value : ""}
      displayEmpty
      options={[
        { value: "", label: unset },
        ...choices.map((choice) => ({
          value: choice.key,
          label: tForms("labelWithKey", {
            label: choice.label,
            key: choice.key,
          }),
        })),
      ]}
      onChange={(key) => {
        onChange(key === "" ? null : key);
      }}
      size="small"
      sx={{ minWidth: 160 }}
    />
  );

  if (kind === "arrayField") {
    return keyPicker(
      t("arrayField"),
      t("arrayFieldUnset"),
      fields.filter((field) => field.type === "array"),
    );
  }
  if (kind === "arrayColumn") {
    const array = fields.find(
      (field) => field.type === "array" && field.key === args[0],
    );
    return keyPicker(
      t("arrayColumn"),
      t("arrayColumnUnset"),
      array === undefined
        ? []
        : arrayColumnsOf(array).filter((column) => column.type === "number"),
    );
  }

  if (kind === "dateUnit") {
    return (
      <SelectField<DateDiffUnit>
        {...SMALL}
        label={t("unit")}
        value={isDateDiffUnit(value) ? value : DEFAULT_DATE_DIFF_UNIT}
        options={PICKABLE_DATE_DIFF_UNITS.map((unit) => ({
          value: unit,
          label: t(`units.${unit}`),
        }))}
        onChange={onChange}
      />
    );
  }
  if (kind === "dateDirection") {
    return (
      <SelectField<string>
        {...SMALL}
        label={t("direction")}
        value={isDateAddDirection(value) ? value : "after"}
        options={DATE_ADD_DIRECTIONS.map((direction) => ({
          value: direction,
          label: t(`directions.${direction}`),
        }))}
        onChange={onChange}
      />
    );
  }
  if (kind === "calendarUnit") {
    return (
      <SelectField<string>
        {...SMALL}
        label={t("unit")}
        value={isCalendarUnit(value) ? value : "days"}
        options={LOCAL_CALENDAR_UNITS.map((unit) => ({
          value: unit,
          label: t(`calendarUnits.${unit}`),
        }))}
        onChange={onChange}
      />
    );
  }
  const choices = fields.filter(
    (field) => field.type === "select" || field.type === "multiSelect",
  );
  return (
    <SelectField
      label={t("optionField")}
      value={typeof value === "string" ? value : ""}
      displayEmpty
      options={[
        { value: "", label: t("optionFieldUnset") },
        ...choices.map((field) => ({
          value: field.key,
          label: tForms("labelWithKey", {
            label: field.label,
            key: field.key,
          }),
        })),
      ]}
      onChange={(fieldKey) => {
        onChange(fieldKey === "" ? null : fieldKey);
      }}
      size="small"
      sx={{ minWidth: 160 }}
    />
  );
};
