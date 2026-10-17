import { Types } from "mongoose";

import type {
  AcceptedDecision,
  HistoryEvent,
  HistoryReason,
  InstanceCondition,
  InstanceSnapshot,
  InstanceUpdate,
  NotifiedResult,
  PlanItem,
  StepState,
  StepUpdate,
  SubmissionSnapshot,
  TaskProjection,
  TaskSnapshot,
} from "@repo/domain/workflow";

import type { Persisted } from "../../database/base.repository";
import type { WorkflowInstanceDocument } from "../../database/database.module";
import type { WorkflowSubmissionStore } from "../../database/workflow-submission-store";
import type { WorkflowTaskRecord } from "../../database/workflow-tasks.repository";

/**
 * 引擎在「domain 的純資料形狀」與「Mongo 文件 / 條件 / 更新」之間的翻譯(Spec 6b §6;
 * domain 端的動作合約見 `@repo/domain/workflow` 的 `advance.ts` 檔頭)。
 *
 * - 讀:實例 / 任務 / 提交文件 → `InstanceSnapshot` / `TaskSnapshot` / `SubmissionSnapshot`(id 一律轉字串)
 * - 寫:`InstanceCondition` → Mongo 條件(節點狀態以 `$elemMatch` 對陣列元素下條件);
 *   `InstanceUpdate` → `$set` / `$push` / `$inc`,節點欄位以 `arrayFilters` 指到 `stepKey`
 */

export type InstanceRecord = Persisted<WorkflowInstanceDocument>;

type SubmissionDocument = NonNullable<
  Awaited<ReturnType<WorkflowSubmissionStore["findById"]>>
>;

type IdLike = Types.ObjectId | string;

function idOf(value: IdLike | null): string {
  return value === null ? "" : value.toString();
}

function nullableId(value: IdLike | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

/** 字串 id → ObjectId(落庫前;不合法的 id 原樣交給 Mongoose 丟錯)。 */
export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function planItemOf(item: {
  taskKey: string;
  assigneeId: IdLike;
  previousAssigneeIds: readonly IdLike[];
  assigneeState: PlanItem["assigneeState"];
  delegatorIds?: readonly IdLike[] | null;
}): PlanItem {
  const delegatorIds = (item.delegatorIds ?? []).map((id) => idOf(id));
  return {
    taskKey: item.taskKey,
    assigneeId: idOf(item.assigneeId),
    previousAssigneeIds: item.previousAssigneeIds.map((id) => idOf(id)),
    assigneeState: item.assigneeState,
    ...(delegatorIds.length > 0 && { delegatorIds }),
  };
}

function decisionOf(decision: {
  taskKey: string;
  userId: IdLike;
  decision: AcceptedDecision["decision"];
  comment: string | null;
  at: Date;
}): AcceptedDecision {
  return {
    taskKey: decision.taskKey,
    userId: idOf(decision.userId),
    decision: decision.decision,
    comment: decision.comment ?? null,
    at: decision.at,
  };
}

export function historyEventOf(event: {
  at: Date;
  kind: HistoryEvent["kind"];
  stepKey?: string | null;
  taskKey?: string | null;
  userId?: IdLike | null;
  toUserId?: IdLike | null;
  comment?: string | null;
  result?: NotifiedResult | null;
  reason?: HistoryReason | null;
  code?: string | null;
  delegatorIds?: readonly IdLike[] | null;
}): HistoryEvent {
  const delegatorIds = (event.delegatorIds ?? []).map((id) => idOf(id));
  return {
    at: event.at,
    kind: event.kind,
    stepKey: event.stepKey ?? null,
    taskKey: event.taskKey ?? null,
    userId: nullableId(event.userId),
    toUserId: nullableId(event.toUserId),
    comment: event.comment ?? null,
    result: event.result ?? null,
    reason: event.reason ?? null,
    code: event.code ?? null,
    ...(delegatorIds.length > 0 && { delegatorIds }),
  };
}

/** 實例文件 → 推進要讀的形狀。 */
export function toInstanceSnapshot(record: InstanceRecord): InstanceSnapshot {
  return {
    id: idOf(record._id),
    status: record.status,
    createdBy: idOf(record.createdBy),
    submissionId: idOf(record.submissionId),
    revision: record.revision,
    activeStepKeys: [...record.activeStepKeys],
    steps: record.steps.map((step): StepState => ({
      stepKey: step.stepKey,
      status: step.status,
      blocked: step.blocked,
      plan: step.plan.map((item) => planItemOf(item)),
      decisions: step.decisions.map((decision) => decisionOf(decision)),
    })),
    editVersion: record.editVersion,
    outcome: record.outcome
      ? {
          kind: record.outcome.kind,
          stepKey: record.outcome.stepKey,
          taskKey: record.outcome.taskKey,
          historyIndex: record.outcome.historyIndex,
        }
      : null,
    history: record.history.map((event) => historyEventOf(event)),
    finishedAt: record.finishedAt,
  };
}

export function toTaskSnapshot(record: WorkflowTaskRecord): TaskSnapshot {
  return {
    stepKey: record.stepKey,
    taskKey: record.taskKey,
    status: record.status,
    assigneeId: idOf(record.assigneeId),
    previousAssigneeIds: record.previousAssigneeIds.map((id) => idOf(id)),
    decidedAt: record.decidedAt,
    comment: record.comment,
  };
}

export function toSubmissionSnapshot(
  record: SubmissionDocument | null,
): SubmissionSnapshot | null {
  if (record === null) {
    return null;
  }
  return {
    id: idOf(record._id),
    status: record.status,
    revision: record.revision,
    currentInstanceId: nullableId(record.currentInstanceId),
    blocked: record.blocked,
  };
}

// ---- 寫入:domain → Mongo ----

/** 歷程事件落庫形狀(id 轉 ObjectId)。 */
export function historyEventDocument(
  event: HistoryEvent,
): Record<string, unknown> {
  return {
    at: event.at,
    kind: event.kind,
    stepKey: event.stepKey ?? null,
    taskKey: event.taskKey ?? null,
    userId: event.userId ? toObjectId(event.userId) : null,
    toUserId: event.toUserId ? toObjectId(event.toUserId) : null,
    comment: event.comment ?? null,
    result: event.result ?? null,
    reason: event.reason ?? null,
    code: event.code ?? null,
    delegatorIds: (event.delegatorIds ?? []).map((id) => toObjectId(id)),
  };
}

/** 決定落庫形狀(id 轉 ObjectId)。 */
export function decisionDocument(
  decision: AcceptedDecision,
): Record<string, unknown> {
  return {
    taskKey: decision.taskKey,
    userId: toObjectId(decision.userId),
    decision: decision.decision,
    comment: decision.comment,
    at: decision.at,
  };
}

export function planItemDocument(item: PlanItem): Record<string, unknown> {
  return {
    taskKey: item.taskKey,
    assigneeId: toObjectId(item.assigneeId),
    previousAssigneeIds: item.previousAssigneeIds.map((id) => toObjectId(id)),
    assigneeState: item.assigneeState,
    delegatorIds: (item.delegatorIds ?? []).map((id) => toObjectId(id)),
  };
}

/** 任務投影落庫形狀。 */
export function taskProjectionDocument(
  projection: TaskProjection,
): Record<string, unknown> {
  return {
    status: projection.status,
    assigneeId: toObjectId(projection.assigneeId),
    previousAssigneeIds: projection.previousAssigneeIds.map((id) =>
      toObjectId(id),
    ),
    decidedAt: projection.decidedAt,
    comment: projection.comment,
  };
}

/** `InstanceCondition` → Mongo 條件(全部 AND)。 */
export function instanceFilterOf(
  instanceId: Types.ObjectId,
  condition: InstanceCondition,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [
    { _id: instanceId, status: { $in: [...condition.statusIn] } },
  ];
  if (condition.editVersion !== undefined) {
    clauses.push({ editVersion: condition.editVersion });
  }
  if (condition.outcomeIsNull === true) {
    clauses.push({ outcome: null });
  }
  if (condition.finishedAtIsNull === true) {
    clauses.push({ finishedAt: null });
  }
  for (const [stepKey, status] of Object.entries(condition.stepStatus ?? {})) {
    clauses.push({ steps: { $elemMatch: { stepKey, status } } });
  }
  if (condition.notActive !== undefined && condition.notActive.length > 0) {
    clauses.push({ activeStepKeys: { $nin: [...condition.notActive] } });
  }
  return clauses.length === 1 ? (clauses[0] ?? {}) : { $and: clauses };
}

/** 一個節點要改的欄位 → `$set` 的鍵值(`prefix` = `steps.$[sN]`)。 */
function stepSetOf(prefix: string, patch: StepUpdate): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    set[`${prefix}.status`] = patch.status;
  }
  if (patch.blocked !== undefined) {
    set[`${prefix}.blocked`] = patch.blocked;
  }
  if (patch.plan !== undefined) {
    set[`${prefix}.plan`] = patch.plan.map((item) => planItemDocument(item));
  }
  if (patch.decisions !== undefined) {
    set[`${prefix}.decisions`] = patch.decisions.map((decision) =>
      decisionDocument(decision),
    );
  }
  return set;
}

/** `InstanceUpdate` → Mongo 更新 + `arrayFilters`(每個被改的節點一個識別名 `s0`、`s1`…)。 */
export function instanceUpdateOf(update: InstanceUpdate): {
  update: Record<string, unknown>;
  arrayFilters: Record<string, unknown>[];
} {
  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  if (update.status !== undefined) {
    set.status = update.status;
  }
  if (update.activeStepKeys !== undefined) {
    set.activeStepKeys = [...update.activeStepKeys];
  }
  if (update.outcome !== undefined) {
    set.outcome = { ...update.outcome };
  }
  if (update.finishedAt !== undefined) {
    set.finishedAt = update.finishedAt;
  }
  for (const [index, [stepKey, patch]] of Object.entries(
    update.steps ?? {},
  ).entries()) {
    const name = `s${String(index)}`;
    arrayFilters.push({ [`${name}.stepKey`]: stepKey });
    Object.assign(set, stepSetOf(`steps.$[${name}]`, patch));
  }
  const document: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) {
    document.$set = set;
  }
  if (update.pushHistory !== undefined && update.pushHistory.length > 0) {
    document.$push = {
      history: {
        $each: update.pushHistory.map((event) => historyEventDocument(event)),
      },
    };
  }
  if (update.incEditVersion) {
    document.$inc = { editVersion: 1 };
  }
  return { update: document, arrayFilters };
}

/**
 * B15:計畫裡這一項代理的原審核者們(決定事件帶著,時間軸寫「由 X 代理 A、B」;逾時提醒第 1 級連他們一起提醒);
 * 沒有(或流程管理者改派後清空)→ 空陣列。
 */
export function delegatorIdsOf(
  instance: InstanceRecord,
  stepKey: string,
  taskKey: string,
): Types.ObjectId[] {
  const step = instance.steps.find((one) => one.stepKey === stepKey);
  const item = step?.plan.find((one) => one.taskKey === taskKey);
  return [...(item?.delegatorIds ?? [])];
}
