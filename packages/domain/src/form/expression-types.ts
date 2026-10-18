import type { CONTEXT_VAR_PATHS, ExpressionOperator } from "./expression-shape";
import {
  LOCAL_CALENDAR_UNITS,
  type LocalCalendarUnit,
  isDateTimeString,
} from "./temporal";
import type { Expression, FieldDef, FieldType } from "./types";

/**
 * 表達式的**型別表**:運算子的參數 / 回傳型別、
 * 欄位與系統值(`ctx.*`)在表達式裡的型別。純資料 + 純函式,設計器的選擇器(每個位置只列型別對得上的
 * 欄位 / 常數 / 系統值 / 運算)與檢查器共用這一張,兩邊不會各說各話。
 */

/**
 * 表達式裡的值型別(語意值,不是存值;`list` = 常數清單):
 * - `option` / `optionList`:單選 / 多選欄的值(`value` 字串 / `value[]`)。它們能放進文字 / 清單的位置
 *   (`leave_type == "sick"`、`in`),但**反過來不行**:選項欄公式的根(與 `if` 的然後 / 否則)要回 `option` /
 *   `optionList`,只收 `if`、同選項來源的欄位、從目標欄位選項挑的常數。
 */
export const EXPRESSION_VALUE_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "list",
  "option",
  "optionList",
] as const;

export type ExpressionValueType = (typeof EXPRESSION_VALUE_TYPES)[number];

/** 某個位置可以放的型別;`null` = 不限(例:「有值」的參數)。 */
export type ExpectedTypes = readonly ExpressionValueType[] | null;

/**
 * 欄位型別 → 表達式型別(`var` 讀到的語意值):
 * 單選 = value 字串、多選 = `value[]`、引用 = 來源 id(文字)。**上傳欄不可進表達式**(null)。
 */
export const FIELD_EXPRESSION_TYPES: Readonly<
  Record<FieldType, ExpressionValueType | null>
> = {
  text: "text",
  multiline: "text",
  number: "number",
  date: "date",
  datetime: "datetime",
  select: "option",
  multiSelect: "optionList",
  boolean: "boolean",
  upload: null,
  reference: "text",
  // 明細欄不能整個進表達式:表單層用彙總運算子讀它的子欄(`sumOf` / `countOf`…)
  array: null,
};

/** 系統值(畫面上的「系統值」= `ctx.*`)的型別:現在時間 = 日期時間、所屬組織(全部)= 清單,其餘是文字。 */
export const CONTEXT_VAR_TYPES: Readonly<
  Record<(typeof CONTEXT_VAR_PATHS)[number], ExpressionValueType>
> = {
  "ctx.now": "datetime",
  "ctx.timezone": "text",
  "ctx.user.id": "text",
  "ctx.user.orgId": "text",
  "ctx.user.orgIds": "list",
  "ctx.tenant.id": "text",
};

/** `dateDiff` 的第三參數(單位);缺參數 = `days`。 */
export const DATE_DIFF_UNITS = ["days", "hours", "minutes"] as const;

export type DateDiffUnit = (typeof DATE_DIFF_UNITS)[number];

export const DEFAULT_DATE_DIFF_UNIT: DateDiffUnit = "days";

/** 設計器單位下拉開放的單位(計算器三種都算:日曆日 / 精確小時 / 精確分鐘)。 */
export const PICKABLE_DATE_DIFF_UNITS: readonly DateDiffUnit[] =
  DATE_DIFF_UNITS;

/** 是不是 `dateDiff` 認得的單位字串。 */
export function isDateDiffUnit(value: unknown): value is DateDiffUnit {
  return (
    typeof value === "string" &&
    (DATE_DIFF_UNITS as readonly string[]).includes(value)
  );
}

/** `dateAdd` 的方向:往前(之前)/ 往後(之後)。 */
export const DATE_ADD_DIRECTIONS = ["before", "after"] as const;

export type DateAddDirection = (typeof DATE_ADD_DIRECTIONS)[number];

/** 是不是 `dateAdd` 認得的方向字串。 */
export function isDateAddDirection(value: unknown): value is DateAddDirection {
  return (
    typeof value === "string" &&
    (DATE_ADD_DIRECTIONS as readonly string[]).includes(value)
  );
}

/** 是不是 `dateAdd` 認得的日曆單位(`LOCAL_CALENDAR_UNITS`)。 */
export function isCalendarUnit(value: unknown): value is LocalCalendarUnit {
  return (
    typeof value === "string" &&
    (LOCAL_CALENDAR_UNITS as readonly string[]).includes(value)
  );
}

/**
 * 一個參數位置要什麼:
 * - `types`:這幾種型別之一(`null` = 不限)
 * - `sameAs`:與第 `index` 個參數同型別(比較的右邊、`if` 的「否則」)
 * - `result`:與這個運算節點**被期望的型別**相同(`if` 的「然後」)
 * - `optionField`:選項欄位的 key 字串(`optionLabel`)
 * - `dateUnit`:`dateDiff` 的單位字串
 * - `dateDirection` / `calendarUnit`:`dateAdd` 的方向(`before` / `after`)與日曆單位字串
 * - `dateLiteral`:日期常數 `{ "date": ISO }` 的 ISO 字串
 * - `arrayField` / `arrayColumn`:彙總運算子的明細欄 key 與 `number` 子欄 key 字串
 */
export type ParamSpec =
  | { kind: "types"; types: ExpectedTypes }
  | { kind: "sameAs"; index: number }
  | { kind: "result" }
  | { kind: "optionField" }
  | { kind: "dateUnit" }
  | { kind: "dateDirection" }
  | { kind: "calendarUnit" }
  | { kind: "dateLiteral" }
  | { kind: "arrayField" }
  | { kind: "arrayColumn" };

/** 不是一般值的參數位置(選擇器畫成下拉、檢查器另外驗字面值)。 */
export type LiteralParamKind = Exclude<
  ParamSpec["kind"],
  "types" | "sameAs" | "result"
>;

export interface OperatorSignature {
  /** 固定位置的參數 */
  params: readonly ParamSpec[];
  /** 可再加的參數(變長運算子:加、乘、且、或、串接…);沒有 = 參數數量固定 */
  rest?: ParamSpec;
  /** 回傳型別;`then` = 與「然後」同型別(`if`);`first` = 與第一個參數同型別(`dateAdd` 的「起」) */
  returns: ExpressionValueType | "then" | "first";
}

const NUMBERS: ParamSpec = { kind: "types", types: ["number"] };
const BOOLEANS: ParamSpec = { kind: "types", types: ["boolean"] };
const TEXTS: ParamSpec = { kind: "types", types: ["text"] };
const TEMPORALS: ParamSpec = { kind: "types", types: ["date", "datetime"] };
const SAME_AS_FIRST: ParamSpec = { kind: "sameAs", index: 0 };

/** 等不等於:兩邊同型別,任何單值型別都能比。 */
const EQUALITY: OperatorSignature = {
  params: [
    {
      kind: "types",
      types: ["text", "number", "boolean", "date", "datetime"],
    },
    SAME_AS_FIRST,
  ],
  returns: "boolean",
};

/** 大小比較:兩邊同型別,限可排序的型別。 */
const ORDERING: OperatorSignature = {
  params: [
    { kind: "types", types: ["number", "date", "datetime", "text"] },
    SAME_AS_FIRST,
  ],
  returns: "boolean",
};

const ARITHMETIC: OperatorSignature = {
  params: [NUMBERS, NUMBERS],
  rest: NUMBERS,
  returns: "number",
};

/** 彙總:明細欄 key、`number` 子欄 key(皆字面)→ 數字。 */
const AGGREGATE: OperatorSignature = {
  params: [{ kind: "arrayField" }, { kind: "arrayColumn" }],
  returns: "number",
};

const BINARY_ARITHMETIC: OperatorSignature = {
  params: [NUMBERS, NUMBERS],
  returns: "number",
};

/** 每個運算子(`var` 以外)的簽章。 */
export const OPERATOR_SIGNATURES: Readonly<
  Record<Exclude<ExpressionOperator, "var">, OperatorSignature>
> = {
  "+": ARITHMETIC,
  "*": ARITHMETIC,
  min: ARITHMETIC,
  max: ARITHMETIC,
  "-": BINARY_ARITHMETIC,
  "/": BINARY_ARITHMETIC,
  "%": BINARY_ARITHMETIC,
  "==": EQUALITY,
  "!=": EQUALITY,
  "===": EQUALITY,
  "!==": EQUALITY,
  "<": ORDERING,
  ">": ORDERING,
  "<=": ORDERING,
  ">=": ORDERING,
  and: { params: [BOOLEANS, BOOLEANS], rest: BOOLEANS, returns: "boolean" },
  or: { params: [BOOLEANS, BOOLEANS], rest: BOOLEANS, returns: "boolean" },
  "!": { params: [BOOLEANS], returns: "boolean" },
  // 「有值」:任何型別都能問有沒有值(只收是 / 否就等於原值,沒有用途)
  "!!": { params: [{ kind: "types", types: null }], returns: "boolean" },
  in: {
    params: [
      { kind: "types", types: ["text", "number"] },
      { kind: "types", types: ["list"] },
    ],
    returns: "boolean",
  },
  if: {
    params: [BOOLEANS, { kind: "result" }, { kind: "sameAs", index: 1 }],
    returns: "then",
  },
  dateDiff: {
    params: [TEMPORALS, TEMPORALS, { kind: "dateUnit" }],
    returns: "number",
  },
  dateAdd: {
    params: [
      TEMPORALS,
      { kind: "dateDirection" },
      NUMBERS,
      { kind: "calendarUnit" },
    ],
    returns: "first",
  },
  // 日期常數:把 ISO 標成「日期」(選擇器的常數種類「日期」產生它,不在運算子清單裡)
  date: { params: [{ kind: "dateLiteral" }], returns: "date" },
  concat: { params: [TEXTS, TEXTS], rest: TEXTS, returns: "text" },
  sumOf: AGGREGATE,
  minOf: AGGREGATE,
  maxOf: AGGREGATE,
  avgOf: AGGREGATE,
  countOf: { params: [{ kind: "arrayField" }], returns: "number" },
  optionLabel: { params: [{ kind: "optionField" }], returns: "text" },
  now: { params: [], returns: "datetime" },
};

const TEMPORAL_TYPES = new Set<ExpressionValueType>(["date", "datetime"]);

/** 選項型別能放進的一般型別:單選的值是文字、多選的值是清單。 */
const OPTION_BASE_TYPES: Readonly<
  Partial<Record<ExpressionValueType, ExpressionValueType>>
> = { option: "text", optionList: "list" };

/** 期望型別是不是選項欄公式的「選項」位置(`option` / `optionList`)。 */
export function isOptionExpected(expected: ExpectedTypes): boolean {
  return (
    expected?.some((type) => type === "option" || type === "optionList") ===
    true
  );
}

/**
 * `actual` 能不能放進要 `expected` 的位置:型別相同即可;日期與日期時間互通
 * (「現在時間」可放日期 / 日期時間位置,`dateDiff` / `dateAdd` 兩種都收;比較運算子兩邊也可混比 ——
 * 兩者都是時點,計算器把日期時間換成當地日再比);選項放得進文字 / 清單位置,反過來不行。
 */
export function isTypeAccepted(
  actual: ExpressionValueType,
  expected: ExpectedTypes,
): boolean {
  if (expected === null) {
    return true;
  }
  return expected.some(
    (type) =>
      type === actual ||
      OPTION_BASE_TYPES[actual] === type ||
      (TEMPORAL_TYPES.has(type) && TEMPORAL_TYPES.has(actual)),
  );
}

/** 運算子的回傳型別能不能放進 `expected`(`if` 回「然後」的型別,任何位置都能放;`dateAdd` 回日期類)。 */
export function isOperatorAccepted(
  operator: Exclude<ExpressionOperator, "var">,
  expected: ExpectedTypes,
): boolean {
  const { returns } = OPERATOR_SIGNATURES[operator];
  if (returns === "then") {
    return true;
  }
  return isTypeAccepted(returns === "first" ? "datetime" : returns, expected);
}

/** 第 `index` 個參數的規格(超過固定位置時看 `rest`;沒有 `rest` 回 null = 多出來的參數)。 */
export function paramSpecAt(
  operator: Exclude<ExpressionOperator, "var">,
  index: number,
): ParamSpec | null {
  const signature = OPERATOR_SIGNATURES[operator];
  return signature.params[index] ?? signature.rest ?? null;
}

/**
 * 常數的型別:帶時區的 ISO 8601 字串視為日期時間(日期常數也是 ISO —— 當地 00:00 的時點;
 * 日期與日期時間的位置互通)、陣列視為清單;null 沒有型別。
 */
export function constantTypeOf(expr: Expression): ExpressionValueType | null {
  if (typeof expr === "number") {
    return "number";
  }
  if (typeof expr === "boolean") {
    return "boolean";
  }
  if (typeof expr === "string") {
    return isDateTimeString(expr) ? "datetime" : "text";
  }
  return Array.isArray(expr) ? "list" : null;
}

/** 欄位 key → 表達式型別(不存在或不可進表達式回 null)。 */
export type FieldTypeLookup = (fieldKey: string) => ExpressionValueType | null;

const isOperationNode = (
  expr: Expression,
): expr is Record<string, Expression> =>
  typeof expr === "object" && expr !== null && !Array.isArray(expr);

const argsOf = (value: Expression | undefined): Expression[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

/**
 * 推斷表達式回傳的型別(不求值);推不出來(未知運算子、空參數、`if` 的「然後」是 null)回 null。
 * 與 `OPERATOR_SIGNATURES` 同一張表,設計器用它決定「比較的右邊要什麼型別」。
 */
export function inferExpressionType(
  expr: Expression,
  fieldTypeOf: FieldTypeLookup,
): ExpressionValueType | null {
  if (!isOperationNode(expr)) {
    return constantTypeOf(expr);
  }
  const [operator] = Object.keys(expr);
  if (operator === undefined) {
    return null;
  }
  if (operator === "var") {
    const [path] = argsOf(expr.var);
    if (typeof path !== "string") {
      return null;
    }
    if (!path.startsWith("ctx.")) {
      return fieldTypeOf(path);
    }
    const contextTypes: Readonly<Partial<Record<string, ExpressionValueType>>> =
      CONTEXT_VAR_TYPES;
    return contextTypes[path] ?? null;
  }
  const signature = (
    OPERATOR_SIGNATURES as Readonly<Partial<Record<string, OperatorSignature>>>
  )[operator];
  if (signature === undefined) {
    return null;
  }
  if (signature.returns === "first") {
    const [start = null] = argsOf(expr[operator]);
    return inferExpressionType(start, fieldTypeOf);
  }
  if (signature.returns !== "then") {
    return signature.returns;
  }
  const [, thenBranch = null, elseBranch = null] = argsOf(expr[operator]);
  return (
    inferExpressionType(thenBranch, fieldTypeOf) ??
    inferExpressionType(elseBranch, fieldTypeOf)
  );
}

/** 由欄位清單建 `FieldTypeLookup`。 */
export function fieldTypeLookupOf(
  fields: readonly { key: string; type: FieldType }[],
): FieldTypeLookup {
  const types = new Map(
    fields.map((field) => [field.key, FIELD_EXPRESSION_TYPES[field.type]]),
  );
  return (fieldKey) => types.get(fieldKey) ?? null;
}

/**
 * 運算節點第 `index` 個參數位置**要什麼型別**:
 * `sameAs` 看那個參數推得出的型別(推不出來就退回那個參數自己的限制;日期與日期時間照 `isTypeAccepted` 互通;
 * 推得的選項型別放寬成文字 / 清單 —— `leave_type == 文字欄` 照樣能比);但選項欄公式裡 `if` 的「否則」
 * (與「然後」同型、「然後」又是 `result`)要的是同一個「選項」型別,不放寬;
 * `result` = 這個運算節點被期望的型別(`nodeExpected`);字面值參數(單位、方向、欄位 key…)不是一般值,回空陣列。
 */
export function expectedTypesAt(
  operator: Exclude<ExpressionOperator, "var">,
  index: number,
  args: readonly Expression[],
  nodeExpected: ExpectedTypes,
  fieldTypeOf: FieldTypeLookup,
): ExpectedTypes {
  const spec = paramSpecAt(operator, index);
  if (spec === null) {
    return null;
  }
  switch (spec.kind) {
    case "types": {
      return spec.types;
    }
    case "result": {
      return nodeExpected;
    }
    case "sameAs": {
      if (
        isOptionExpected(nodeExpected) &&
        paramSpecAt(operator, spec.index)?.kind === "result"
      ) {
        return nodeExpected;
      }
      const source = args[spec.index] ?? null;
      const inferred = inferExpressionType(source, fieldTypeOf);
      if (inferred === null) {
        return expectedTypesAt(
          operator,
          spec.index,
          args,
          nodeExpected,
          fieldTypeOf,
        );
      }
      return [OPTION_BASE_TYPES[inferred] ?? inferred];
    }
    case "optionField":
    case "dateUnit":
    case "dateDirection":
    case "calendarUnit":
    case "dateLiteral":
    case "arrayField":
    case "arrayColumn": {
      return [];
    }
  }
}

/**
 * 比「同一個選項來源」時不看的鍵:只影響顯示、不影響選項值(lookup 的 `labelTemplate` 顯示名模板)。
 * 出現在任何一層都略過。
 */
const DISPLAY_ONLY_OPTION_KEYS: ReadonlySet<string> = new Set([
  "labelTemplate",
]);

/**
 * 排好鍵序的 JSON(深比較用;鍵的先後不同不算不同;值是 `undefined` 的鍵與 `omitted` 裡的鍵略過,
 * 所以 `{ a: 1, b: undefined }` 與 `{ a: 1 }` 相同)。
 */
function canonicalJson(
  value: unknown,
  omitted: ReadonlySet<string> = new Set(),
): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, omitted)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && !omitted.has(key))
      .toSorted((left, right) => (left < right ? -1 : 1))
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key], omitted)}`,
      )
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/**
 * 兩個選項欄是不是**同一個選項來源**(`options` 深比較相等;顯示用的 `labelTemplate` 與 `undefined` 的鍵不算):選項欄公式的根只收同來源的欄位。
 */
export function isSameOptionSource(
  left: Pick<FieldDef, "options">,
  right: Pick<FieldDef, "options">,
): boolean {
  return (
    canonicalJson(left.options ?? null, DISPLAY_ONLY_OPTION_KEYS) ===
    canonicalJson(right.options ?? null, DISPLAY_ONLY_OPTION_KEYS)
  );
}

/**
 * 常數在不在目標選項欄的選項裡:靜態選項驗 value 在清單內(停用的也算 —— 既有資料仍有效);
 * 類別 / lookup 選項執行時才知道,只驗是字串。
 */
export function isOptionConstantOf(
  target: Pick<FieldDef, "options">,
  value: unknown,
): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const options = target.options;
  return (
    options?.kind !== "static" ||
    options.items.some((item) => item.value === value)
  );
}
