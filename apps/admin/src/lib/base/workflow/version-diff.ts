import type { WorkflowDefinition } from "@repo/domain/workflow";

/** 與上一版的差異(版本面板;同表單的「以 key 比對」)。 */
export interface WorkflowVersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** 連線(分流 / 匯合的結構)有沒有變 */
  isStructureChanged: boolean;
}

const edgeIds = (definition: WorkflowDefinition): string[] =>
  (definition.edges ?? []).map((edge) => `${edge.from}->${edge.to}`).toSorted();

/**
 * 以關卡 key 比對兩版定義:新增 / 移除 / 內容有變(名稱、來源、會簽、跳過條件、可否退回);
 * 連線另外比一次(直線 ↔ 分流、分支增減)。回的是關卡**名稱**(找不到才用 key)。
 */
export const workflowVersionDiff = (
  before: WorkflowDefinition,
  after: WorkflowDefinition,
): WorkflowVersionDiff => {
  const beforeByKey = new Map(before.steps.map((step) => [step.key, step]));
  const afterByKey = new Map(after.steps.map((step) => [step.key, step]));
  return {
    added: after.steps
      .filter((step) => !beforeByKey.has(step.key))
      .map((step) => step.name),
    removed: before.steps
      .filter((step) => !afterByKey.has(step.key))
      .map((step) => step.name),
    changed: after.steps
      .filter((step) => {
        const previous = beforeByKey.get(step.key);
        return (
          previous !== undefined &&
          JSON.stringify(previous) !== JSON.stringify(step)
        );
      })
      .map((step) => step.name),
    isStructureChanged:
      JSON.stringify(edgeIds(before)) !== JSON.stringify(edgeIds(after)),
  };
};
