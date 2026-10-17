import { arrayColumnsOf, columnPathOf } from "./array";
import { COLLATION_LOCALE } from "./collation";
import {
  type FieldProtection,
  expressionNodeRefs,
  isProtected,
} from "./dependencies";
import { evaluateCondition } from "./expression";
import {
  type ExpressionAggregateRef,
  type ExpressionScan,
  type ExpressionShapeProblem,
  scanExpression,
} from "./expression-shape";
import type {
  DefinitionErrorCode,
  DefinitionIssueLocation,
  ExpressionSlot,
  IssueCollector,
} from "./issues";
import type { ArrayColumnDef, Expression, FieldDef } from "./types";

/**
 * 檢查器的表達式段(Spec §5「定義檢查器」表達式一列):形狀、引用、循環(含跨類型)、
 * `visibleWhen` 自我引用、條件引用受保護欄位,以及「顯示條件恆為 false 卻必填」。
 */

const SHAPE_CODES: Record<ExpressionShapeProblem, DefinitionErrorCode> = {
  UNKNOWN_OPERATOR: "EXPR_UNKNOWN_OPERATOR",
  INVALID_NODE: "EXPR_INVALID",
  INVALID_VAR: "EXPR_INVALID_VAR",
  TOO_DEEP: "EXPR_TOO_DEEP",
  TOO_MANY_NODES: "EXPR_TOO_MANY_NODES",
};

/** 條件類表達式:v1 禁止引用受保護欄位(「某欄有沒有出現」會洩漏它的值)。 */
const CONDITION_SLOTS = new Set<ExpressionSlot>([
  "visibleWhen",
  "readonlyWhen",
  "rules.custom",
]);

interface SlotExpression {
  slot: ExpressionSlot;
  expr: Expression;
}

/** 欄位上所有有值的表達式(null / undefined = 沒設;預設值只算公式)。 */
export function expressionsOf(field: FieldDef): SlotExpression[] {
  const slots: SlotExpression[] = [];
  if (field.valueSource.kind === "computed") {
    slots.push({ slot: "valueSource.expr", expr: field.valueSource.expr });
  }
  if (
    field.default?.kind === "expression" &&
    // 定義來自設計器送來的 JSON,型別保證不了公式一定在
    (field.default as { expr?: unknown }).expr !== undefined
  ) {
    slots.push({ slot: "default.expr", expr: field.default.expr });
  }
  const optional: [ExpressionSlot, Expression | undefined][] = [
    ["visibleWhen", field.visibleWhen],
    ["readonlyWhen", field.readonlyWhen],
    ["rules.custom", field.rules?.custom],
  ];
  for (const [slot, expr] of optional) {
    if (expr !== undefined && expr !== null) {
      slots.push({ slot, expr });
    }
  }
  return slots;
}

export function validateExpressions(
  fields: readonly FieldDef[],
  protections: ReadonlyMap<string, FieldProtection>,
  collector: IssueCollector,
): void {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const field of fields) {
    if (
      field.valueSource.kind === "computed" &&
      // 定義來自設計器送來的 JSON,型別保證不了公式一定在
      (field.valueSource as { expr?: unknown }).expr === undefined
    ) {
      collector.error("EXPR_MISSING", `計算欄位「${field.label}」沒有公式`, {
        fieldKey: field.key,
        exprSlot: "valueSource.expr",
      });
    }
    for (const { slot, expr } of expressionsOf(field)) {
      validateOne(field, slot, expr, byKey, protections, collector);
    }
    for (const column of arrayColumnsOf(field)) {
      const source = column.valueSource as { kind?: unknown; expr?: unknown };
      if (source.kind === "computed" && source.expr !== undefined) {
        validateColumnExpression(
          field,
          column,
          source.expr as Expression,
          byKey,
          collector,
        );
      }
    }
    validateRequiredVisibility(field, collector);
  }
  validateCycles(fields, collector);
}

/** 形狀問題、`var` 整個明細欄、彙總的參數:表單層與列內公式共用。 */
function validateCommon(
  label: string,
  scan: ExpressionScan,
  location: DefinitionIssueLocation,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  for (const issue of scan.issues) {
    collector.error(SHAPE_CODES[issue.problem], issue.detail, {
      ...location,
      exprPath: issue.path,
    });
  }
  for (const ref of scan.refs) {
    if (ref.via === "var" && byKey.get(ref.fieldKey)?.type === "array") {
      collector.error(
        "EXPR_ARRAY_REF",
        `「${label}」的表達式不能直接引用明細欄 ${ref.fieldKey}(請用彙總:加總 / 筆數 / 最小 / 最大 / 平均)`,
        { ...location, exprPath: ref.path },
      );
    }
  }
  for (const aggregate of scan.aggregates) {
    validateAggregate(label, aggregate, location, byKey, collector);
  }
}

/**
 * 彙總的參數:第一個必須是明細欄;`sumOf` / `minOf` / `maxOf` / `avgOf` 的第二個必須是該明細的 `number` 子欄
 * (`countOf` 只驗明細欄)。明細欄 key 不存在由引用檢查報。
 */
function validateAggregate(
  label: string,
  aggregate: ExpressionAggregateRef,
  location: DefinitionIssueLocation,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  const target = byKey.get(aggregate.arrayKey);
  const at = { ...location, exprPath: aggregate.path };
  if (target === undefined) {
    return;
  }
  if (target.type !== "array") {
    collector.error(
      "EXPR_AGGREGATE_ARG",
      `「${label}」的彙總只能指明細欄(${aggregate.arrayKey} 不是明細欄)`,
      at,
    );
    return;
  }
  if (aggregate.columnKey === null) {
    return;
  }
  const column = arrayColumnsOf(target).find(
    (candidate) => candidate.key === aggregate.columnKey,
  );
  if (column === undefined) {
    collector.error(
      "EXPR_AGGREGATE_ARG",
      `「${label}」的彙總引用了明細「${target.label}」沒有的子欄位 ${aggregate.columnKey}`,
      at,
    );
  } else if (column.type !== "number") {
    collector.error(
      "EXPR_AGGREGATE_ARG",
      `「${label}」的彙總只能指數字子欄位(「${column.label}」不是數字)`,
      at,
    );
  }
}

/**
 * 列內公式(明細子欄的 `valueSource.expr`):`row.<子欄 key>` 必須是**同一個明細**的子欄;
 * 表單層欄位與 `ctx.*` 照一般規則;不能 `var` 整個明細(用彙總)。引用受保護欄位可以 —— 整個明細欄因此受保護。
 */
function validateColumnExpression(
  field: FieldDef,
  column: ArrayColumnDef,
  expr: Expression,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  const scan = scanExpression(expr);
  const location = {
    fieldKey: field.key,
    columnKey: column.key,
    exprSlot: "valueSource.expr" as const,
  };
  validateCommon(column.label, scan, location, byKey, collector);
  const columnKeys = new Set(arrayColumnsOf(field).map((item) => item.key));
  for (const rowRef of scan.rowRefs) {
    if (!columnKeys.has(rowRef.columnKey)) {
      collector.error(
        "EXPR_ROW_OUT_OF_SCOPE",
        `子欄位「${column.label}」的公式引用了這個明細沒有的子欄位 ${rowRef.columnKey}`,
        { ...location, exprPath: rowRef.path },
      );
    }
  }
  for (const ref of scan.refs) {
    if (!byKey.has(ref.fieldKey)) {
      collector.error(
        "EXPR_UNKNOWN_FIELD",
        `子欄位「${column.label}」的公式引用了不存在的欄位 ${ref.fieldKey}`,
        { ...location, exprPath: ref.path },
      );
    }
  }
}

function validateOne(
  field: FieldDef,
  slot: ExpressionSlot,
  expr: Expression,
  byKey: ReadonlyMap<string, FieldDef>,
  protections: ReadonlyMap<string, FieldProtection>,
  collector: IssueCollector,
): void {
  const scan = scanExpression(expr);
  validateCommon(
    field.label,
    scan,
    { fieldKey: field.key, exprSlot: slot },
    byKey,
    collector,
  );
  for (const rowRef of scan.rowRefs) {
    collector.error(
      "EXPR_ROW_OUT_OF_SCOPE",
      `「${field.label}」的表達式不能用 row.${rowRef.columnKey}(只有明細子欄的列內公式可以)`,
      { fieldKey: field.key, exprSlot: slot, exprPath: rowRef.path },
    );
  }
  for (const ref of scan.refs) {
    const location = {
      fieldKey: field.key,
      exprSlot: slot,
      exprPath: ref.path,
    };
    if (!byKey.has(ref.fieldKey)) {
      collector.error(
        "EXPR_UNKNOWN_FIELD",
        `「${field.label}」的表達式引用了不存在的欄位 ${ref.fieldKey}`,
        location,
      );
      continue;
    }
    if (slot === "visibleWhen" && ref.fieldKey === field.key) {
      collector.error(
        "EXPR_VISIBLE_SELF",
        `「${field.label}」的顯示條件不可引用自己`,
        location,
      );
    }
    if (slot === "default.expr" && ref.fieldKey === field.key) {
      collector.error(
        "DEFAULT_SELF",
        `「${field.label}」的預設值公式不可引用自己`,
        location,
      );
    }
    if (
      CONDITION_SLOTS.has(slot) &&
      isProtected(protections.get(ref.fieldKey))
    ) {
      collector.error(
        "EXPR_PROTECTED_REF",
        `「${field.label}」的條件不可引用受保護欄位 ${ref.fieldKey}(含因引用受保護欄位而受保護的計算欄位)`,
        location,
      );
    }
  }
}

/** 顯示條件恆為 false(不看任何欄位與上下文、算出來為假)卻必填 → 永遠送不出去。 */
function validateRequiredVisibility(
  field: FieldDef,
  collector: IssueCollector,
): void {
  const expr = field.visibleWhen;
  if (field.rules?.required !== true || expr === undefined || expr === null) {
    return;
  }
  const scan = scanExpression(expr);
  if (scan.issues.length > 0 || scan.refs.length > 0 || scan.usesContext) {
    return;
  }
  const isVisible = evaluateCondition(expr, {
    values: {},
    ctx: {
      now: "",
      timezone: "UTC",
      user: { id: null, orgId: null, orgIds: [] },
      tenant: { id: null },
    },
  });
  if (!isVisible) {
    collector.error(
      "REQUIRED_ALWAYS_HIDDEN",
      `「${field.label}」的顯示條件恆為 false,卻設為必填`,
      { fieldKey: field.key, exprSlot: "visibleWhen" },
    );
  }
}

/**
 * 循環(含跨類型):欄位 A 的值依賴它的公式、預設值公式(沒碰過前跟著重算)、顯示條件(隱藏即清空)
 * 與唯讀條件(唯讀即保留舊值)引用到的欄位。這四種邊合成一張圖,任何圈都是錯誤 — 例如「計算欄位
 * total 引用 qty、qty 的顯示條件又引用 total」。自我引用:公式引用自己算循環;顯示條件引用自己另報
 * `EXPR_VISIBLE_SELF`、預設值引用自己另報 `DEFAULT_SELF`;唯讀條件引用自己(「超過 5 就鎖住」)
 * 是合理用法,不算。
 *
 * 明細列:節點另有每個子欄(`items.subtotal`),邊 = 列內公式引用的子欄(`row.*`)與表單層欄位,再加上
 * 「子欄 → 所屬明細」(明細隱藏即整欄清空);彙總 `sumOf(items, x)` 指向 `items.x`、`countOf(items)` 指向
 * `items`。例:`total = sumOf(items, subtotal)` 且 `items.subtotal = row.qty × total` 是循環。
 */
/** 表單層欄位的邊:公式、預設值、顯示 / 唯讀條件引用到的節點(自我引用只有公式算)。 */
function fieldEdgesOf(field: FieldDef, keys: ReadonlySet<string>): string[] {
  const targets = new Set<string>();
  for (const { slot, expr } of expressionsOf(field)) {
    if (slot === "rules.custom") {
      continue;
    }
    for (const node of expressionNodeRefs(expr)) {
      const isSelf = node === field.key;
      if (
        keys.has(baseKeyOf(node)) &&
        (!isSelf || slot === "valueSource.expr")
      ) {
        targets.add(node);
      }
    }
  }
  return [...targets];
}

/** 子欄節點的邊:所屬明細 + 列內公式引用到的節點。 */
function columnEdgesOf(
  field: FieldDef,
  column: ArrayColumnDef,
  keys: ReadonlySet<string>,
): string[] {
  const targets = new Set<string>([field.key]);
  const source = column.valueSource as { kind?: unknown; expr?: unknown };
  if (source.kind !== "computed" || source.expr === undefined) {
    return [...targets];
  }
  for (const node of expressionNodeRefs(source.expr as Expression, field.key)) {
    if (keys.has(baseKeyOf(node))) {
      targets.add(node);
    }
  }
  return [...targets];
}

function validateCycles(
  fields: readonly FieldDef[],
  collector: IssueCollector,
): void {
  const edges = new Map<string, string[]>();
  const keys = new Set(fields.map((field) => field.key));
  for (const field of fields) {
    edges.set(field.key, fieldEdgesOf(field, keys));
    for (const column of arrayColumnsOf(field)) {
      edges.set(
        columnPathOf(field.key, column.key),
        columnEdgesOf(field, column, keys),
      );
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();
  const visit = (key: string, trail: string[]): void => {
    if (state.get(key) === "done") {
      return;
    }
    if (state.get(key) === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(key)), key];
      const signature = cycle
        .slice(0, -1)
        .toSorted((left, right) => left.localeCompare(right, COLLATION_LOCALE))
        .join(",");
      if (!reported.has(signature)) {
        reported.add(signature);
        collector.error(
          "EXPR_CYCLE",
          `欄位之間循環引用:${cycle.join(" → ")}`,
          nodeLocationOf(key),
        );
      }
      return;
    }
    state.set(key, "visiting");
    for (const next of edges.get(key) ?? []) {
      visit(next, [...trail, key]);
    }
    state.set(key, "done");
  };
  for (const id of edges.keys()) {
    visit(id, []);
  }
}

/** 依賴圖節點 id(`key` 或 `items.subtotal`)→ 錯誤定位。 */
function nodeLocationOf(id: string): DefinitionIssueLocation {
  const dot = id.indexOf(".");
  return dot === -1
    ? { fieldKey: id }
    : { fieldKey: id.slice(0, dot), columnKey: id.slice(dot + 1) };
}

/** 節點 id 的表單層欄位 key(`items.subtotal` → `items`)。 */
function baseKeyOf(id: string): string {
  return id.split(".", 1)[0] ?? id;
}
