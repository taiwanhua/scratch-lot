import { useTranslations } from "use-intl";

import {
  type Expression,
  type FieldDef,
  type FieldTypeLookup,
  OPERATOR_SIGNATURES,
  expectedTypesAt,
  paramSpecAt,
} from "@repo/domain/form";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import {
  EQUALITY_OPERATORS,
  type PickerPosition,
  optionTargetAt,
} from "@/lib/base/form-engine/expression-options";
import {
  type PickerOperator,
  argsOf,
  defaultArgOf,
  withArgs,
} from "@/lib/base/form-engine/expression-tree";

// eslint-disable-next-line import-x/no-cycle -- 表達式樹本身遞迴:參數是一個節點(ExpressionNodeEditor 畫運算節點時再畫參數);到期條件:無(遞迴結構)
import { ExpressionNodeEditor } from "./ExpressionNodeEditor";
import { SpecialArgEditor } from "./SpecialArgEditor";

export interface OperationArgsProps {
  /** 運算節點(`{ "<運算子>": [參數…] }`) */
  value: Expression;
  operator: PickerOperator;
  onChange: (value: Expression) => void;
  fields: readonly FieldDef[];
  /** 這個運算節點自己的位置(參數的期望型別、目標選項欄由它推) */
  position: PickerPosition;
  fieldTypeOf: FieldTypeLookup;
  path: string;
  depth: number;
  formKey: string;
  emptyFieldsLabel?: string;
}

/** 設定第 `index` 個參數(位置還不存在時補 null;`dateDiff` 舊資料只有兩個參數時寫單位用)。 */
const setArg = (
  value: Expression,
  index: number,
  next: Expression,
): Expression =>
  withArgs(value, (args) => {
    const padded = [
      ...args,
      ...Array.from(
        { length: Math.max(0, index + 1 - args.length) },
        () => null,
      ),
    ];
    return padded.map((item, position) => (position === index ? next : item));
  });

const removeArg = (value: Expression, index: number): Expression =>
  withArgs(value, (args) =>
    args.filter((_item, position) => position !== index),
  );

const childPathOf = (path: string, operator: string, index: number): string =>
  [path, operator, String(index)].filter((part) => part !== "").join(".");

/** 固定參數數量的運算子,舊資料少了尾端參數(`dateDiff` 的單位)時照樣畫出位置。 */
const shownArgsOf = (
  operator: PickerOperator,
  args: readonly Expression[],
): Expression[] => {
  const arity = OPERATOR_SIGNATURES[operator].params.length;
  return operator === "dateDiff" && args.length < arity
    ? [...args, ...Array.from({ length: arity - args.length }, () => null)]
    : [...args];
};

/** 且 / 或:加的是一個條件(預設「等於」比較),按鈕叫「+ 條件」。 */
const CONDITION_LIST_OPERATORS: ReadonlySet<string> = new Set(["and", "or"]);

/**
 * 運算節點的參數清單:每個參數遞迴是一個節點,帶該位置的**期望型別**與**目標選項欄**往下傳;
 * 字面值參數(單位、方向、選項欄位)畫成下拉。變長運算子可增減參數(且 / 或的「+ 條件」預設加一個比較)。
 */
export const OperationArgs = ({
  value,
  operator,
  onChange,
  fields,
  position,
  fieldTypeOf,
  path,
  depth,
  formKey,
  emptyFieldsLabel,
}: OperationArgsProps) => {
  const t = useTranslations("admin.forms.expression");
  const signature = OPERATOR_SIGNATURES[operator];
  const args = argsOf(value);

  return (
    <Stack spacing={1}>
      {shownArgsOf(operator, args).map((arg, index) => {
        const spec = paramSpecAt(operator, index);
        const isRemovable =
          spec === null ||
          (signature.rest !== undefined && index >= signature.params.length);
        const isLiteral =
          spec !== null &&
          spec.kind !== "types" &&
          spec.kind !== "sameAs" &&
          spec.kind !== "result" &&
          spec.kind !== "dateLiteral";
        return (
          <Stack
            key={`${path}.${String(index)}`}
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start" }}
          >
            <Box sx={{ flex: 1 }}>
              {isLiteral ? (
                <SpecialArgEditor
                  kind={spec.kind}
                  value={arg}
                  fields={fields}
                  args={args}
                  onChange={(next) => {
                    // 換明細欄時子欄一併清掉(舊的子欄不屬於新的明細)
                    const updated = setArg(value, index, next);
                    onChange(
                      spec.kind === "arrayField" && args.length > 1
                        ? setArg(updated, 1, null)
                        : updated,
                    );
                  }}
                />
              ) : (
                <ExpressionNodeEditor
                  value={arg}
                  onChange={(next) => {
                    onChange(setArg(value, index, next));
                  }}
                  fields={fields}
                  position={{
                    expected: expectedTypesAt(
                      operator,
                      index,
                      args,
                      position.expected,
                      fieldTypeOf,
                    ),
                    usage: position.usage,
                    isRoot: false,
                    allowNull: EQUALITY_OPERATORS.includes(operator),
                    optionTarget: optionTargetAt(
                      operator,
                      index,
                      args,
                      position,
                      fields,
                    ),
                  }}
                  fieldTypeOf={fieldTypeOf}
                  path={childPathOf(path, operator, index)}
                  depth={depth + 1}
                  formKey={formKey}
                  {...(emptyFieldsLabel !== undefined && { emptyFieldsLabel })}
                />
              )}
            </Box>
            {isRemovable && (
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  onChange(removeArg(value, index));
                }}
              >
                {t("removeArg")}
              </Button>
            )}
          </Stack>
        );
      })}
      {signature.rest !== undefined && (
        <Stack direction="row">
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onChange(
                withArgs(value, (items) => [
                  ...items,
                  defaultArgOf(operator, items.length),
                ]),
              );
            }}
          >
            {CONDITION_LIST_OPERATORS.has(operator)
              ? t("addCondition")
              : t("addArg")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
};
