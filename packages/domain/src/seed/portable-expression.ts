/**
 * 表達式的 **ID 語意**資料流(可攜性檢查用;規則正本在 `portable-definition.ts` 的檔頭)。
 *
 * 不另寫求值器:形狀先過既有 `scanExpression`,這裡只沿同一棵樹推「這個位置的值從哪來」——
 * 動態 ID(`ctx.user.id`、`ctx.tenant.id`、引用欄、lookup 選項值、由它們帶入或算出的欄位)、動態 ID 集合、null、空陣列、
 * 寫死的值、其他動態值。判斷只看來源,不看字串長得像不像 ObjectId:24 碼文字常數與文字欄比較照常通過。
 */
import { isArrayAggregateOperator } from "../form/array";
import type { Expression } from "../form/types";
import { joinSeedPath } from "./canonical";

/** 一個位置可能出現的值來源(位元旗標,可聯集)。 */
export const ORIGIN = {
  /** 動態 ID */
  id: 1,
  /** 動態 ID 集合 */
  idList: 2,
  /** null */
  nil: 4,
  /** 空陣列 */
  emptyList: 8,
  /** 寫死的非空值 */
  fixed: 16,
  /** 其他動態值(一般欄位、時間、運算結果) */
  dynamic: 32,
} as const;

const ID_ORIGINS = ORIGIN.id | ORIGIN.idList;

export function hasIdOrigin(origins: number): boolean {
  return (origins & ID_ORIGINS) !== 0;
}

/** 只可能是動態 ID(或 null)。 */
export function isPureId(origins: number): boolean {
  return (
    (origins & ORIGIN.id) !== 0 && (origins & ~(ORIGIN.id | ORIGIN.nil)) === 0
  );
}

/** 只可能是動態 ID 集合(或 null / 空陣列)。 */
export function isPureIdList(origins: number): boolean {
  return (
    (origins & ORIGIN.idList) !== 0 &&
    (origins & ~(ORIGIN.idList | ORIGIN.nil | ORIGIN.emptyList)) === 0
  );
}

/** 帶 ID 語意的欄位在依賴鏈上傳下去的標記:集合優先。 */
export function idTagOf(origins: number): number {
  return (origins & ORIGIN.idList) === 0 ? ORIGIN.id : ORIGIN.idList;
}

/** 表達式看得到的欄位來源;回 `undefined` = 這裡沒有這個名字(語意無法判定)。 */
export interface IdScope {
  /** 表單層欄位 key。 */
  field: (key: string) => number | undefined;
  /** 列內公式的 `row.<子欄 key>`;不在明細裡時不提供。 */
  column?: (key: string) => number | undefined;
  /** 彙總運算子讀的明細子欄。 */
  aggregateColumn: (arrayKey: string, columnKey: string) => number | undefined;
}

export type IdFindingCode =
  "ID_COMPARISON" | "ID_FIXED_MIX" | "ID_OPERATOR" | "EXPRESSION_UNSUPPORTED";

export interface IdFinding {
  code: IdFindingCode;
  /** 表達式樹裡的位置(與 `scanExpression` 的 path 同一套;根為空字串)。 */
  path: string;
  detail: string;
}

export interface IdFlow {
  origins: number;
  findings: IdFinding[];
}

const ID_CONTEXT_PATHS: ReadonlySet<string> = new Set([
  "ctx.user.id",
  "ctx.user.orgId",
  "ctx.tenant.id",
]);

/** 動態 ID 集合的系統值(填寫者的所屬組織全部)。 */
const ID_LIST_CONTEXT_PATHS: ReadonlySet<string> = new Set(["ctx.user.orgIds"]);

const EQUALITY_OPERATORS: ReadonlySet<string> = new Set([
  "==",
  "!=",
  "===",
  "!==",
]);

const ROW_PREFIX = "row.";

const CONSTANT_ONLY = ORIGIN.fixed | ORIGIN.nil | ORIGIN.emptyList;

function isConstantOnly(origins: number): boolean {
  return (origins & ~CONSTANT_ONLY) === 0;
}

/** 不帶 ID 的運算結果:參數全是常數就仍是寫死的值,否則是動態值。 */
function plainResultOf(args: readonly number[]): number {
  return args.length > 0 && args.every((item) => isConstantOnly(item))
    ? ORIGIN.fixed
    : ORIGIN.dynamic;
}

function isIdSide(origins: number): boolean {
  return isPureId(origins) || origins === ORIGIN.nil;
}

function isIdListSide(origins: number): boolean {
  return (
    isPureIdList(origins) ||
    origins === ORIGIN.nil ||
    origins === ORIGIN.emptyList
  );
}

interface Argument {
  expr: Expression;
  path: string;
  origins: number;
}

class IdFlowAnalyzer {
  readonly findings: IdFinding[] = [];

  constructor(private readonly scope: IdScope) {}

  visit(node: Expression, path: string): number {
    if (node === null) {
      return ORIGIN.nil;
    }
    if (Array.isArray(node)) {
      return this.visitList(node, path);
    }
    if (typeof node !== "object") {
      return ORIGIN.fixed;
    }
    const [operator, ...rest] = Object.keys(node);
    if (operator === undefined || rest.length > 0) {
      // 形狀不合法:`scanExpression` 已經報過,這裡不重複
      return ORIGIN.dynamic;
    }
    return this.visitOperation(
      operator,
      node[operator] ?? null,
      joinSeedPath(path, operator),
    );
  }

  /** 陣列常數:元素全是動態 ID 才是 ID 集合;ID 與寫死的值混在一起不行。 */
  private visitList(items: readonly Expression[], path: string): number {
    if (items.length === 0) {
      return ORIGIN.emptyList;
    }
    const args = items.map((expr, index) => {
      const itemPath = joinSeedPath(path, index);
      return { expr, path: itemPath, origins: this.visit(expr, itemPath) };
    });
    if (!args.some((item) => hasIdOrigin(item.origins))) {
      return plainResultOf(args.map((item) => item.origins));
    }
    for (const item of args) {
      if (!isIdSide(item.origins)) {
        this.report(
          (item.origins & ORIGIN.fixed) === 0 ? "ID_OPERATOR" : "ID_FIXED_MIX",
          item.path,
          "ID 集合的元素只能是動態 ID,不能混入寫死的值或其他值",
        );
      }
    }
    return ORIGIN.idList;
  }

  private visitOperation(
    operator: string,
    raw: Expression,
    path: string,
  ): number {
    if (operator === "var") {
      return this.visitVar(raw, path);
    }
    if (operator === "optionLabel" || operator === "now") {
      // optionLabel 回的是顯示文字,不是 ID
      return ORIGIN.dynamic;
    }
    if (operator === "date") {
      return ORIGIN.fixed;
    }
    if (isArrayAggregateOperator(operator)) {
      return this.visitAggregate(operator, raw, path);
    }
    const args: Argument[] = Array.isArray(raw)
      ? raw.map((expr, index) => {
          const argPath = joinSeedPath(path, index);
          return { expr, path: argPath, origins: this.visit(expr, argPath) };
        })
      : [{ expr: raw, path, origins: this.visit(raw, path) }];
    if (EQUALITY_OPERATORS.has(operator)) {
      return this.visitEquality(operator, args);
    }
    switch (operator) {
      case "in": {
        return this.visitIn(args);
      }
      case "if": {
        return this.visitIf(args);
      }
      case "and":
      case "or": {
        // 回傳值是其中一個參數:來源照樣往外帶,由用到它的位置判斷能不能當 ID
        return args.reduce((union, item) => union | item.origins, 0);
      }
      case "!":
      case "!!": {
        // 判空 / 真假:參數是 ID 也可以
        return plainResultOf(args.map((item) => item.origins));
      }
      default: {
        for (const item of args) {
          if (hasIdOrigin(item.origins)) {
            this.report(
              "ID_OPERATOR",
              item.path,
              `不支援把 ID 傳入「${operator}」(拼接、數字 / 日期運算、大小比較與轉型都不行)`,
            );
          }
        }
        return plainResultOf(args.map((item) => item.origins));
      }
    }
  }

  private visitVar(raw: Expression, path: string): number {
    const target = Array.isArray(raw) ? raw[0] : raw;
    const fallback = Array.isArray(raw) ? raw[1] : undefined;
    if (typeof target !== "string") {
      return ORIGIN.dynamic;
    }
    let fallbackOrigins = 0;
    if (fallback === null) {
      fallbackOrigins = ORIGIN.nil;
    } else if (fallback !== undefined) {
      fallbackOrigins = ORIGIN.fixed;
    }
    return this.varOrigins(target, path) | fallbackOrigins;
  }

  private varOrigins(target: string, path: string): number {
    if (target.startsWith("ctx.")) {
      if (ID_LIST_CONTEXT_PATHS.has(target)) {
        return ORIGIN.idList;
      }
      return ID_CONTEXT_PATHS.has(target) ? ORIGIN.id : ORIGIN.dynamic;
    }
    const origins = target.startsWith(ROW_PREFIX)
      ? this.scope.column?.(target.slice(ROW_PREFIX.length))
      : this.scope.field(target);
    if (origins === undefined) {
      this.report(
        "EXPRESSION_UNSUPPORTED",
        path,
        `找不到 ${target},無法判定它是不是 ID`,
      );
      return ORIGIN.dynamic;
    }
    return origins;
  }

  private visitAggregate(
    operator: string,
    raw: Expression,
    path: string,
  ): number {
    const [arrayKey, columnKey] = Array.isArray(raw) ? raw : [raw];
    if (typeof arrayKey !== "string" || typeof columnKey !== "string") {
      return ORIGIN.dynamic;
    }
    const origins = this.scope.aggregateColumn(arrayKey, columnKey);
    if (origins === undefined) {
      this.report(
        "EXPRESSION_UNSUPPORTED",
        path,
        `找不到明細子欄 ${arrayKey}.${columnKey},無法判定它是不是 ID`,
      );
    } else if (hasIdOrigin(origins)) {
      this.report(
        "ID_OPERATOR",
        path,
        `不支援把 ID 傳入「${operator}」(${arrayKey}.${columnKey} 帶 ID 語意)`,
      );
    }
    return ORIGIN.dynamic;
  }

  /** 相等 / 不等:碰到 ID 時,另一邊只能是另一個動態 ID(或集合對集合)或 null。 */
  private visitEquality(operator: string, args: readonly Argument[]): number {
    const result = plainResultOf(args.map((item) => item.origins));
    if (!args.some((item) => hasIdOrigin(item.origins))) {
      return result;
    }
    const isIdPair = args.every((item) => isIdSide(item.origins));
    const isIdListPair = args.every((item) => isIdListSide(item.origins));
    if (args.length === 2 && (isIdPair || isIdListPair)) {
      return result;
    }
    let hasOffender = false;
    for (const item of args) {
      if (!isIdSide(item.origins) && !isIdListSide(item.origins)) {
        hasOffender = true;
        this.report(
          "ID_COMPARISON",
          item.path,
          (item.origins & ORIGIN.fixed) === 0
            ? `ID 的「${operator}」比較只能對另一個動態 ID 或 null,這一邊不是 ID`
            : `ID 的「${operator}」比較只能對另一個動態 ID 或 null,不能對寫死的值`,
        );
      }
    }
    if (!hasOffender) {
      const [first] = args;
      this.report(
        "ID_COMPARISON",
        first?.path ?? "",
        `ID 的「${operator}」比較兩邊必須同為動態 ID 或同為動態 ID 集合`,
      );
    }
    return result;
  }

  /** `in`:要找的是動態 ID、清單是動態 ID 集合或空陣列才行。 */
  private visitIn(args: readonly Argument[]): number {
    const result = plainResultOf(args.map((item) => item.origins));
    if (!args.some((item) => hasIdOrigin(item.origins))) {
      return result;
    }
    const [needle, haystack, ...extra] = args;
    if (needle !== undefined && !isIdSide(needle.origins)) {
      this.report(
        "ID_COMPARISON",
        needle.path,
        "「in」對 ID 集合時,要找的值只能是動態 ID 或 null",
      );
    }
    if (haystack !== undefined && !isIdListSide(haystack.origins)) {
      this.report(
        "ID_COMPARISON",
        haystack.path,
        "ID 的「in」只能對動態 ID 集合或空陣列,不能對寫死的清單或其他值",
      );
    }
    for (const item of extra) {
      if (hasIdOrigin(item.origins)) {
        this.report("ID_OPERATOR", item.path, "「in」只收兩個參數");
      }
    }
    return result;
  }

  /** `if`:條件可以判 ID 的空或真假;回傳分支傳播 ID 語意,ID 分支不能混入非空的寫死值。 */
  private visitIf(args: readonly Argument[]): number {
    const isBranch = (index: number): boolean =>
      index % 2 === 1 || (index === args.length - 1 && args.length % 2 === 1);
    const branches = args.filter((_, index) => isBranch(index));
    const union = branches.reduce((all, item) => all | item.origins, 0);
    if (hasIdOrigin(union)) {
      for (const branch of branches) {
        if ((branch.origins & ORIGIN.fixed) !== 0) {
          this.report(
            "ID_FIXED_MIX",
            branch.path,
            "「if」的分支會回傳 ID,這個分支不能是寫死的非空值",
          );
        }
      }
    }
    return union;
  }

  private report(code: IdFindingCode, path: string, detail: string): void {
    if (
      !this.findings.some(
        (finding) => finding.code === code && finding.path === path,
      )
    ) {
      this.findings.push({ code, path, detail });
    }
  }
}

/**
 * 推一個表達式的值來源並列出違反 ID 規則的位置。呼叫前先確認 `scanExpression(expr).issues` 為空
 * (形狀不合法的樹這裡不保證走得完)。
 */
export function analyzeIdFlow(expr: Expression, scope: IdScope): IdFlow {
  const analyzer = new IdFlowAnalyzer(scope);
  const origins = analyzer.visit(expr, "");
  return { origins, findings: analyzer.findings };
}
