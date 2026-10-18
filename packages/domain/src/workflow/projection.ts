import { type StepEvaluation, evaluateStep } from "./evaluate";
import { stepOf } from "./graph";
import {
  type InstanceSnapshot,
  type PlanItem,
  type StepState,
  type TaskProjection,
  type TaskSnapshot,
  type WorkflowDefinition,
  isReviewStep,
  isTerminalInstanceStatus,
} from "./types";

/**
 * 任務投影規則(唯一一套,終局收尾也用它)。任務文件只是投影,
 * 一律從權威資料(實例的 `plan` + `decisions` + `outcome` + 關卡 / 實例狀態)重建,
 * 由上往下第一個成立:
 *
 * 1. 該 `taskKey` 的決定是 `evaluateStep` 的有效結果之一,且若是駁回 / 退回則等於 `outcome` 那筆
 *    → `approved` / `rejected` / `returned`(抄 `decidedAt` / `comment`)
 * 2. 有決定但不符 1(`any` 的第二筆之後、`all` 終局後才到的、被 `outcome` 排除的其他分支駁回 / 退回)→ `late`
 * 3. 沒決定且該關已 `completed` / `skipped` / `terminated`、或實例已終局 → `cancelled`
 * 4. 計畫項目 `assigneeState = invalid` → `blocked`
 * 5. 其餘 → `pending`
 *
 * `assigneeId` / `previousAssigneeIds` 一律照 `plan`。
 */
export function projectTask(
  instance: Pick<InstanceSnapshot, "status" | "outcome" | "history">,
  step: StepState,
  evaluation: StepEvaluation,
  item: PlanItem,
): TaskProjection {
  const base = {
    assigneeId: item.assigneeId,
    previousAssigneeIds: [...item.previousAssigneeIds],
  };
  const decision = step.decisions.find(
    (candidate) => candidate.taskKey === item.taskKey,
  );
  if (decision !== undefined) {
    const isEffective =
      evaluation.effectiveTaskKeys.has(item.taskKey) &&
      (decision.decision === "approved" ||
        (instance.outcome !== null &&
          instance.outcome.taskKey === item.taskKey &&
          instance.outcome.stepKey === step.stepKey));
    return {
      ...base,
      status: isEffective ? decision.decision : "late",
      decidedAt: decision.at,
      comment: decision.comment,
    };
  }
  const isClosed =
    step.status === "completed" ||
    step.status === "skipped" ||
    step.status === "terminated" ||
    isTerminalInstanceStatus(instance.status);
  if (isClosed) {
    return { ...base, status: "cancelled", decidedAt: null, comment: null };
  }
  if (item.assigneeState === "invalid") {
    return { ...base, status: "blocked", decidedAt: null, comment: null };
  }
  return { ...base, status: "pending", decidedAt: null, comment: null };
}

/** 一關的評估(匯合節點沒有決定,當 `any` 評估結果也是空的)。 */
export function evaluationOf(
  definition: WorkflowDefinition,
  instance: Pick<InstanceSnapshot, "history">,
  step: StepState,
): StepEvaluation {
  const stepDef = stepOf(definition, step.stepKey);
  const mode =
    stepDef !== undefined && isReviewStep(stepDef) ? stepDef.mode : "any";
  return evaluateStep(mode, step, instance.history);
}

/** 實例裡每個計畫項目該有的任務投影(以 `taskKey` 為鍵)。 */
export function projectAllTasks(
  definition: WorkflowDefinition,
  instance: Pick<InstanceSnapshot, "status" | "outcome" | "history" | "steps">,
): Map<string, { stepKey: string; projection: TaskProjection }> {
  const result = new Map<
    string,
    { stepKey: string; projection: TaskProjection }
  >();
  for (const step of instance.steps) {
    const evaluation = evaluationOf(definition, instance, step);
    for (const item of step.plan) {
      result.set(item.taskKey, {
        stepKey: step.stepKey,
        projection: projectTask(instance, step, evaluation, item),
      });
    }
  }
  return result;
}

/** 任務文件與投影是否一致(狀態、承辦人、曾經的承辦人、決定時間與意見)。 */
export function isProjectionInSync(
  task: TaskSnapshot,
  projection: TaskProjection,
): boolean {
  return (
    task.status === projection.status &&
    task.assigneeId === projection.assigneeId &&
    sameIds(task.previousAssigneeIds, projection.previousAssigneeIds) &&
    sameTime(task.decidedAt, projection.decidedAt) &&
    (task.comment ?? null) === (projection.comment ?? null)
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameTime(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.getTime() === right.getTime();
}
