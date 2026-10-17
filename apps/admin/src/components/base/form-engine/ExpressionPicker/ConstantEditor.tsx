import { useTranslations } from "use-intl";

import type { Expression, FieldDef, FieldType } from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  type ConstantKind,
  constantDefaultOf,
  constantKindOf,
  dateConstantIsoOf,
  dateConstantNode,
} from "@/lib/base/form-engine/expression-tree";

import { TypedValueInput } from "../TypedValueInput/TypedValueInput";
import { ListConstantField } from "./ListConstantField";

export interface ConstantEditorProps {
  value: Expression;
  onChange: (value: Expression) => void;
  /** 這個位置型別對得上的常數種類(型別導向;目前的種類不在清單裡時仍列出,才看得到舊值) */
  kinds: readonly ConstantKind[];
  /** 目標選項欄:選項 / 選項清單常數從它的選項挑 */
  optionTarget: FieldDef | null;
  /** 類別 / lookup 選項查詢用的表單 key */
  formKey: string;
}

/** 單值常數種類 → 輸入元件用的欄位型別(`TypedValueInput`)。 */
const INPUT_TYPES: Readonly<Partial<Record<ConstantKind, FieldType>>> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
};

/** 清掉輸入時不讓節點變成空位:文字 / 選項回空字串、數字回 0,其餘保留原值。 */
const keptOf = (
  kind: ConstantKind,
  next: unknown,
  previous: Expression,
): Expression => {
  let kept: Expression = previous;
  if (next !== null) {
    kept = next as Expression;
  } else if (kind === "text" || kind === "option") {
    kept = "";
  } else if (kind === "number") {
    kept = 0;
  }
  return kept;
};

/**
 * 常數節點:先選種類(文字 / 數字 / 是否 / 日期 / 日期時間 / 清單,或從目標選項欄挑的選項 / 選項清單),
 * 再用**依型別的輸入元件**填值(`TypedValueInput`:是否下拉、日期 / 日期時間用選擇器,不用原生日期輸入);
 * 日期常數存 `{ "date": ISO }`(當地 00:00,標成日期型別);不從文字猜型別。
 */
export const ConstantEditor = ({
  value,
  onChange,
  kinds,
  optionTarget,
  formKey,
}: ConstantEditorProps) => {
  const t = useTranslations("admin.forms.expression");
  const timezone = useTenantTimezone() ?? undefined;
  const kind = constantKindOf(value, optionTarget !== null);
  const choices = kinds.includes(kind) ? kinds : [...kinds, kind];
  const inputType = INPUT_TYPES[kind];
  const optionLabel =
    optionTarget === null
      ? t("listValue")
      : t("optionValue", { field: optionTarget.label });

  return (
    <>
      <SelectField<ConstantKind>
        label={t("constantKind")}
        value={kind}
        options={choices.map((item) => ({
          value: item,
          label: t(`constants.${item}`),
        }))}
        onChange={(next) => {
          onChange(constantDefaultOf(next, timezone));
        }}
        size="small"
        sx={{ minWidth: 110 }}
      />
      {inputType !== undefined && (
        <TypedValueInput
          field={{
            key: "constant",
            label: t("constantValue"),
            type: inputType,
            widget: { kind: "" },
          }}
          label={t("constantValue")}
          shape="expression"
          value={kind === "date" ? dateConstantIsoOf(value) : value}
          {...(timezone !== undefined && { timezone })}
          onChange={(next) => {
            const kept = keptOf(kind, next, value);
            onChange(
              kind === "date" && typeof kept === "string"
                ? dateConstantNode(kept)
                : kept,
            );
          }}
        />
      )}
      {kind === "option" && optionTarget !== null && (
        <TypedValueInput
          field={optionTarget}
          label={optionLabel}
          shape="expression"
          isMultiple={false}
          formKey={formKey}
          value={value}
          onChange={(next) => {
            onChange(keptOf(kind, next, value));
          }}
        />
      )}
      {(kind === "list" || kind === "optionList") && (
        <ListConstantField
          value={value}
          onChange={onChange}
          label={optionLabel}
          optionTarget={kind === "optionList" ? optionTarget : null}
          formKey={formKey}
        />
      )}
    </>
  );
};
