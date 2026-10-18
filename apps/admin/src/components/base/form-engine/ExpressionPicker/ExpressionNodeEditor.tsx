import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import {
  CONTEXT_VAR_PATHS,
  type Expression,
  type FieldDef,
  type FieldTypeLookup,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  type PickerPosition,
  type PositionOptions,
  initialExpressionOf,
  positionOptionsOf,
} from "@/lib/base/form-engine/expression-options";
import {
  CONSTANT_KINDS,
  type ExpressionNodeKind,
  PICKER_OPERATORS,
  type PickerOperator,
  constantDefaultOf,
  constantKindOf,
  contextNode,
  fieldNode,
  nodeKindOf,
  operationNode,
  operatorOf,
  varPathOf,
  withOperator,
} from "@/lib/base/form-engine/expression-tree";

import { ConstantEditor } from "./ConstantEditor";
import { ExpressionGroup } from "./ExpressionGroup";
// eslint-disable-next-line import-x/no-cycle -- 表達式樹本身遞迴:運算節點的參數又是節點;到期條件:無(遞迴結構)
import { OperationArgs } from "./OperationArgs";

export interface ExpressionNodeEditorProps {
  value: Expression;
  onChange: (value: Expression) => void;
  /** 可引用的欄位(呼叫端已依用途過濾:條件不含受保護欄位、顯示條件不含自己) */
  fields: readonly FieldDef[];
  /** 這個位置要什麼型別、用途、是不是根、目標選項欄(型別導向過濾) */
  position: PickerPosition;
  fieldTypeOf: FieldTypeLookup;
  /** 這個節點在樹裡的位置(無障礙名稱與檢查器定位用;根為空字串) */
  path: string;
  depth: number;
  /** 類別 / lookup 選項常數查詢用的表單 key(設計器 = 草稿) */
  formKey: string;
  /** 沒有任何欄位可選時,欄位下拉顯示的提示(見 `ExpressionPicker`) */
  emptyFieldsLabel?: string;
}

/** 空位的下拉值(「請選節點種類」)。 */
const EMPTY = "";

/** 換節點種類時的起點值:取這個位置第一個型別對得上的選項;運算照位置的偏好(條件 → 等於)。 */
const nodeDefaultOf = (
  kind: ExpressionNodeKind,
  options: PositionOptions,
  position: PickerPosition,
  timezone: string | undefined,
): Expression => {
  switch (kind) {
    case "field": {
      return fieldNode(options.fields.at(0)?.key ?? "");
    }
    case "context": {
      return contextNode(options.contexts.at(0) ?? CONTEXT_VAR_PATHS[0]);
    }
    case "operation": {
      const preferred = initialExpressionOf(position.expected);
      return options.operators.includes(operatorOf(preferred) as PickerOperator)
        ? preferred
        : operationNode(options.operators.at(0) ?? "==");
    }
    case "constant": {
      return constantDefaultOf(
        options.constants.at(0) ?? CONSTANT_KINDS[0],
        timezone,
      );
    }
    case "empty": {
      return null;
    }
  }
};

const isPickerOperator = (
  operator: string | null,
): operator is PickerOperator =>
  operator !== null &&
  (PICKER_OPERATORS as readonly string[]).includes(operator);

/** 目前的值不在選項裡(舊資料)時仍列出,SelectField 才顯示得出來。 */
const withCurrent = <Item extends string>(
  items: readonly Item[],
  current: Item | null,
): Item[] =>
  current === null || items.includes(current)
    ? [...items]
    : [...items, current];

/**
 * 節點種類下拉的選項:空位時第一項是停用的「請選節點種類」;比較的參數(`allowNull`)選了東西之後
 * 多一項「清空(= 空值)」回到空位(`== null` 判空)。
 */
const kindOptionsOf = (
  kind: ExpressionNodeKind,
  kinds: readonly ExpressionNodeKind[],
  allowNull: boolean,
  label: (key: string) => string,
): {
  value: ExpressionNodeKind | typeof EMPTY;
  label: string;
  disabled?: boolean;
}[] => {
  if (kind === "empty") {
    return [
      { value: EMPTY, label: label("emptySlot"), disabled: true },
      ...kinds.map((item) => ({ value: item, label: label(`kinds.${item}`) })),
    ];
  }
  return [
    ...withCurrent(kinds, kind).map((item) => ({
      value: item,
      label: label(`kinds.${item}`),
    })),
    ...(allowNull
      ? [{ value: "empty" as const, label: label("clearToNull") }]
      : []),
  ];
};

/**
 * 表達式樹的一個節點(型別導向的結構化選擇器):先選種類
 * (欄位 / 系統值 / 常數 / 運算;還沒選的參數是空位「請選節點種類」),再選欄位 / 系統值 / 常數值 / 運算子;
 * 運算節點的參數由 `OperationArgs` 遞迴畫,巢狀的運算畫成帶框縮排群組(`ExpressionGroup`,標頭是運算子名)。
 * **不做文字輸入**,不會產生白名單外的運算子;深度、節點數、引用與循環仍由檢查器把關。
 */
export const ExpressionNodeEditor = ({
  value,
  onChange,
  fields,
  position,
  fieldTypeOf,
  path,
  depth,
  formKey,
  emptyFieldsLabel,
}: ExpressionNodeEditorProps) => {
  const t = useTranslations("admin.forms.expression");
  const timezone = useTenantTimezone() ?? undefined;
  const options = positionOptionsOf(position, fields);
  const kind = nodeKindOf(value);
  const isEmpty = kind === "empty";
  const at = path === "" ? t("root") : path;
  const operator = operatorOf(value);
  const fieldChoices = fields.filter(
    (field) => options.fields.includes(field) || field.key === varPathOf(value),
  );
  const isFieldListEmpty =
    fieldChoices.length === 0 && emptyFieldsLabel !== undefined;
  const kindOptions = kindOptionsOf(
    kind,
    options.kinds,
    position.allowNull,
    (key) => t(key),
  );

  const header = (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <SelectField<ExpressionNodeKind | typeof EMPTY>
        label={t("kind", { path: at })}
        value={isEmpty ? EMPTY : kind}
        displayEmpty={isEmpty}
        {...(isEmpty &&
          position.allowNull && { helperText: t("emptyMeansNull") })}
        options={kindOptions}
        onChange={(next) => {
          if (next !== EMPTY) {
            onChange(nodeDefaultOf(next, options, position, timezone));
          }
        }}
        size="small"
        sx={{ minWidth: 140 }}
      />
      {kind === "field" && (
        <SelectField
          label={t("field")}
          value={varPathOf(value)}
          disabled={isFieldListEmpty}
          {...(isFieldListEmpty && varPathOf(value) !== ""
            ? { helperText: emptyFieldsLabel }
            : {})}
          options={
            isFieldListEmpty
              ? // 目前值照樣顯示(不蓋成提示字);沒有值時才以提示字當唯一選項
                [
                  {
                    value: varPathOf(value),
                    label:
                      varPathOf(value) === ""
                        ? emptyFieldsLabel
                        : varPathOf(value),
                  },
                ]
              : fieldChoices.map((field) => ({
                  value: field.key,
                  label: `${field.label}(${field.key})`,
                }))
          }
          onChange={(next) => {
            onChange(fieldNode(next));
          }}
          size="small"
          sx={{ minWidth: 160 }}
        />
      )}
      {kind === "context" && (
        <SelectField<string>
          label={t("context")}
          value={varPathOf(value)}
          options={withCurrent<string>(options.contexts, varPathOf(value)).map(
            (item) => ({ value: item, label: t(`contexts.${item}`) }),
          )}
          onChange={(next) => {
            onChange(contextNode(next));
          }}
          size="small"
          sx={{ minWidth: 160 }}
        />
      )}
      {kind === "operation" && (
        <SelectField<string>
          label={t("operator")}
          value={operator ?? ""}
          options={withCurrent<string>(options.operators, operator).map(
            (item) => ({ value: item, label: t(`operators.${item}`) }),
          )}
          onChange={(next) => {
            onChange(withOperator(value, next));
          }}
          size="small"
          sx={{ minWidth: 160 }}
        />
      )}
      {kind === "constant" && (
        <ConstantEditor
          value={value}
          onChange={onChange}
          kinds={withCurrent(
            options.constants,
            constantKindOf(value, position.optionTarget !== null),
          )}
          optionTarget={position.optionTarget}
          formKey={formKey}
        />
      )}
    </Stack>
  );

  if (kind !== "operation" || !isPickerOperator(operator)) {
    return header;
  }
  const body: ReactNode = (
    <>
      {header}
      <OperationArgs
        value={value}
        operator={operator}
        onChange={onChange}
        fields={fields}
        position={position}
        fieldTypeOf={fieldTypeOf}
        path={path}
        depth={depth}
        formKey={formKey}
        {...(emptyFieldsLabel !== undefined && { emptyFieldsLabel })}
      />
    </>
  );
  // 根的運算不加框(外面已是選擇器本身);巢狀的運算畫成帶框縮排群組
  return depth === 0 ? (
    <Stack spacing={1}>{body}</Stack>
  ) : (
    <ExpressionGroup title={t(`operators.${operator}`)}>{body}</ExpressionGroup>
  );
};
