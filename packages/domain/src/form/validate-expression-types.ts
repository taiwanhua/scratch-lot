import { arrayColumnsOf } from "./array";
import { rowAwareTypeLookup } from "./expression";
import { scanExpression } from "./expression-shape";
import {
  type ExpectedTypes,
  type ExpressionValueType,
  FIELD_EXPRESSION_TYPES,
  type FieldTypeLookup,
  type LiteralParamKind,
  OPERATOR_SIGNATURES,
  type OperatorSignature,
  constantTypeOf,
  expectedTypesAt,
  fieldTypeLookupOf,
  inferExpressionType,
  isCalendarUnit,
  isDateAddDirection,
  isDateDiffUnit,
  isOptionConstantOf,
  isOptionExpected,
  isSameOptionSource,
  isTypeAccepted,
  paramSpecAt,
} from "./expression-types";
import type {
  DefinitionIssueLocation,
  ExpressionSlot,
  IssueCollector,
} from "./issues";
import type { Expression, FieldDef } from "./types";
import { expressionsOf } from "./validate-expressions";

/**
 * 檢查器的**型別**段(與設計器的選擇器同一張表
 * `expression-types.ts`,設計器過濾後兩邊不會打架):
 *
 * - 根節點:計算欄位公式 / 預設值公式 = 欄位型別;顯示條件 / 鎖定條件 / 自訂驗證 = 是 / 否
 * - 每個運算子的每個參數位置型別相符(`sameAs` / `if` 的然後 / 否則同型別照表推)
 * - `dateDiff` 的單位只能是 `days` / `hours` / `minutes`(不給 = `days`)
 * - `dateAdd` 的方向只能是 `before` / `after`、單位只能是 `days` / `weeks` / `months` / `years`
 * - `optionLabel` 只能指選項欄(單選 / 多選)或引用欄
 * - 選項欄公式(根型別 `option` / `optionList`):根與 `if` 的然後 / 否則只收 `if`、**同選項來源**的欄位、
 *   選項常數;靜態選項的常數要在選項清單內(`EXPR_OPTION_UNKNOWN`),類別 / lookup 只驗是字串
 *
 * 推不出型別的節點(`null` 常數、未知欄位、上傳欄以外的空值)不報;形狀有問題的表達式由形狀段報,
 * 這裡整個跳過(避免同一個錯誤報兩次)。日期與日期時間互通(`isTypeAccepted`,比較時計算器換成當地日)。
 */

const TYPE_LABELS: Readonly<Record<ExpressionValueType, string>> = {
  text: "文字",
  number: "數字",
  boolean: "是 / 否",
  date: "日期",
  datetime: "日期時間",
  list: "清單",
  option: "選項",
  optionList: "選項(多個)",
};

const SLOT_LABELS: Readonly<Record<ExpressionSlot, string>> = {
  "valueSource.expr": "公式",
  "default.expr": "預設值公式",
  visibleWhen: "顯示條件",
  readonlyWhen: "鎖定條件",
  "rules.custom": "自訂驗證",
};

const OPTION_LABEL_TYPES = new Set(["select", "multiSelect", "reference"]);

interface TypeCheckContext {
  /** 表達式所在的欄位(列內公式 = 那個子欄,當 FieldDef 用;訊息的標題取它) */
  field: FieldDef;
  /** 列內公式:所在的明細欄 key(定位 = 明細欄 + 子欄) */
  arrayKey?: string;
  /** 選項位置的目標欄位(選項欄公式 = 欄位自己);只在期望型別是 `option` / `optionList` 時有意義 */
  optionTarget: FieldDef;
  slot: ExpressionSlot;
  typeOf: FieldTypeLookup;
  fieldsByKey: ReadonlyMap<string, FieldDef>;
  collector: IssueCollector;
}

const isOperationNode = (
  expr: Expression,
): expr is Record<string, Expression> =>
  typeof expr === "object" && expr !== null && !Array.isArray(expr);

const joinPath = (base: string, segment: string | number): string =>
  base === "" ? String(segment) : `${base}.${String(segment)}`;

function describe(expected: ExpectedTypes): string {
  return expected === null
    ? "任何型別"
    : expected.map((type) => TYPE_LABELS[type]).join(" / ");
}

/** 公式類槽的根要的型別(欄位型別);上傳欄不進表達式 → 不檢查(回 undefined)。 */
function rootExpectedOf(
  field: FieldDef,
  slot: ExpressionSlot,
): ExpectedTypes | undefined {
  if (slot === "valueSource.expr" || slot === "default.expr") {
    const type = FIELD_EXPRESSION_TYPES[field.type] as
      ExpressionValueType | null | undefined;
    return type ? [type] : undefined;
  }
  return ["boolean"];
}

export function validateExpressionTypes(
  fields: readonly FieldDef[],
  collector: IssueCollector,
): void {
  const typeOf = fieldTypeLookupOf(fields);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  for (const field of fields) {
    for (const { slot, expr } of expressionsOf(field)) {
      const expected = rootExpectedOf(field, slot);
      if (expected === undefined || scanExpression(expr).issues.length > 0) {
        continue;
      }
      checkNode(
        { field, optionTarget: field, slot, typeOf, fieldsByKey, collector },
        expr,
        expected,
        "",
      );
    }
    checkColumnExpressions(field, typeOf, fieldsByKey, collector);
  }
}

/** 列內公式:根 = 子欄型別;`row.<子欄 key>` 的型別照同一個明細的子欄。 */
function checkColumnExpressions(
  field: FieldDef,
  typeOf: FieldTypeLookup,
  fieldsByKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  const columns = arrayColumnsOf(field);
  const columnTypeOf = rowAwareTypeLookup(typeOf, columns);
  for (const column of columns) {
    const source = column.valueSource as { kind?: unknown; expr?: unknown };
    if (source.kind !== "computed" || source.expr === undefined) {
      continue;
    }
    const expr = source.expr as Expression;
    const expected = rootExpectedOf(column, "valueSource.expr");
    if (expected === undefined || scanExpression(expr).issues.length > 0) {
      continue;
    }
    checkNode(
      {
        field: column,
        arrayKey: field.key,
        optionTarget: column,
        slot: "valueSource.expr",
        typeOf: columnTypeOf,
        fieldsByKey,
        collector,
      },
      expr,
      expected,
      "",
    );
  }
}

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
]);

/**
 * 比較兩邊都沒選(`{ "==": [null, null] }`):選擇器新建條件的預設,忘了填會讓「或」恆真 / 「且」恆假,
 * 當錯誤擋發布(存草稿照收)。一邊有東西的 `x == null` 是合法的判空。
 */
function isEmptyComparison(operator: string, raw: Expression): boolean {
  if (!COMPARISON_OPERATORS.has(operator)) {
    return false;
  }
  const args: Expression[] = Array.isArray(raw) ? raw : [raw];
  return args.length > 0 && args.every((arg) => arg === null);
}

/** 錯誤定位:表單層 = 欄位;列內公式 = 明細欄 + 子欄。 */
function locationOf(
  context: TypeCheckContext,
  path: string,
): DefinitionIssueLocation {
  return context.arrayKey === undefined
    ? { fieldKey: context.field.key, exprSlot: context.slot, exprPath: path }
    : {
        fieldKey: context.arrayKey,
        columnKey: context.field.key,
        exprSlot: context.slot,
        exprPath: path,
      };
}

function mismatch(
  context: TypeCheckContext,
  path: string,
  expected: ExpectedTypes,
  actual: string,
): void {
  const { field, slot } = context;
  context.collector.error(
    "EXPR_TYPE_MISMATCH",
    `「${field.label}」的${SLOT_LABELS[slot]}在這個位置需要${describe(expected)},拿到的是${actual}`,
    locationOf(context, path),
  );
}

function checkNode(
  context: TypeCheckContext,
  expr: Expression,
  expected: ExpectedTypes,
  path: string,
): void {
  if (!isOperationNode(expr)) {
    if (isOptionExpected(expected)) {
      checkOptionConstant(context, expr, expected, path);
      return;
    }
    const type = constantTypeOf(expr);
    if (type !== null && !isTypeAccepted(type, expected)) {
      mismatch(context, path, expected, TYPE_LABELS[type]);
    }
    return;
  }
  const [operator] = Object.keys(expr);
  if (operator === undefined) {
    return;
  }
  const operatorPath = joinPath(path, operator);
  if (operator === "var") {
    checkVar(context, expr, expected, operatorPath);
    return;
  }
  const signature = (
    OPERATOR_SIGNATURES as Readonly<Partial<Record<string, OperatorSignature>>>
  )[operator];
  if (signature === undefined) {
    return;
  }
  if (isEmptyComparison(operator, expr[operator] ?? null)) {
    context.collector.error(
      "EXPR_COMPARISON_EMPTY",
      `「${context.field.label}」的${SLOT_LABELS[context.slot]}有一個比較兩邊都還沒選`,
      locationOf(context, operatorPath),
    );
    return;
  }
  const returns =
    signature.returns === "first"
      ? (inferExpressionType(expr, context.typeOf) ?? "datetime")
      : signature.returns;
  if (returns !== "then" && !isTypeAccepted(returns, expected)) {
    mismatch(context, operatorPath, expected, TYPE_LABELS[returns]);
    return;
  }
  checkArguments(
    context,
    operator as keyof typeof OPERATOR_SIGNATURES,
    expr[operator] ?? null,
    expected,
    operatorPath,
  );
}

/** 字面值參數(單位、方向)的錯誤:代碼 + 說明。 */
const LITERAL_RULES: Readonly<
  Partial<
    Record<
      LiteralParamKind,
      {
        isValid: (value: unknown) => boolean;
        code: "EXPR_DATE_DIFF_UNIT" | "EXPR_DATE_ADD_ARG";
        detail: string;
      }
    >
  >
> = {
  dateUnit: {
    isValid: isDateDiffUnit,
    code: "EXPR_DATE_DIFF_UNIT",
    detail: "日期差的單位只能是天 / 小時 / 分鐘",
  },
  dateDirection: {
    isValid: isDateAddDirection,
    code: "EXPR_DATE_ADD_ARG",
    detail: "日期加減的方向只能是之前 / 之後",
  },
  calendarUnit: {
    isValid: isCalendarUnit,
    code: "EXPR_DATE_ADD_ARG",
    detail: "日期加減的單位只能是天 / 週 / 月 / 年",
  },
};

const VALUE_PARAM_KINDS: ReadonlySet<string> = new Set([
  "types",
  "sameAs",
  "result",
]);

const isLiteralKind = (kind: string): kind is LiteralParamKind =>
  !VALUE_PARAM_KINDS.has(kind);

/** 字面值參數:`optionLabel` 的欄位、單位 / 方向;日期常數的 ISO 由形狀段驗。 */
function checkLiteralArgument(
  context: TypeCheckContext,
  kind: LiteralParamKind,
  argument: Expression,
  path: string,
): void {
  if (kind === "optionField") {
    checkOptionField(context, argument, path);
    return;
  }
  const rule = LITERAL_RULES[kind];
  if (rule === undefined || rule.isValid(argument)) {
    return;
  }
  context.collector.error(
    rule.code,
    `「${context.field.label}」的${SLOT_LABELS[context.slot]}:${rule.detail}`,
    locationOf(context, path),
  );
}

/** 運算節點的每個參數,依它的位置要的型別往下檢查。 */
function checkArguments(
  context: TypeCheckContext,
  knownOperator: keyof typeof OPERATOR_SIGNATURES,
  raw: Expression,
  expected: ExpectedTypes,
  operatorPath: string,
): void {
  const isArgumentList = Array.isArray(raw);
  const args: Expression[] = isArgumentList ? raw : [raw];
  for (const [index, argument] of args.entries()) {
    const argumentPath = isArgumentList
      ? joinPath(operatorPath, index)
      : operatorPath;
    const spec = paramSpecAt(knownOperator, index);
    if (spec === null) {
      continue;
    }
    if (isLiteralKind(spec.kind)) {
      checkLiteralArgument(context, spec.kind, argument, argumentPath);
    } else {
      checkNode(
        context,
        argument,
        expectedTypesAt(knownOperator, index, args, expected, context.typeOf),
        argumentPath,
      );
    }
  }
}

function checkVar(
  context: TypeCheckContext,
  expr: Record<string, Expression>,
  expected: ExpectedTypes,
  path: string,
): void {
  const type = inferExpressionType(expr, context.typeOf);
  if (type !== null) {
    if (!isTypeAccepted(type, expected)) {
      mismatch(context, path, expected, TYPE_LABELS[type]);
      return;
    }
    const referenced = context.fieldsByKey.get(varTargetOf(expr));
    if (
      isOptionExpected(expected) &&
      referenced !== undefined &&
      !isSameOptionSource(referenced, context.optionTarget)
    ) {
      mismatch(
        context,
        path,
        expected,
        `選項來源不同的欄位「${referenced.label}」`,
      );
    }
    return;
  }
  // 推不出型別:只有「引用了上傳欄」要報(上傳欄不可進表達式);不存在的欄位由引用檢查報
  const argument = expr.var;
  const target = Array.isArray(argument) ? argument[0] : argument;
  const referenced =
    typeof target === "string" ? context.fieldsByKey.get(target) : undefined;
  if (referenced?.type === "upload") {
    mismatch(context, path, expected, "上傳欄位(不可放進表達式)");
  }
}

function varTargetOf(expr: Record<string, Expression>): string {
  const argument = expr.var;
  const target = Array.isArray(argument) ? argument[0] : argument;
  return typeof target === "string" ? target : "";
}

/**
 * 選項位置的常數:單選 = 字串、多選 = 字串陣列;靜態選項要在目標欄位的清單內(類別 / lookup 只驗字串)。
 * `null`(沒選)不報。
 */
function checkOptionConstant(
  context: TypeCheckContext,
  expr: Expression,
  expected: ExpectedTypes,
  path: string,
): void {
  if (expr === null) {
    return;
  }
  const isList = expected?.includes("optionList") === true;
  const items: readonly Expression[] = Array.isArray(expr) ? expr : [expr];
  if (Array.isArray(expr) !== isList) {
    const type = constantTypeOf(expr);
    mismatch(
      context,
      path,
      expected,
      type === null ? "空值" : TYPE_LABELS[type],
    );
    return;
  }
  const nonText = items.find((item) => typeof item !== "string");
  if (nonText !== undefined) {
    const type = constantTypeOf(nonText);
    mismatch(
      context,
      path,
      expected,
      type === null ? "空值" : TYPE_LABELS[type],
    );
    return;
  }
  const unknown = items.filter(
    (item) => !isOptionConstantOf(context.optionTarget, item),
  );
  if (unknown.length > 0) {
    context.collector.error(
      "EXPR_OPTION_UNKNOWN",
      `「${context.field.label}」的${SLOT_LABELS[context.slot]}:${unknown.map((item) => JSON.stringify(item)).join("、")} 不是「${context.optionTarget.label}」的選項`,
      locationOf(context, path),
    );
  }
}

function checkOptionField(
  context: TypeCheckContext,
  argument: Expression,
  path: string,
): void {
  const target = Array.isArray(argument) ? argument[0] : argument;
  const referenced =
    typeof target === "string" ? context.fieldsByKey.get(target) : undefined;
  if (referenced && !OPTION_LABEL_TYPES.has(referenced.type)) {
    context.collector.error(
      "EXPR_TYPE_MISMATCH",
      `「${context.field.label}」的${SLOT_LABELS[context.slot]}:取選項名稱只能指單選 / 多選 / 引用欄位`,
      locationOf(context, path),
    );
  }
}
