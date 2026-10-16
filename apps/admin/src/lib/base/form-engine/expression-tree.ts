import {
  DEFAULT_DATE_DIFF_UNIT,
  DEFAULT_TENANT_TIMEZONE,
  EXPRESSION_OPERATORS,
  type Expression,
  OPERATOR_SIGNATURES,
  type OperatorSignature,
  isDateTimeString,
  paramSpecAt,
  startOfLocalDayOf,
  toIso,
} from "@repo/domain/form";

/**
 * 設計器的**結構化表達式選擇器**(Spec 6a §5「表達式」:欄位 / 運算 / 常數,可巢狀;不做文字輸入)
 * 在 JSONLogic 樹上的操作。每個節點是五種之一:
 *
 * - `field`:`{ "var": "qty" }`
 * - `context`:`{ "var": "ctx.now" }`(畫面上叫「系統值」,路徑白名單 `CONTEXT_VAR_PATHS`)
 * - `constant`:字串 / 數字 / 布林 / 日期(`{ "date": ISO }`,當地 00:00)/ 日期時間(ISO 字串)/
 *   清單(字串陣列)
 * - `operation`:`{ "<運算子>": [參數…] }`(`var` / `date` 以外的白名單運算子)
 * - `empty`:`null` —— 還沒選的參數位置(畫面顯示「請選節點種類」;比較的參數未選 = 空值)
 */
export type ExpressionNodeKind =
  "field" | "context" | "constant" | "operation" | "empty";

/** 選擇器可選的運算子(`var` 由「欄位 / 上下文」產生、`date` 由日期常數產生,不在這裡)。 */
export const PICKER_OPERATORS = EXPRESSION_OPERATORS.filter(
  (operator) => operator !== "var" && operator !== "date",
);

export type PickerOperator = (typeof PICKER_OPERATORS)[number];

/** 運算節點:一個運算子鍵對一串參數。 */
export type OperationExpression = Record<string, Expression[]>;

/**
 * 新建運算節點時預設幾個參數(變長運算子之後可再增減;`now` 沒有參數、`optionLabel` 參數是欄位 key 字串、
 * `dateDiff` 第三個是單位、`dateAdd` 是起 / 方向 / 數量 / 單位;彙總是明細欄 / 子欄兩個 key,`countOf` 只有明細欄)。
 */
const DEFAULT_ARITY: Partial<Record<string, number>> = {
  "!": 1,
  "!!": 1,
  if: 3,
  now: 0,
  optionLabel: 1,
  dateDiff: 3,
  dateAdd: 4,
  countOf: 1,
};

/** 新建時就有值的參數位置(`dateDiff` 的單位預設天;`dateAdd` 預設「之後 1 天」)。 */
const DEFAULT_ARGS: Partial<
  Record<string, Partial<Record<number, Expression>>>
> = {
  dateDiff: { 2: DEFAULT_DATE_DIFF_UNIT },
  dateAdd: { 1: "after", 2: 1, 3: "days" },
};

/** 條件位置(`if` 第一格、且 / 或 / 非的參數)預設放一個「等於」比較;其餘沒選的位置是 null(空位)。 */
export const defaultArgOf = (operator: string, index: number): Expression => {
  const spec = paramSpecAt(
    operator as Parameters<typeof paramSpecAt>[0],
    index,
  );
  const isCondition =
    spec?.kind === "types" &&
    spec.types?.length === 1 &&
    spec.types[0] === "boolean";
  const fallback: Expression = isCondition ? { "==": [null, null] } : null;
  return DEFAULT_ARGS[operator]?.[index] ?? fallback;
};

const arityOf = (operator: string): number => DEFAULT_ARITY[operator] ?? 2;

const isRecord = (value: unknown): value is Record<string, Expression> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const operatorOf = (expr: Expression): string | null => {
  if (!isRecord(expr)) {
    return null;
  }
  const keys = Object.keys(expr);
  return keys.length > 0 ? keys[0] : null;
};

export const nodeKindOf = (expr: Expression): ExpressionNodeKind => {
  if (expr === null) {
    return "empty";
  }
  const operator = operatorOf(expr);
  if (operator === null || operator === "date") {
    return "constant";
  }
  if (operator !== "var") {
    return "operation";
  }
  return varPathOf(expr).startsWith("ctx.") ? "context" : "field";
};

/** `var` 節點的路徑(欄位 key 或 `ctx.*`)。 */
export const varPathOf = (expr: Expression): string => {
  const path = isRecord(expr) ? expr.var : null;
  return typeof path === "string" ? path : "";
};

/** 運算節點的參數(JSONLogic 允許單一參數不包陣列,這裡一律攤成陣列)。 */
export const argsOf = (expr: Expression): Expression[] => {
  const operator = operatorOf(expr);
  if (operator === null || !isRecord(expr)) {
    return [];
  }
  const args = expr[operator];
  return Array.isArray(args) ? args : [args];
};

export const fieldNode = (fieldKey: string): Expression => ({ var: fieldKey });

export const contextNode = (path: string): Expression => ({ var: path });

export const operationNode = (operator: string): OperationExpression => ({
  [operator]: Array.from({ length: arityOf(operator) }, (_item, index) =>
    defaultArgOf(operator, index),
  ),
});

/** 運算節點改參數:`update` 收到目前的參數陣列、回新的陣列(運算子不變)。 */
export const withArgs = (
  expr: Expression,
  update: (args: Expression[]) => Expression[],
): OperationExpression => {
  const operator = operatorOf(expr) ?? "and";
  return { [operator]: update(argsOf(expr)) };
};

const signatureOf = (operator: string): OperatorSignature | undefined =>
  (OPERATOR_SIGNATURES as Readonly<Partial<Record<string, OperatorSignature>>>)[
    operator
  ];

/** 兩個運算子的參數與回傳型別一樣(同一族:等於 / 不等於、加 / 乘…)。 */
const isSameFamily = (left: string, right: string): boolean => {
  const before = signatureOf(left);
  const after = signatureOf(right);
  if (before === undefined || after === undefined) {
    return false;
  }
  return (
    before.returns === after.returns &&
    JSON.stringify(before.params) === JSON.stringify(after.params)
  );
};

/**
 * 換運算子:同一族(參數與回傳型別相同,如「等於」換「不等於」)保留參數、數量不夠補預設;
 * 換到別族就**重設**成新運算子的預設參數(型別導向:數字參數留到串接只會變成選不到的舊值)。
 */
export const withOperator = (
  expr: Expression,
  operator: string,
): OperationExpression => {
  const previous = operatorOf(expr);
  if (previous === null || !isSameFamily(previous, operator)) {
    return operationNode(operator);
  }
  const args = argsOf(expr);
  const missing = Array.from(
    { length: Math.max(0, arityOf(operator) - args.length) },
    (_item, index) => defaultArgOf(operator, args.length + index),
  );
  return { [operator]: [...args, ...missing] };
};

/**
 * 常數的種類(選擇器先選種類再填值,不從文字猜型別):日期 = `{ "date": ISO }`(當地 00:00,標成日期型別)、
 * 日期時間 = ISO 字串、清單 = 字串陣列;`option` / `optionList` = 從目標選項欄的選項挑(單選 = value 字串、
 * 多選 = value 陣列),只在位置有目標選項欄時出現(取代文字 / 清單)。
 */
export const CONSTANT_KINDS = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "list",
  "option",
  "optionList",
] as const;

export type ConstantKind = (typeof CONSTANT_KINDS)[number];

/** 日期常數節點 `{ "date": ISO }`。 */
export const dateConstantNode = (iso: string): Expression => ({ date: iso });

/** 日期常數節點裡的 ISO(不是日期常數 → null)。 */
export const dateConstantIsoOf = (expr: Expression): string | null => {
  if (operatorOf(expr) !== "date" || !isRecord(expr)) {
    return null;
  }
  const raw = expr.date;
  const iso = Array.isArray(raw) ? raw[0] : raw;
  return typeof iso === "string" ? iso : null;
};

/**
 * 常數的種類;`hasOptionTarget` = 這個位置有目標選項欄(字串 / 陣列常數是從它的選項挑的)。
 * `null`(空位)不是常數,這裡當文字處理(呼叫端先以 `nodeKindOf` 分出空位)。
 */
export const constantKindOf = (
  expr: Expression,
  hasOptionTarget = false,
): ConstantKind => {
  if (typeof expr === "number") {
    return "number";
  }
  if (typeof expr === "boolean") {
    return "boolean";
  }
  if (operatorOf(expr) === "date") {
    return "date";
  }
  if (Array.isArray(expr)) {
    return hasOptionTarget ? "optionList" : "list";
  }
  if (typeof expr === "string" && isDateTimeString(expr)) {
    return "datetime";
  }
  return hasOptionTarget ? "option" : "text";
};

const MS_PER_MINUTE = 60_000;

/**
 * 換常數種類時的起點值:日期 = 今天(`timezone` 的當地 00:00)、日期時間 = 此刻(整分);只在事件處理內呼叫,
 * 不在 render 期間讀時間。選項先空字串 / 空陣列(由選項下拉填)。
 */
const CONSTANT_DEFAULTS: Readonly<
  Record<ConstantKind, (timezone: string, now: number) => Expression>
> = {
  text: () => "",
  number: () => 0,
  boolean: () => true,
  date: (timezone, now) =>
    dateConstantNode(toIso(startOfLocalDayOf(now, timezone))),
  datetime: (_timezone, now) => toIso(now - (now % MS_PER_MINUTE)),
  list: () => [],
  option: () => "",
  optionList: () => [],
};

export const constantDefaultOf = (
  kind: ConstantKind,
  timezone: string = DEFAULT_TENANT_TIMEZONE,
): Expression => CONSTANT_DEFAULTS[kind](timezone, Date.now());

/** 清單常數在輸入框裡以頓號或逗號分隔。 */
const LIST_SEPARATOR = /[,，、]/u;

export const constantText = (expr: Expression): string => {
  if (Array.isArray(expr)) {
    return expr.map((item) => constantText(item)).join(",");
  }
  return expr === null || typeof expr === "object" ? "" : String(expr);
};

/** 輸入框的字 → 清單常數(去空白、去空項)。 */
export const listConstantOf = (text: string): Expression[] =>
  text
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== "");
