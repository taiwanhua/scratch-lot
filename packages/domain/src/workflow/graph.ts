import type { StepDef, WorkflowDefinition, WorkflowEdge } from "./types";

/**
 * 流程的圖形查詢:起點、終點、後繼、前驅。
 * 直線(沒有 `edges`)以 `steps[]` 的順序為準;有 `edges` 才看連線。
 * 這些函式**假設定義已過結構檢查**(`validateWorkflowDefinition`);不合法的定義只保證不丟錯。
 */

/** 有 `edges`(非空)才是圖;沒有或空陣列 = 直線。 */
export function hasEdges(
  definition: WorkflowDefinition,
): definition is WorkflowDefinition & { edges: WorkflowEdge[] } {
  return Array.isArray(definition.edges) && definition.edges.length > 0;
}

export function stepOf(
  definition: WorkflowDefinition,
  stepKey: string,
): StepDef | undefined {
  return definition.steps.find((step) => step.key === stepKey);
}

/**
 * 起點:沒有 `edges` → `steps[0]`;有 `edges` → 唯一沒有入線的節點(與陣列順序無關)。
 * 沒有節點、或圖裡找不到唯一起點 → null。
 */
export function startStepKey(definition: WorkflowDefinition): string | null {
  if (!hasEdges(definition)) {
    return definition.steps[0]?.key ?? null;
  }
  const targets = new Set(definition.edges.map((edge) => edge.to));
  const starts = definition.steps.filter((step) => !targets.has(step.key));
  return starts.length === 1 ? (starts[0]?.key ?? null) : null;
}

/**
 * 終點:沒有 `edges` → 最後一關;有 `edges` → 唯一沒有出線的節點。找不到唯一終點 → null。
 */
export function endStepKey(definition: WorkflowDefinition): string | null {
  if (!hasEdges(definition)) {
    return definition.steps.at(-1)?.key ?? null;
  }
  const sources = new Set(definition.edges.map((edge) => edge.from));
  const ends = definition.steps.filter((step) => !sources.has(step.key));
  return ends.length === 1 ? (ends[0]?.key ?? null) : null;
}

/**
 * 下一關:有 `edges` → 該關所有出線的目標(依連線順序、去重);
 * 沒有 → 陣列順序的下一個(0 或 1 個)。
 */
export function nextStepKeys(
  definition: WorkflowDefinition,
  stepKey: string,
): string[] {
  if (hasEdges(definition)) {
    return [
      ...new Set(
        definition.edges
          .filter((edge) => edge.from === stepKey)
          .map((edge) => edge.to),
      ),
    ];
  }
  const index = definition.steps.findIndex((step) => step.key === stepKey);
  const next = index === -1 ? undefined : definition.steps[index + 1];
  return next ? [next.key] : [];
}

/** 前驅(入線來源):有 `edges` → 所有入線的來源;沒有 → 陣列順序的上一個(0 或 1 個)。 */
export function previousStepKeys(
  definition: WorkflowDefinition,
  stepKey: string,
): string[] {
  if (hasEdges(definition)) {
    return [
      ...new Set(
        definition.edges
          .filter((edge) => edge.to === stepKey)
          .map((edge) => edge.from),
      ),
    ];
  }
  const index = definition.steps.findIndex((step) => step.key === stepKey);
  const previous = index <= 0 ? undefined : definition.steps[index - 1];
  return previous ? [previous.key] : [];
}
