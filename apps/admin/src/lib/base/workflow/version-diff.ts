import type { WorkflowDefinition } from "@repo/domain/workflow";

import { canonical } from "./flow-model";

/** 整個流程的知會對象(`definition.cc`)怎麼變:新增 / 移除 / 修改;沒變 = null。 */
export type FlowCcChange = "added" | "removed" | "changed";

/** 與上一版的差異(版本面板;同表單的「以 key 比對」)。 */
export interface WorkflowVersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** 連線(分流 / 匯合的結構)有沒有變 */
  isStructureChanged: boolean;
  /** 整個流程的知會對象有沒有變(鍵順序不同、`null` 與沒設都算沒變) */
  flowCcChange: FlowCcChange | null;
}

const edgeIds = (definition: WorkflowDefinition): string[] =>
  (definition.edges ?? []).map((edge) => `${edge.from}->${edge.to}`).toSorted();

/** 內容相同(鍵順序不同、`null` 與缺鍵都算相同;見 `canonical`)。 */
const isSameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const flowCcChangeOf = (
  before: WorkflowDefinition,
  after: WorkflowDefinition,
): FlowCcChange | null => {
  const previous = before.cc ?? null;
  const next = after.cc ?? null;
  if (previous === null) {
    return next === null ? null : "added";
  }
  if (next === null) {
    return "removed";
  }
  return isSameJson(previous, next) ? null : "changed";
};

/**
 * 以關卡 key 比對兩版定義(內容以 `canonical` 比,鍵順序與 `null` / 缺鍵不算變更):新增 / 移除 / 內容有變(名稱、來源、會簽、跳過、自動通過、逾時提醒、知會…);
 * 連線另外比一次(直線 ↔ 分流、分支增減);整個流程的知會對象也比(新增 / 移除 / 修改)。
 * 回的是關卡**名稱**(找不到才用 key)。
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
        return previous !== undefined && !isSameJson(previous, step);
      })
      .map((step) => step.name),
    isStructureChanged:
      JSON.stringify(edgeIds(before)) !== JSON.stringify(edgeIds(after)),
    flowCcChange: flowCcChangeOf(before, after),
  };
};
