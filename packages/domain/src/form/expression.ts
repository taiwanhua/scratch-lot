/* eslint-disable unicorn/no-this-outside-of-class, import-x/no-named-as-default-member -- json-logic-js 以 `this` 把求值資料傳給自訂運算子,且覆寫 `truthy` / `add_operation` 必須改在預設匯出的那個物件上(具名匯入是唯讀綁定);到期條件:換成可建實例、以參數傳資料的 JSONLogic 引擎 */
import jsonLogic from "json-logic-js";

import { ARRAY_AGGREGATE_OPERATORS, ROW_VAR_PREFIX } from "./array";
import {
  FormDecimal,
  type FormDecimalValue,
  compareChain,
  decimalsOf,
  divide,
  looseEquals,
  strictEquals,
  textOf,
  toDecimal,
  unwrapDecimal,
} from "./decimal";
import { scanExpression } from "./expression-shape";
import {
  type ExpressionValueType,
  type FieldTypeLookup,
  fieldTypeLookupOf,
  inferExpressionType,
  isCalendarUnit,
  isDateAddDirection,
} from "./expression-types";
import { optionLabelOf } from "./semantic";
import {
  MS_PER_UNIT,
  addLocalCalendar,
  compareLocalDay,
  instantDiffMs,
  localDayDiff,
  startOfLocalDayOf,
  toInstant,
  toIso,
} from "./temporal";
import type {
  ArrayColumnDef,
  Expression,
  ExpressionContext,
  FieldDef,
  StoredValues,
} from "./types";

/**
 * 表達式計算器:JSONLogic(`json-logic-js`,MIT)+ 擴充函式
 * `dateDiff` / `dateAdd` / `concat` / `optionLabel` / `now`、日期常數 `date` 與明細列的彙總
 * `sumOf` / `countOf` / `minOf` / `maxOf` / `avgOf`。
 *
 * - `var` 讀**語意值**(`semanticValuesOf`)與 `ctx.*`;列內公式另有 `row.<子欄 key>`(同一列的子欄語意值);
 *   其他路徑在求值前就被形狀檢查擋掉
 * - 算術與比較走 decimal(`decimal.ts`):中間過程不取位,只有 `computeField` 在最後依欄位
 *   `precision` 四捨五入;除以零、空值 → `null`
 * - 求值前一律跑 `scanExpression`:未知運算子 / 深度 / 節點超限 → `ExpressionError`
 * - **日期與日期時間混比**:比較節點兩邊依欄位定義推型別,一邊是日期、另一邊是日期時間時,改成
 *   `compareLocalDay`(兩邊換成 `ctx.timezone` 的當地日期再比日,不看時分秒);兩邊都是日期時間仍比時點
 */

/** 表達式形狀不合法(未知運算子、超限、`var` 路徑不對);屬定義錯誤,檢查器會先擋。 */
export class ExpressionError extends Error {
  override name = "ExpressionError";
}

/** 藏在求值資料裡給 `optionLabel` 用的鍵;`$` 開頭不可能是欄位 key,`var` 讀不到它。 */
const FORM_DATA_KEY = "$form";

interface FormData {
  fields: ReadonlyMap<string, FieldDef>;
  stored: StoredValues;
}

interface EvaluationData {
  [key: string]: unknown;
  ctx: ExpressionContext;
  /** 列內公式:同一列子欄的語意值(`row` 是欄位保留字,不會和欄位撞名) */
  row?: Record<string, unknown>;
  [FORM_DATA_KEY]?: FormData;
}

type Operation = (this: EvaluationData, ...args: unknown[]) => unknown;

/** 比較運算子(混比改寫的對象)。 */
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

/** 參數是字面值、不必往下改寫的運算子。 */
const LITERAL_OPERATORS: ReadonlySet<string> = new Set([
  "var",
  "date",
  ...ARRAY_AGGREGATE_OPERATORS,
]);

/** 改寫後的內部運算子:`{ "$localDayCompare": [運算子, 左, 右] }`;`$` 開頭,形狀檢查不收,使用者寫不出來。 */
const LOCAL_DAY_COMPARE = "$localDayCompare";

/** 當地日比較的結果(-1 / 0 / 1)套回運算子。 */
const LOCAL_DAY_TESTS: Readonly<Record<string, (order: number) => boolean>> = {
  "==": (order) => order === 0,
  "===": (order) => order === 0,
  "!=": (order) => order !== 0,
  "!==": (order) => order !== 0,
  "<": (order) => order < 0,
  ">": (order) => order > 0,
  "<=": (order) => order <= 0,
  ">=": (order) => order >= 0,
};

/** 起 + 方向 + 數量 + 日曆單位;任何一項不合法 → null。數量要是整數(小數位全為 0 的十進位字串也收)。 */
function dateAddOf(
  start: unknown,
  direction: unknown,
  amount: unknown,
  unit: unknown,
  timezone: string,
): string | null {
  const instant = toInstant(start);
  const [count] = decimalsOf([amount]) ?? [];
  if (
    instant === null ||
    count === undefined ||
    !count.isInteger() ||
    !isDateAddDirection(direction) ||
    !isCalendarUnit(unit)
  ) {
    return null;
  }
  const signed = direction === "before" ? -count.toNumber() : count.toNumber();
  try {
    return toIso(addLocalCalendar(instant, signed, unit, timezone));
  } catch {
    // 時區字串不合法
    return null;
  }
}

/**
 * 彙總讀的值:明細欄(語意值是列的陣列)每一列該子欄的數值;明細為 null(隱藏)或不是陣列 → 沒有值;
 * 空值與非數值略過。子欄的值是**取位後**的存值(使用者填的依 `precision` 正規化、列內公式算完即取位)。
 */
function aggregateValuesOf(
  data: EvaluationData,
  arrayKey: unknown,
  columnKey: unknown,
): FormDecimalValue[] {
  const rows = typeof arrayKey === "string" ? data[arrayKey] : null;
  if (!Array.isArray(rows) || typeof columnKey !== "string") {
    return [];
  }
  const values: FormDecimalValue[] = [];
  for (const row of rows) {
    const cell =
      typeof row === "object" && row !== null
        ? (row as Record<string, unknown>)[columnKey]
        : null;
    const decimal = toDecimal(cell);
    if (decimal !== null) {
      values.push(decimal);
    }
  }
  return values;
}

function sumOfDecimals(values: readonly FormDecimalValue[]): FormDecimalValue {
  return values.reduce((sum, item) => sum.plus(item), new FormDecimal(0));
}

/**
 * **全域註冊,只在這裡做一次**:`json-logic-js` 的 `add_operation` / `truthy` 是模組層單例,
 * 本 repo 只有這個檔使用 json-logic-js,所以覆寫對整個 process 生效也不影響別人。
 * 若之後別處也要 JSONLogic 原生語意,就得改用可建實例的引擎(如 json-logic-engine)。
 */
function registerOperations(): void {
  const originalTruthy = jsonLogic.truthy.bind(jsonLogic);
  // decimal 物件的真假值看是不是零(不然 0 會因為是物件而被當成 true)
  jsonLogic.truthy = (value: unknown) =>
    value instanceof FormDecimal ? !value.isZero() : originalTruthy(value);

  const operations: Record<string, Operation> = {
    "+": (...args) =>
      decimalsOf(args)?.reduce(
        (sum, item) => sum.plus(item),
        new FormDecimal(0),
      ) ?? null,
    "*": (...args) =>
      decimalsOf(args)?.reduce(
        (product, item) => product.times(item),
        new FormDecimal(1),
      ) ?? null,
    "-": (...args) => {
      const [first, second] = decimalsOf(args) ?? [];
      if (!first) {
        return null;
      }
      return second ? first.minus(second) : first.negated();
    },
    "/": (...args) => divide(args, "div"),
    "%": (...args) => divide(args, "mod"),
    min: (...args) => {
      const decimals = decimalsOf(args);
      return decimals && decimals.length > 0
        ? FormDecimal.min(...decimals)
        : null;
    },
    max: (...args) => {
      const decimals = decimalsOf(args);
      return decimals && decimals.length > 0
        ? FormDecimal.max(...decimals)
        : null;
    },
    "<": (...args) => compareChain(args, (order) => order < 0),
    ">": (...args) => compareChain(args, (order) => order > 0),
    "<=": (...args) => compareChain(args, (order) => order <= 0),
    ">=": (...args) => compareChain(args, (order) => order >= 0),
    "==": (left, right) => looseEquals(left, right),
    "!=": (left, right) => !looseEquals(left, right),
    "===": (left, right) => strictEquals(left, right),
    "!==": (left, right) => !strictEquals(left, right),
    concat: (...args) => args.map((arg) => textOf(arg)).join(""),
    /**
     * `{ "dateAdd": [起, "before" | "after", 數量, "days" | "weeks" | "months" | "years"] }`:在 `ctx.timezone`
     * 加減日曆單位(月 / 年溢出取該月最後一天);日期起(當地 00:00)加完仍是當地 00:00、日期時間起回時點。
     */
    dateAdd(start, direction, amount, unit) {
      return dateAddOf(start, direction, amount, unit, this.ctx.timezone);
    },
    /** 日期常數 `{ "date": ISO }` = 那一刻所在當地日(`ctx.timezone`)00:00 的 ISO。 */
    date(value) {
      const instant = toInstant(value);
      if (instant === null) {
        return null;
      }
      try {
        return toIso(startOfLocalDayOf(instant, this.ctx.timezone));
      } catch {
        return null;
      }
    },
    /** `{ "now": [] }` = `ctx.now`(歷史檢視時是那次修訂的時間,不是讀者的現在)。 */
    now() {
      return this.ctx.now;
    },
    /**
     * `{ "dateDiff": [起, 迄, 單位] }` = 迄 − 起:
     * - `days`(預設,缺參數也是):兩邊換成 `ctx.timezone` 的當地日期後的**日曆日**差
     * - `hours` / `minutes`:時點差(可有小數;`date` 本來就是當地 00:00 的時點)
     *
     * 任一無效、單位不認得 → null。
     */
    dateDiff(start, end, unit = "days") {
      if (unit === "days") {
        const days = localDayDiff(start, end, this.ctx.timezone);
        return days === null ? null : new FormDecimal(days);
      }
      if (unit !== "hours" && unit !== "minutes") {
        return null;
      }
      const diff = instantDiffMs(start, end);
      return diff === null
        ? null
        : new FormDecimal(diff).dividedBy(MS_PER_UNIT[unit]);
    },
    /**
     * 彙總:略過空值;全空或明細為 null 時 `sumOf` 為 0、`minOf` / `maxOf` / `avgOf` 為 null;
     * `avgOf` 的分母 = 有值的筆數;`countOf` = 列數(明細為 null 為 0,空白列也算一列)。
     */
    sumOf(arrayKey, columnKey) {
      return sumOfDecimals(aggregateValuesOf(this, arrayKey, columnKey));
    },
    minOf(arrayKey, columnKey) {
      const values = aggregateValuesOf(this, arrayKey, columnKey);
      return values.length > 0 ? FormDecimal.min(...values) : null;
    },
    maxOf(arrayKey, columnKey) {
      const values = aggregateValuesOf(this, arrayKey, columnKey);
      return values.length > 0 ? FormDecimal.max(...values) : null;
    },
    avgOf(arrayKey, columnKey) {
      const values = aggregateValuesOf(this, arrayKey, columnKey);
      return values.length > 0
        ? sumOfDecimals(values).dividedBy(values.length)
        : null;
    },
    countOf(arrayKey) {
      const rows = typeof arrayKey === "string" ? this[arrayKey] : null;
      return new FormDecimal(Array.isArray(rows) ? rows.length : 0);
    },
    /** `{ "optionLabel": "leave_type" }` = 該欄的顯示名(存的 label 或靜態選項定義的 label)。 */
    optionLabel(fieldKey) {
      const form = this[FORM_DATA_KEY];
      const field =
        typeof fieldKey === "string" ? form?.fields.get(fieldKey) : undefined;
      if (!form || !field) {
        return null;
      }
      return optionLabelOf(field, form.stored[field.key]);
    },
  };
  /** 日期 vs 日期時間:換成當地日再比;任一邊不是時點 → 照原運算子比(空值判斷等)。 */
  operations[LOCAL_DAY_COMPARE] = function localDayCompare(
    operator,
    left,
    right,
  ) {
    const test = LOCAL_DAY_TESTS[String(operator)];
    const order = compareLocalDay(left, right, this.ctx.timezone);
    if (test === undefined || order === null) {
      return operations[String(operator)]?.call(this, left, right) ?? false;
    }
    return test(order);
  };
  for (const [name, operation] of Object.entries(operations)) {
    jsonLogic.add_operation(name, operation);
  }
}

registerOperations();

export interface EvaluationInput {
  /** 語意值(`semanticValuesOf` 的結果;計算欄位算完的值也放這裡)。 */
  values: Record<string, unknown>;
  ctx: ExpressionContext;
  /** 給 `optionLabel` 用:欄位定義與**存的值**;不給時 `optionLabel` 一律回 null。 */
  fields?: readonly FieldDef[];
  stored?: StoredValues;
  /** 列內公式:同一列子欄的語意值(`{ "var": "row.qty" }` 讀它) */
  row?: Record<string, unknown>;
  /** 列內公式:這個明細欄的子欄定義(推 `row.*` 的型別,日期混比用) */
  rowColumns?: readonly ArrayColumnDef[];
}

/** 形狀不合法就丟 `ExpressionError`(白名單、深度、節點、`var` 路徑)。 */
export function assertExpression(expr: Expression): void {
  const [issue] = scanExpression(expr).issues;
  if (issue) {
    throw new ExpressionError(
      `${issue.problem} at ${issue.path === "" ? "(root)" : issue.path}: ${issue.detail}`,
    );
  }
}

const isOperationNode = (
  expr: Expression,
): expr is Record<string, Expression> =>
  typeof expr === "object" && expr !== null && !Array.isArray(expr);

const isMixedTemporal = (
  left: ExpressionValueType | null,
  right: ExpressionValueType | null,
): boolean =>
  (left === "date" && right === "datetime") ||
  (left === "datetime" && right === "date");

/**
 * 把「一邊日期、一邊日期時間」的比較節點改寫成 `$localDayCompare`(日期與日期時間混比
 * 換成租戶時區的日再比)。型別照 `inferExpressionType`(欄位定義 + 日期常數 `date` + `now`)推;推不出來不改。
 */
function withLocalDayComparisons(
  expr: Expression,
  typeOf: FieldTypeLookup,
): Expression {
  let rewritten: Expression = expr;
  if (Array.isArray(expr)) {
    rewritten = expr.map((item) => withLocalDayComparisons(item, typeOf));
  } else if (isOperationNode(expr)) {
    rewritten = rewriteOperation(expr, typeOf);
  }
  return rewritten;
}

/** 運算節點:參數遞迴改寫;比較節點兩邊混比 → `$localDayCompare`。 */
function rewriteOperation(
  expr: Record<string, Expression>,
  typeOf: FieldTypeLookup,
): Record<string, Expression> {
  const [operator] = Object.keys(expr);
  if (operator === undefined || LITERAL_OPERATORS.has(operator)) {
    return expr;
  }
  const raw = expr[operator] ?? null;
  const args = (Array.isArray(raw) ? raw : [raw]).map((item) =>
    withLocalDayComparisons(item, typeOf),
  );
  const [left = null, right = null] = args;
  if (
    COMPARISON_OPERATORS.has(operator) &&
    args.length === 2 &&
    isMixedTemporal(
      inferExpressionType(left, typeOf),
      inferExpressionType(right, typeOf),
    )
  ) {
    return { [LOCAL_DAY_COMPARE]: [operator, left, right] };
  }
  return { [operator]: Array.isArray(raw) ? args : left };
}

/** 表單層的型別查詢再加上 `row.<子欄 key>`(列內公式)。 */
export function rowAwareTypeLookup(
  base: FieldTypeLookup,
  columns: readonly ArrayColumnDef[] | undefined,
): FieldTypeLookup {
  if (columns === undefined || columns.length === 0) {
    return base;
  }
  const rowTypes = fieldTypeLookupOf(columns);
  return (key) =>
    key.startsWith(ROW_VAR_PREFIX)
      ? rowTypes(key.slice(ROW_VAR_PREFIX.length))
      : base(key);
}

/** 內部用:回傳可能含 decimal 物件的原始結果(`computeField` 要在最後取位)。 */
export function evaluateRaw(expr: Expression, input: EvaluationInput): unknown {
  assertExpression(expr);
  const rewritten = withLocalDayComparisons(
    expr,
    rowAwareTypeLookup(fieldTypeLookupOf(input.fields ?? []), input.rowColumns),
  );
  // `ctx` / `row` 放最後:語意值裡就算混進同名鍵也蓋不掉上下文(兩者都是欄位保留字)
  const data: EvaluationData = { ...input.values, ctx: input.ctx };
  if (input.row !== undefined) {
    data.row = input.row;
  }
  if (input.fields) {
    data[FORM_DATA_KEY] = {
      fields: new Map(input.fields.map((field) => [field.key, field])),
      stored: input.stored ?? {},
    };
  }
  return jsonLogic.apply(rewritten as jsonLogic.RulesLogic, data) as unknown;
}

/** 求值;數值結果回不取位的十進位字串。 */
export function evaluateExpression(
  expr: Expression,
  input: EvaluationInput,
): unknown {
  return unwrapDecimal(evaluateRaw(expr, input));
}

/** 條件表達式(`visibleWhen` / `readonlyWhen` / `rules.custom`)的真假值;JSONLogic 的 truthy 規則。 */
export function evaluateCondition(
  expr: Expression,
  input: EvaluationInput,
): boolean {
  return jsonLogic.truthy(evaluateRaw(expr, input));
}
