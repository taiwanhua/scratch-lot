import {
  ARRAY_AGGREGATE_OPERATORS,
  ROW_VAR_PREFIX,
  isArrayAggregateOperator,
} from "./array";
import { isDateTimeString } from "./temporal";
import type { Expression } from "./types";

/**
 * 表達式的**形狀**檢查(不求值):白名單運算子、深度 / 節點上限、`var` 路徑。
 * 計算器求值前與檢查器都走這裡,所以兩邊擋的東西一模一樣(Spec §5「表達式」的限制)。
 */

/** 允許的運算子。沒有任何正則運算子(正則只在 `rules.pattern`);未列者一律拒絕。 */
export const EXPRESSION_OPERATORS = [
  "var",
  "if",
  "==",
  "!=",
  "===",
  "!==",
  "!",
  "!!",
  "and",
  "or",
  "<",
  ">",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "min",
  "max",
  "in",
  "dateDiff",
  "dateAdd",
  "date",
  "concat",
  "optionLabel",
  "now",
  ...ARRAY_AGGREGATE_OPERATORS,
] as const;

export type ExpressionOperator = (typeof EXPRESSION_OPERATORS)[number];

/** 運算子巢狀深度上限。 */
export const MAX_EXPRESSION_DEPTH = 10;

/** 節點總數上限(運算子、陣列、常數都算一個節點)。 */
export const MAX_EXPRESSION_NODES = 200;

/** `var` 可讀的上下文路徑(`ctx.*`)。 */
export const CONTEXT_VAR_PATHS = [
  "ctx.now",
  "ctx.timezone",
  "ctx.user.id",
  "ctx.user.orgId",
  "ctx.user.orgIds",
  "ctx.tenant.id",
] as const;

/** 欄位的 `var` 路徑:單一段,不含 `.`(欄位 key 本來就不准有 `.`)。 */
const FIELD_VAR_PATH = /^[a-z][a-z0-9_]*$/;

/** 列內公式的 `var` 路徑:`row.<子欄 key>`(同一列的子欄;只在明細子欄的公式裡合法,由檢查器判)。 */
const ROW_VAR_PATH = /^row\.[a-z][a-z0-9_]*$/;

export type ExpressionShapeProblem =
  | "UNKNOWN_OPERATOR"
  | "INVALID_NODE"
  | "INVALID_VAR"
  | "TOO_DEEP"
  | "TOO_MANY_NODES";

export interface ExpressionShapeIssue {
  problem: ExpressionShapeProblem;
  /** 在表達式樹裡的位置,以 `.` 串接(如 `*.0.var`);根為空字串。 */
  path: string;
  detail: string;
}

/**
 * 表達式引用到的一個欄位:`var`、`optionLabel` 的欄位 key,或彙總運算子的明細欄 key
 * (`via` 分辨是哪一種;依賴、受保護、引用檢查三種一視同仁,「不能直接 `var` 明細欄」只看 `var`)。
 */
export interface ExpressionFieldRef {
  fieldKey: string;
  path: string;
  via: "var" | "optionLabel" | "aggregate";
}

/** 列內公式的 `row.<子欄 key>` 引用。 */
export interface ExpressionRowRef {
  columnKey: string;
  path: string;
}

/** 彙總運算子的一次使用:`{ "sumOf": ["items", "subtotal"] }`、`{ "countOf": ["items"] }`。 */
export interface ExpressionAggregateRef {
  operator: (typeof ARRAY_AGGREGATE_OPERATORS)[number];
  arrayKey: string;
  /** `countOf` 為 null */
  columnKey: string | null;
  path: string;
}

export interface ExpressionScan {
  issues: ExpressionShapeIssue[];
  refs: ExpressionFieldRef[];
  rowRefs: ExpressionRowRef[];
  aggregates: ExpressionAggregateRef[];
  /** 用到 `ctx.*` 或 `now()` — 用來判斷「常數」表達式。 */
  usesContext: boolean;
}

const OPERATOR_SET = new Set<string>(EXPRESSION_OPERATORS);

/**
 * 一次走完整棵樹:收集形狀問題與欄位引用。
 *
 * **上限在走的當下就生效**,不是走完才判斷:
 * - 深度:運算子節點算一層;**陣列也算一層**(運算子自己的參數陣列除外,它與運算子是同一層)——
 *   否則 `[[[[…]]]]` 這種純陣列巢狀完全不受深度限制
 * - 節點數:一超過上限就中止整棵樹的走訪
 *
 * 所以遞迴深度最多約 `2 × MAX_EXPRESSION_DEPTH`、走訪的節點最多 `MAX_EXPRESSION_NODES + 1` 個:
 * 任意惡意輸入(上萬層巢狀、超大陣列)都只回問題,不會爆堆疊、不會 throw。
 */
export function scanExpression(expr: Expression): ExpressionScan {
  const scan: ExpressionScan = {
    issues: [],
    refs: [],
    rowRefs: [],
    aggregates: [],
    usesContext: false,
  };
  const walker: Walker = { scan, nodes: 0, aborted: false };
  walk(walker, expr, "", 0, false);
  return scan;
}

interface Walker {
  scan: ExpressionScan;
  nodes: number;
  /** 節點數已超過上限:其餘節點一律不走。 */
  aborted: boolean;
}

function joinPath(base: string, segment: string | number): string {
  return base === "" ? String(segment) : `${base}.${String(segment)}`;
}

/** 記一個節點;超過上限時記一次 `TOO_MANY_NODES` 並中止,回 false。 */
function countNode(walker: Walker, path: string): boolean {
  if (walker.aborted) {
    return false;
  }
  walker.nodes += 1;
  if (walker.nodes > MAX_EXPRESSION_NODES) {
    walker.aborted = true;
    walker.scan.issues.push({
      problem: "TOO_MANY_NODES",
      path,
      detail: `節點數超過上限 ${String(MAX_EXPRESSION_NODES)}`,
    });
    return false;
  }
  return true;
}

function tooDeep(walker: Walker, path: string): void {
  walker.scan.issues.push({
    problem: "TOO_DEEP",
    path,
    detail: `巢狀深度超過上限 ${String(MAX_EXPRESSION_DEPTH)}`,
  });
}

/**
 * @param depth 目前已經在幾層容器(運算子 / 陣列)裡
 * @param isOperatorArguments 這個節點是不是某個運算子的參數本身(參數陣列不另算一層)
 */
function walk(
  walker: Walker,
  node: Expression,
  path: string,
  depth: number,
  isOperatorArguments: boolean,
): void {
  if (!countNode(walker, path)) {
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    walkArray(walker, node, path, isOperatorArguments ? depth : depth + 1);
    return;
  }
  const { scan } = walker;
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    scan.issues.push({
      problem: "INVALID_NODE",
      path,
      detail: "運算子節點必須恰好一個鍵",
    });
    return;
  }
  const operator = keys[0] ?? "";
  const operatorPath = joinPath(path, operator);
  if (!OPERATOR_SET.has(operator)) {
    scan.issues.push({
      problem: "UNKNOWN_OPERATOR",
      path: operatorPath,
      detail: `未知運算子 ${operator}`,
    });
    return;
  }
  if (depth + 1 > MAX_EXPRESSION_DEPTH) {
    tooDeep(walker, operatorPath);
    return;
  }
  const argument = node[operator] ?? null;
  if (operator === "var") {
    checkVar(argument, operatorPath, scan);
    countNode(walker, operatorPath);
    return;
  }
  if (operator === "optionLabel") {
    checkOptionLabel(argument, operatorPath, scan);
    countNode(walker, operatorPath);
    return;
  }
  if (operator === "date") {
    checkDateLiteral(argument, operatorPath, scan);
    countNode(walker, operatorPath);
    return;
  }
  if (isArrayAggregateOperator(operator)) {
    checkAggregate(operator, argument, operatorPath, scan);
    countNode(walker, operatorPath);
    return;
  }
  if (operator === "now") {
    scan.usesContext = true;
  }
  walk(walker, argument, operatorPath, depth + 1, true);
}

/** 陣列的每個元素;`arrayDepth` 已含這個陣列自己那一層。 */
function walkArray(
  walker: Walker,
  node: readonly Expression[],
  path: string,
  arrayDepth: number,
): void {
  if (arrayDepth > MAX_EXPRESSION_DEPTH) {
    tooDeep(walker, path);
    return;
  }
  for (const [index, child] of node.entries()) {
    if (walker.aborted) {
      return;
    }
    walk(walker, child, joinPath(path, index), arrayDepth, false);
  }
}

/** `var` 只收常數字串(或 `[路徑, 預設值]`),路徑必須是欄位 key 或 `ctx.*`。 */
function checkVar(
  argument: Expression,
  path: string,
  scan: ExpressionScan,
): void {
  const target = Array.isArray(argument) ? argument[0] : argument;
  const fallback = Array.isArray(argument) ? argument[1] : undefined;
  const isFallbackLiteral =
    fallback === undefined || fallback === null || typeof fallback !== "object";
  if (typeof target !== "string" || !isFallbackLiteral) {
    scan.issues.push({
      problem: "INVALID_VAR",
      path,
      detail: "var 的路徑必須是常數字串",
    });
    return;
  }
  if ((CONTEXT_VAR_PATHS as readonly string[]).includes(target)) {
    scan.usesContext = true;
    return;
  }
  if (ROW_VAR_PATH.test(target)) {
    scan.rowRefs.push({
      columnKey: target.slice(ROW_VAR_PREFIX.length),
      path,
    });
    return;
  }
  if (!FIELD_VAR_PATH.test(target)) {
    scan.issues.push({
      problem: "INVALID_VAR",
      path,
      detail: `var 路徑 ${target} 不是欄位 key、ctx.* 也不是 row.<子欄 key>`,
    });
    return;
  }
  scan.refs.push({ fieldKey: target, path, via: "var" });
}

function isKeyLiteral(value: unknown): value is string {
  return typeof value === "string" && FIELD_VAR_PATH.test(value);
}

/**
 * 彙總運算子:參數都是**字面** key(不可運算出來)—— `sumOf` / `minOf` / `maxOf` / `avgOf` 兩個
 * (明細欄 key、子欄 key),`countOf` 一個(明細欄 key)。明細欄與子欄存不存在、子欄是不是數字由檢查器判。
 */
function checkAggregate(
  operator: (typeof ARRAY_AGGREGATE_OPERATORS)[number],
  argument: Expression,
  path: string,
  scan: ExpressionScan,
): void {
  const args = Array.isArray(argument) ? argument : [argument];
  const arity = operator === "countOf" ? 1 : 2;
  const [arrayKey, columnKey] = args;
  if (
    args.length !== arity ||
    !isKeyLiteral(arrayKey) ||
    (arity === 2 && !isKeyLiteral(columnKey))
  ) {
    scan.issues.push({
      problem: "INVALID_NODE",
      path,
      detail:
        operator === "countOf"
          ? "countOf 的參數必須是一個明細欄 key 常數"
          : `${operator} 的參數必須是明細欄 key 與子欄 key 兩個常數`,
    });
    return;
  }
  scan.refs.push({ fieldKey: arrayKey, path, via: "aggregate" });
  scan.aggregates.push({
    operator,
    arrayKey,
    columnKey: arity === 2 && isKeyLiteral(columnKey) ? columnKey : null,
    path,
  });
}

function checkOptionLabel(
  argument: Expression,
  path: string,
  scan: ExpressionScan,
): void {
  const target = Array.isArray(argument) ? argument[0] : argument;
  if (typeof target !== "string" || !FIELD_VAR_PATH.test(target)) {
    scan.issues.push({
      problem: "INVALID_VAR",
      path,
      detail: "optionLabel 的參數必須是欄位 key 常數",
    });
    return;
  }
  scan.refs.push({ fieldKey: target, path, via: "optionLabel" });
}

/**
 * 日期常數 `{ "date": "<ISO>" }`:參數只能是帶時區的 ISO 字串(或包一層陣列),不可運算出來。
 * 它把常數**標成日期型別**(當地那一天),比較時與日期時間混比會換成當地日再比。
 */
function checkDateLiteral(
  argument: Expression,
  path: string,
  scan: ExpressionScan,
): void {
  const target = Array.isArray(argument) ? argument[0] : argument;
  if (!isDateTimeString(target)) {
    scan.issues.push({
      problem: "INVALID_NODE",
      path,
      detail: "日期常數必須是含時區的 ISO 8601 字串",
    });
  }
}

/** 表達式引用到的欄位 key(去重);形狀有問題的節點不列。 */
export function referencedFieldKeys(expr: Expression): string[] {
  return [...new Set(scanExpression(expr).refs.map((ref) => ref.fieldKey))];
}
