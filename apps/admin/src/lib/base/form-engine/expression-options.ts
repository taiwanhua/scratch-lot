import {
  CONTEXT_VAR_PATHS,
  CONTEXT_VAR_TYPES,
  type ExpectedTypes,
  type Expression,
  type ExpressionValueType,
  FIELD_EXPRESSION_TYPES,
  type FieldDef,
  fieldProtections,
  isArrayAggregateOperator,
  isOperatorAccepted,
  isOptionExpected,
  isProtected,
  isSameOptionSource,
  isTypeAccepted,
  paramSpecAt,
} from "@repo/domain/form";

import {
  CONSTANT_KINDS,
  type ConstantKind,
  type ExpressionNodeKind,
  PICKER_OPERATORS,
  type PickerOperator,
  operationNode,
  operatorOf,
  varPathOf,
} from "./expression-tree";

/**
 * 表達式選擇器的**型別導向過濾**(Spec 6a §5「表達式選擇器:型別導向(表 B)」):每個位置帶「期望型別」,
 * 只列型別對得上的欄位 / 系統值 / 常數 / 運算。型別表的正本在 `@repo/domain/form` 的 `expression-types.ts`
 * (檢查器與這裡共用同一張)。
 *
 * - 公式(計算欄位、預設值):根要回**欄位的型別**;系統值只列現在時間(日期 / 日期時間位置)、
 *   填寫者 / 填寫者的組織(文字位置)
 * - 條件(顯示條件、鎖定條件、自訂驗證、流程跳過條件):根要回**是 / 否**;常數不能單獨當根、
 *   系統值單獨當根也不行;四個系統值在型別對得上的裡層位置都可用
 * - 選項欄公式:根(與 `if` 的然後 / 否則)要回「選項」—— 只列 `if`、同選項來源的欄位、從目標欄位選項挑的常數
 * - 有**目標選項欄**的位置(選項欄公式、和選項欄比較 / `in` 的另一邊):文字 / 清單常數改成從它的選項挑
 */
export type PickerUsage = "formula" | "condition";

export type ContextPath = (typeof CONTEXT_VAR_PATHS)[number];

export interface PickerPosition {
  expected: ExpectedTypes;
  usage: PickerUsage;
  isRoot: boolean;
  /** 比較(等於 / 不等於)的參數:沒選 = 空值(`== null` 判空),空位顯示這個提示 */
  allowNull: boolean;
  /** 目標選項欄:常數從它的選項挑;選項位置的欄位只列同選項來源的 */
  optionTarget: FieldDef | null;
}

export interface PositionOptions {
  kinds: ExpressionNodeKind[];
  fields: FieldDef[];
  contexts: ContextPath[];
  constants: ConstantKind[];
  operators: PickerOperator[];
}

/** 公式能用的系統值(Spec 表 B「系統值可選」:時區只在條件裡用)。 */
const FORMULA_CONTEXTS = new Set<ContextPath>([
  "ctx.now",
  "ctx.user.id",
  "ctx.user.orgId",
]);

const CONSTANT_TYPES: Readonly<Record<ConstantKind, ExpressionValueType>> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
  list: "list",
  option: "option",
  optionList: "optionList",
};

/** 有目標選項欄時,文字 / 清單常數由選項常數取代;沒有時不列選項常數。 */
const OPTION_REPLACED: ReadonlySet<ConstantKind> = new Set(["text", "list"]);
const OPTION_KINDS: ReadonlySet<ConstantKind> = new Set([
  "option",
  "optionList",
]);

/** 比較運算子:參數可以是空值常數。 */
export const EQUALITY_OPERATORS: readonly string[] = ["==", "!=", "===", "!=="];

export const fieldExpressionType = (
  field: FieldDef,
): ExpressionValueType | null => FIELD_EXPRESSION_TYPES[field.type];

export const positionOptionsOf = (
  position: PickerPosition,
  fields: readonly FieldDef[],
): PositionOptions => {
  const { expected, usage, isRoot, optionTarget } = position;
  const isConditionRoot = isRoot && usage === "condition";
  const isOptionPosition = isOptionExpected(expected);
  const matchingFields = fields.filter((field) => {
    const type = fieldExpressionType(field);
    return (
      type !== null &&
      isTypeAccepted(type, expected) &&
      (!isOptionPosition ||
        (optionTarget !== null && isSameOptionSource(field, optionTarget)))
    );
  });
  const contexts = isConditionRoot
    ? []
    : CONTEXT_VAR_PATHS.filter(
        (path) =>
          (usage === "condition" || FORMULA_CONTEXTS.has(path)) &&
          isTypeAccepted(CONTEXT_VAR_TYPES[path], expected),
      );
  const constants = isConditionRoot
    ? []
    : CONSTANT_KINDS.filter(
        (kind) =>
          isTypeAccepted(CONSTANT_TYPES[kind], expected) &&
          (optionTarget === null
            ? !OPTION_KINDS.has(kind)
            : !OPTION_REPLACED.has(kind)),
      );
  // 彙總只在定義裡有明細欄時才列(沒有明細可彙總)
  const hasArray = fields.some((field) => field.type === "array");
  const operators = PICKER_OPERATORS.filter(
    (operator) =>
      isOperatorAccepted(operator, expected) &&
      (hasArray || !isArrayAggregateOperator(operator)),
  );
  const kinds: ExpressionNodeKind[] = [];
  if (matchingFields.length > 0) {
    kinds.push("field");
  }
  if (contexts.length > 0) {
    kinds.push("context");
  }
  if (constants.length > 0) {
    kinds.push("constant");
  }
  if (operators.length > 0) {
    kinds.push("operation");
  }
  return {
    kinds,
    fields: matchingFields,
    contexts,
    constants,
    operators,
  };
};

/** 「設定」時的起點:第一個型別對得上的偏好運算(數字 → 乘、文字 → 串接、是 / 否 → 等於,其餘 → 如果)。 */
const INITIAL_PREFERENCE: readonly PickerOperator[] = [
  "*",
  "concat",
  "==",
  "if",
];

export const initialExpressionOf = (expected: ExpectedTypes): Expression =>
  operationNode(
    INITIAL_PREFERENCE.find((operator) =>
      isOperatorAccepted(operator, expected),
    ) ?? "if",
  );

/**
 * 條件可引用的欄位:**不含受保護欄位**(含因引用受保護欄位而受保護的計算欄位;v1 禁止條件引用它們)、
 * 上傳欄不能進表達式;`includeSelf` 決定列不列自己(顯示條件不可引用自己)。
 */
export const conditionFieldsOf = (
  fields: readonly FieldDef[],
  selfKey: string | null,
  includeSelf: boolean,
): FieldDef[] => {
  const protections = fieldProtections(fields);
  return fields.filter(
    (field) =>
      (includeSelf || field.key !== selfKey) &&
      !isProtected(protections.get(field.key)),
  );
};

const OPTION_FIELD_TYPES: ReadonlySet<string> = new Set([
  "select",
  "multiSelect",
]);

/** 參數是不是「引用某個選項欄」的欄位節點;是就回那個欄位。 */
const optionFieldOf = (
  expr: Expression | undefined,
  fields: readonly FieldDef[],
): FieldDef | null => {
  if (expr === undefined || operatorOf(expr) !== "var") {
    return null;
  }
  const field = fields.find((candidate) => candidate.key === varPathOf(expr));
  return field !== undefined && OPTION_FIELD_TYPES.has(field.type)
    ? field
    : null;
};

/** 兩兩比較、`in`:另一邊是選項欄時,這一邊的常數從它的選項挑。 */
const PAIRED_OPERATORS: ReadonlySet<string> = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "in",
]);

/**
 * 運算節點第 `index` 個參數的目標選項欄:
 * - 「然後 / 否則」(`result`,或與它同型的 `sameAs`)在選項位置 → 沿用這個節點的目標
 * - 等於 / 不等於 / `in`:另一邊引用選項欄 → 那個欄位(`leave == 病假`、`病假 in 標籤`)
 */
export const optionTargetAt = (
  operator: PickerOperator,
  index: number,
  args: readonly Expression[],
  position: PickerPosition,
  fields: readonly FieldDef[],
): FieldDef | null => {
  const spec = paramSpecAt(operator, index);
  const followsResult =
    spec?.kind === "result" ||
    (spec?.kind === "sameAs" &&
      paramSpecAt(operator, spec.index)?.kind === "result");
  if (followsResult && isOptionExpected(position.expected)) {
    return position.optionTarget;
  }
  if (PAIRED_OPERATORS.has(operator) && index < 2) {
    return optionFieldOf(args[1 - index], fields);
  }
  return null;
};
