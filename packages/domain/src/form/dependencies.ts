import { arrayColumnsOf, columnPathOf } from "./array";
import { COLLATION_LOCALE } from "./collation";
import { referencedFieldKeys, scanExpression } from "./expression-shape";
import type { ArrayColumnDef, Expression, FieldDef } from "./types";

/**
 * 欄位之間的依賴:計算順序(拓樸排序)與受保護依賴鏈(見 `docs/concepts/form-engine.md`「欄位級權限與受保護依賴鏈」)。
 *
 * 依賴圖的節點 = 表單層欄位 + 每個明細子欄(`items.subtotal`);列內公式引用表單層欄位、彙總引用子欄都是邊。
 */

/**
 * 計算欄位的公式引用到哪些**表單層**欄位(彙總算引用明細欄);非計算欄位回空陣列。
 * 明細欄 = 它所有列內公式引用到的表單層欄位(子欄的 `row.*` 不算)—— 所以任一子欄直接或間接引用受保護欄位,
 * 整個明細欄就沿依賴鏈受保護(整欄傳遞),彙總引用它的計算欄位也跟著受保護。
 */
export function computedDependenciesOf(field: FieldDef): string[] {
  if (field.type === "array") {
    const keys = new Set<string>();
    for (const column of arrayColumnsOf(field)) {
      if (column.valueSource.kind === "computed") {
        for (const key of referencedFieldKeys(column.valueSource.expr)) {
          keys.add(key);
        }
      }
    }
    return [...keys];
  }
  return field.valueSource.kind === "computed"
    ? referencedFieldKeys(field.valueSource.expr)
    : [];
}

/**
 * 一個表達式在依賴圖上引用到的節點:表單層欄位 = 它的 key;彙總 `sumOf(items, x)` = `items.x`、
 * `countOf(items)` = `items`(依賴明細欄本身,增刪列即重算);列內公式的 `row.x` = `<所在明細>.x`
 * (`arrayKey` 不給 = 不在明細裡,`row.*` 略過,由檢查器報錯)。
 */
export function expressionNodeRefs(
  expr: Expression,
  arrayKey?: string,
): string[] {
  const scan = scanExpression(expr);
  const nodes = new Set<string>();
  for (const ref of scan.refs) {
    if (ref.via !== "aggregate") {
      nodes.add(ref.fieldKey);
    }
  }
  for (const aggregate of scan.aggregates) {
    nodes.add(
      aggregate.columnKey === null
        ? aggregate.arrayKey
        : columnPathOf(aggregate.arrayKey, aggregate.columnKey),
    );
  }
  if (arrayKey !== undefined) {
    for (const rowRef of scan.rowRefs) {
      nodes.add(columnPathOf(arrayKey, rowRef.columnKey));
    }
  }
  return [...nodes];
}

/** 計算的一個節點:表單層計算欄位,或某明細欄的一個列內公式子欄(每一列都算)。 */
export type ComputeNode =
  | { kind: "field"; id: string; field: FieldDef }
  | { kind: "column"; id: string; field: FieldDef; column: ArrayColumnDef };

function computeNodesOf(fields: readonly FieldDef[]): Map<string, ComputeNode> {
  const nodes = new Map<string, ComputeNode>();
  for (const field of fields) {
    if (field.valueSource.kind === "computed") {
      nodes.set(field.key, { kind: "field", id: field.key, field });
    }
    for (const column of arrayColumnsOf(field)) {
      if (column.valueSource.kind === "computed") {
        const id = columnPathOf(field.key, column.key);
        nodes.set(id, { kind: "column", id, field, column });
      }
    }
  }
  return nodes;
}

function nodeExpressionOf(node: ComputeNode): Expression {
  const source =
    node.kind === "field" ? node.field.valueSource : node.column.valueSource;
  return source.kind === "computed" ? source.expr : null;
}

/** 公式引用成圈時丟出;檢查器會先以 `EXPR_CYCLE` 擋下,正常流程走不到。 */
export class ComputedCycleError extends Error {
  override name = "ComputedCycleError";
}

/**
 * 計算節點的求值順序(**完整依賴圖**,不固定列內 / 彙總 / 表單層先後):被引用的節點排在引用它的前面
 * (引用非計算節點不影響順序;例:`discountRate → items.subtotal → total`)。成圈 → `ComputedCycleError`。
 */
export function computeOrder(fields: readonly FieldDef[]): ComputeNode[] {
  const nodes = computeNodesOf(fields);
  const ordered: ComputeNode[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: ComputeNode, trail: string[]): void => {
    const current = state.get(node.id);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      throw new ComputedCycleError(
        `計算欄位循環引用:${[...trail, node.id].join(" → ")}`,
      );
    }
    state.set(node.id, "visiting");
    const arrayKey = node.kind === "column" ? node.field.key : undefined;
    for (const id of expressionNodeRefs(nodeExpressionOf(node), arrayKey)) {
      const dependency = nodes.get(id);
      if (dependency) {
        visit(dependency, [...trail, node.id]);
      }
    }
    state.set(node.id, "done");
    ordered.push(node);
  };
  for (const node of nodes.values()) {
    visit(node, []);
  }
  return ordered;
}

/** 表單層計算欄位的求值順序(`computeOrder` 只取表單層的節點)。成圈 → `ComputedCycleError`。 */
export function computedOrder(fields: readonly FieldDef[]): FieldDef[] {
  return computeOrder(fields).flatMap((node) =>
    node.kind === "field" ? [node.field] : [],
  );
}

/**
 * 一個欄位的受保護資訊:
 * - `self`:自己設了 `permission.show`
 * - `via`:沿計算依賴鏈(遞迴)引用到的、**自己設了 show** 的欄位 key
 *
 * 讀得到某欄位 = 它自己的 show(若 `self`)且 `via` 每一個的 show 都有。
 */
export interface FieldProtection {
  self: boolean;
  via: string[];
}

export function isProtected(protection: FieldProtection | undefined): boolean {
  return (
    protection !== undefined && (protection.self || protection.via.length > 0)
  );
}

/**
 * 每個欄位的受保護資訊。例:`total = unit_price × qty`、`total_tax = total × 1.05`,
 * `unit_price` 受保護 → `total.via = ["unit_price"]`、`total_tax.via = ["unit_price"]`;
 * `total_tax` 自己也設 show → `total_tax.self = true`。
 * 引用成圈時,圈上的依賴只走一次(不會無窮遞迴;成圈本身由檢查器報錯)。
 */
export function fieldProtections(
  fields: readonly FieldDef[],
): Map<string, FieldProtection> {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const memo = new Map<string, Set<string>>();

  const viaOf = (field: FieldDef, visiting: Set<string>): Set<string> => {
    const cached = memo.get(field.key);
    if (cached) {
      return cached;
    }
    const via = new Set<string>();
    visiting.add(field.key);
    for (const key of computedDependenciesOf(field)) {
      const dependency = byKey.get(key);
      if (!dependency || visiting.has(key)) {
        continue;
      }
      if (dependency.permission?.show === true) {
        via.add(key);
      }
      for (const inherited of viaOf(dependency, visiting)) {
        via.add(inherited);
      }
    }
    visiting.delete(field.key);
    memo.set(field.key, via);
    return via;
  };

  const result = new Map<string, FieldProtection>();
  for (const field of fields) {
    const via = [...viaOf(field, new Set())].filter((key) => key !== field.key);
    result.set(field.key, {
      self: field.permission?.show === true,
      via: via.toSorted((left, right) =>
        left.localeCompare(right, COLLATION_LOCALE),
      ),
    });
  }
  return result;
}

/**
 * 讀取某欄位需要哪些欄位的 `show` 權限(自己若設 show 也算);空陣列 = 公開欄位。
 * 欄位不存在回空陣列。
 */
export function requiredShowFieldsFor(
  fields: readonly FieldDef[],
  fieldKey: string,
): string[] {
  const protection = fieldProtections(fields).get(fieldKey);
  if (!protection) {
    return [];
  }
  return protection.self ? [fieldKey, ...protection.via] : protection.via;
}
