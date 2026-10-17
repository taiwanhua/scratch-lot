import { Injectable, Logger } from "@nestjs/common";
import { GraphQLError } from "graphql";
import type { Types } from "mongoose";

import {
  type Decision,
  LIVE_INSTANCE_STATUSES,
  allowsReturn,
  nextTaskKey,
  stepOf,
} from "@repo/domain/workflow";

import { AuditService } from "../../audit/audit.service";
import { WorkflowInstancesRepository } from "../../database/database.module";
import { TransactionService } from "../../database/transaction";
import { WorkflowSubmissionStore } from "../../database/workflow-submission-store";
import {
  type WorkflowTaskRecord,
  WorkflowTasksRepository,
} from "../../database/workflow-tasks.repository";
import {
  type FormOperatorFacts,
  toObjectId,
} from "../../forms/form-access.service";
import {
  WorkflowBatchApproveFailureEnum,
  WorkflowDecisionEnum,
} from "../models/workflow-instance.model";
import {
  TenantDirectoryService,
  systemContext,
} from "../tenant-directory.service";
import {
  workflowConflictError,
  workflowForbiddenError,
  workflowNotFoundError,
  workflowValidationError,
} from "../workflows-error";
import {
  type AddStepAssigneeInput,
  BATCH_APPROVE_LIMIT,
  type BatchApproveTasksInput,
  type DecideTaskInput,
  type ReassignTaskInput,
  type RetryAdvanceInstanceInput,
} from "./dto/workflow-engine.input";
import type { InstanceRecord } from "./instance-writes";
import {
  FormLifecycleService,
  LifecycleBlockedError,
} from "./lifecycle/form-lifecycle.service";
import {
  WorkflowEngineHooks,
  WorkflowEngineService,
} from "./workflow-engine.service";

/** 稽核動作名(`docs/modules/workflows.md`「稽核」)。 */
export const TASK_AUDIT = {
  decide: "task.decide",
  reassign: "task.reassign",
  addAssignee: "task.add-assignee",
  retryAdvance: "instance.retry-advance",
} as const;

const DECISION_OF: Readonly<Record<WorkflowDecisionEnum, Decision>> = {
  [WorkflowDecisionEnum.APPROVE]: "approved",
  [WorkflowDecisionEnum.REJECT]: "rejected",
  [WorkflowDecisionEnum.RETURN]: "returned",
};

const LIVE = [...LIVE_INSTANCE_STATUSES];

export type DecideResult = "accepted" | "stepClosed";

/** 批次核准的一筆結果(順序同輸入,去重後)。 */
export interface BatchApproveOutcome {
  taskId: string;
  ok: boolean;
  reason: WorkflowBatchApproveFailureEnum | null;
  projectReason: string | null;
}

/** 決定的輸入;沒有 `expectedEditVersion` = 不比對(批次核准:勾選時讀到的版本不帶上來)。 */
type DecideOnceInput = Omit<DecideTaskInput, "expectedEditVersion"> & {
  expectedEditVersion?: number;
};

/**
 * 審核動作(Spec 6b §6「決定」「撤回、改派、新增審核者、審核者失效」)。**每個動作是一個交易**
 * (ADR-0013):讀、寫實例與任務、稽核、推進全在同一個交易裡,任一步失敗全部回復。並發的兩個動作寫到同一份
 * 實例 → 後到的寫入衝突、整個交易由 driver 重跑,重讀後依當下狀態判斷(下列語意不變):
 *
 * - `decideTask`:前置檢查、掛接點守門(`beforeApprove` / `beforeReject` / `beforeReturn`)後寫實例(`$push decisions` + `$push history` + `$inc editVersion`,
 *   條件含「關卡仍 active、我仍是這一項的有效承辦人、這個 taskKey 還沒有決定」),**不比對** `editVersion`;
 *   條件不成立 → `stepClosed`、任務不動。接受後 `advance`。
 * - `reassignTask` / `addStepAssignee`:`editVersion` 條件更新(條件本身含「該 taskKey 尚無決定」);
 *   決定先提交 → 重跑後讀到決定 → 「此任務已決定」。
 * - `retryAdvanceInstance`:寫 `advance_retried` 後推進。
 * - `batchApproveTasks`:逐筆依序核准,**每一筆是自己的交易**(同 `decideTask` 的核准,含 `runApproveGuard`);
 *   一筆失敗只回復那一筆,逐筆回報結果(底座規格 3.10 B18)。
 */
@Injectable()
export class TaskActionsService {
  private readonly logger = new Logger(TaskActionsService.name);

  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly submissions: WorkflowSubmissionStore,
    private readonly directory: TenantDirectoryService,
    private readonly engine: WorkflowEngineService,
    private readonly hooks: WorkflowEngineHooks,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly lifecycle: FormLifecycleService,
  ) {}

  decide(
    facts: FormOperatorFacts,
    input: DecideTaskInput,
  ): Promise<{ task: WorkflowTaskRecord; result: DecideResult }> {
    return this.transactions.withTransaction(() =>
      this.decideOnce(facts, input),
    );
  }

  /**
   * 批次核准:去重後 1 到 `BATCH_APPROVE_LIMIT` 筆,否則 `VALIDATION_FAILED`(整批不做)。
   * 逐筆依序各開一個交易(不平行:同一張單的兩個任務會互相寫入衝突);結果順序同輸入。
   */
  async batchApprove(
    facts: FormOperatorFacts,
    input: BatchApproveTasksInput,
  ): Promise<BatchApproveOutcome[]> {
    const taskIds = [...new Set(input.taskIds)];
    if (taskIds.length === 0 || taskIds.length > BATCH_APPROVE_LIMIT) {
      throw workflowValidationError(
        `taskIds must have 1 to ${String(BATCH_APPROVE_LIMIT)} items`,
        ["taskIds"],
      );
    }
    const comment = input.comment ?? null;
    const outcomes: BatchApproveOutcome[] = [];
    for (const taskId of taskIds) {
      // 刻意依序:每一筆是自己的交易,結果不互相影響
      outcomes.push(await this.approveOne(facts, taskId, comment));
    }
    return outcomes;
  }

  reassign(
    facts: FormOperatorFacts,
    input: ReassignTaskInput,
  ): Promise<WorkflowTaskRecord> {
    return this.transactions.withTransaction(() =>
      this.reassignOnce(facts, input),
    );
  }

  addAssignee(
    facts: FormOperatorFacts,
    input: AddStepAssigneeInput,
  ): Promise<WorkflowTaskRecord> {
    return this.transactions.withTransaction(() =>
      this.addAssigneeOnce(facts, input),
    );
  }

  /** 重試推進(寫 `advance_retried`);任何狀態都可以按,結果與正常路徑相同。 */
  retry(
    facts: FormOperatorFacts,
    input: RetryAdvanceInstanceInput,
  ): Promise<InstanceRecord> {
    return this.transactions.withTransaction(() =>
      this.retryOnce(facts, input),
    );
  }

  /** 批次核准的一筆:自己的交易;失敗轉成結果,不往外拋(其他筆照常)。 */
  private async approveOne(
    facts: FormOperatorFacts,
    taskId: string,
    comment: string | null,
  ): Promise<BatchApproveOutcome> {
    if (!OBJECT_ID_PATTERN.test(taskId)) {
      // 不合法的 id 一定找不到任務:同「不在你手上」
      return failed(taskId, WorkflowBatchApproveFailureEnum.NOT_YOURS);
    }
    try {
      const { result } = await this.transactions.withTransaction(() =>
        this.decideOnce(facts, {
          taskId,
          decision: WorkflowDecisionEnum.APPROVE,
          comment,
        }),
      );
      return result === "accepted"
        ? { taskId, ok: true, reason: null, projectReason: null }
        : failed(taskId, WorkflowBatchApproveFailureEnum.NOT_YOURS);
    } catch (error) {
      if (error instanceof LifecycleBlockedError) {
        return failed(
          taskId,
          WorkflowBatchApproveFailureEnum.BLOCKED,
          error.projectReason,
        );
      }
      if (
        error instanceof GraphQLError &&
        error.extensions.code === "NOT_FOUND"
      ) {
        return failed(taskId, WorkflowBatchApproveFailureEnum.NOT_YOURS);
      }
      this.logger.error(
        `批次核准的一筆失敗(任務 ${taskId}):${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return failed(taskId, WorkflowBatchApproveFailureEnum.FAILED);
    }
  }

  // ---- 交易內的動作本體 ----

  private async decideOnce(
    facts: FormOperatorFacts,
    input: DecideOnceInput,
  ): Promise<{ task: WorkflowTaskRecord; result: DecideResult }> {
    const me = requireActor(facts);
    const task = await this.requireTask(facts, input.taskId);
    const isMine = task.assigneeId.equals(me);
    const wasMine = task.previousAssigneeIds.some((id) => id.equals(me));
    if (!isMine && !wasMine) {
      throw workflowNotFoundError(`Task not found: ${input.taskId}`);
    }
    const decision = DECISION_OF[input.decision];
    const comment = input.comment?.trim() ?? "";
    if (decision !== "approved" && comment === "") {
      throw workflowValidationError("comment is required to reject or return", [
        "comment",
      ]);
    }
    if (!isMine || task.status !== "pending") {
      return { task, result: "stepClosed" };
    }
    if (
      input.expectedEditVersion !== undefined &&
      task.editVersion !== input.expectedEditVersion
    ) {
      throw workflowConflictError(
        `Task edit version mismatch: expected ${String(input.expectedEditVersion)}, actual ${String(task.editVersion)}`,
        "EDIT_VERSION_MISMATCH",
      );
    }
    const instance = await this.engine.findInstance(task.instanceId);
    if (!(await this.isDecidable(task, instance)) || instance === null) {
      return { task, result: "stepClosed" };
    }
    const definition = await this.engine.definitionOf(instance);
    const node = stepOf(definition, task.stepKey);
    if (
      decision === "returned" &&
      (node === undefined || !allowsReturn(node))
    ) {
      throw workflowValidationError(
        `Step ${task.stepKey} does not allow return`,
        ["decision"],
      );
    }
    await this.guardDecision(facts, decision, task);
    await this.hooks.reached("decide:before-write");
    const at = new Date();
    const accepted = await this.instances.findOneAndUpdate(
      systemContext(),
      {
        _id: instance._id,
        status: { $in: LIVE },
        activeStepKeys: task.stepKey,
        steps: {
          $elemMatch: {
            stepKey: task.stepKey,
            status: "active",
            plan: {
              $elemMatch: {
                taskKey: task.taskKey,
                assigneeId: me,
                assigneeState: "active",
              },
            },
            "decisions.taskKey": { $ne: task.taskKey },
          },
        },
      },
      {
        $push: {
          "steps.$[cur].decisions": {
            taskKey: task.taskKey,
            userId: me,
            decision,
            comment: comment === "" ? null : comment,
            at,
          },
          history: {
            at,
            kind: decision,
            stepKey: task.stepKey,
            taskKey: task.taskKey,
            userId: me,
            comment: comment === "" ? null : comment,
            // B15:代理人的這一票作用到他代理的所有人,時間軸寫「由 X 代理 A、B 核准」
            delegatorIds: delegatorIdsOf(instance, task.stepKey, task.taskKey),
          },
        },
        $inc: { editVersion: 1 },
      },
      { arrayFilters: [{ "cur.stepKey": task.stepKey }] },
    );
    if (accepted === null) {
      return { task, result: "stepClosed" };
    }
    await this.tasks.updateOne(
      facts.operator,
      task.tenantId,
      { _id: task._id, editVersion: task.editVersion },
      { $inc: { editVersion: 1 } },
    );
    await this.audit.record(facts.operator, {
      action: TASK_AUDIT.decide,
      targetType: "workflow_task",
      targetId: task._id,
      after: {
        decision,
        instanceId: String(instance._id),
        stepKey: task.stepKey,
      },
    });
    await this.hooks.reached("decide:accepted");
    await this.engine.advance(instance._id);
    return { task: await this.reload(task), result: "accepted" };
  }

  private async reassignOnce(
    facts: FormOperatorFacts,
    input: ReassignTaskInput,
  ): Promise<WorkflowTaskRecord> {
    const task = await this.requireTask(facts, input.taskId);
    const toUserId = toObjectId(input.toUserId, "toUserId");
    await this.assertEligible(task.tenantId, toUserId);
    const instance = await this.liveInstanceOf(task.instanceId);
    const step = this.activeStep(instance, task.stepKey);
    assertNotApplicant(instance, toUserId);
    if (step.decisions.some((entry) => entry.taskKey === task.taskKey)) {
      throw workflowConflictError(
        `Task ${task.taskKey} has already been decided`,
        "ALREADY_DECIDED",
      );
    }
    const item = step.plan.find((entry) => entry.taskKey === task.taskKey);
    if (!item) {
      throw workflowConflictError(
        `Task ${task.taskKey} is not in the plan`,
        "INSTANCE_CHANGED",
      );
    }
    if (step.plan.some((entry) => entry.assigneeId.equals(toUserId))) {
      throw workflowConflictError(
        "The new assignee is already in this step",
        "ALREADY_IN_STEP",
      );
    }
    await this.hooks.reached("reassign:before-write");
    const updated = await this.instances.findOneAndUpdate(
      systemContext(),
      {
        _id: instance._id,
        editVersion: instance.editVersion,
        status: { $in: LIVE },
        steps: {
          $elemMatch: {
            stepKey: task.stepKey,
            status: "active",
            "decisions.taskKey": { $ne: task.taskKey },
          },
        },
      },
      {
        $set: {
          "steps.$[s].plan.$[p].assigneeId": toUserId,
          "steps.$[s].plan.$[p].assigneeState": "active",
          // 改派後的承辦人不是代理(B15),不再記被代理者
          "steps.$[s].plan.$[p].delegatorIds": [],
        },
        $push: {
          "steps.$[s].plan.$[p].previousAssigneeIds": item.assigneeId,
          history: {
            at: new Date(),
            kind: "reassigned",
            stepKey: task.stepKey,
            taskKey: task.taskKey,
            userId: item.assigneeId,
            toUserId,
          },
        },
        $inc: { editVersion: 1 },
      },
      {
        arrayFilters: [
          { "s.stepKey": task.stepKey },
          { "p.taskKey": task.taskKey },
        ],
      },
    );
    if (updated === null) {
      throw instanceChangedError();
    }
    await this.audit.record(facts.operator, {
      action: TASK_AUDIT.reassign,
      targetType: "workflow_task",
      targetId: task._id,
      before: { assigneeId: String(item.assigneeId) },
      after: { assigneeId: String(toUserId) },
    });
    await this.engine.advance(task.instanceId);
    return this.reload(task);
  }

  private async addAssigneeOnce(
    facts: FormOperatorFacts,
    input: AddStepAssigneeInput,
  ): Promise<WorkflowTaskRecord> {
    const instanceId = toObjectId(input.instanceId, "instanceId");
    const userId = toObjectId(input.userId, "userId");
    const tenantId = await this.requireInstanceInTenant(facts, instanceId);
    await this.assertEligible(tenantId, userId);
    const instance = await this.liveInstanceOf(instanceId);
    const step = this.activeStep(instance, input.stepKey);
    assertNotApplicant(instance, userId);
    if (!step.blocked || step.plan.length > 0) {
      throw workflowConflictError(
        `Step ${input.stepKey} is not blocked by an empty assignee list`,
        "INSTANCE_CHANGED",
      );
    }
    const taskKey = nextTaskKey(input.stepKey, step.plan);
    await this.hooks.reached("add-assignee:before-write");
    const updated = await this.instances.findOneAndUpdate(
      systemContext(),
      {
        _id: instance._id,
        editVersion: instance.editVersion,
        status: { $in: LIVE },
        steps: {
          $elemMatch: {
            stepKey: input.stepKey,
            status: "active",
            blocked: true,
            plan: { $size: 0 },
          },
        },
      },
      {
        $push: {
          "steps.$[s].plan": {
            taskKey,
            assigneeId: userId,
            previousAssigneeIds: [],
            assigneeState: "active",
          },
          history: {
            at: new Date(),
            kind: "assignee_added",
            stepKey: input.stepKey,
            taskKey,
            toUserId: userId,
            userId: facts.operator.actorId,
          },
        },
        $inc: { editVersion: 1 },
      },
      { arrayFilters: [{ "s.stepKey": input.stepKey }] },
    );
    if (updated === null) {
      throw instanceChangedError();
    }
    await this.audit.record(facts.operator, {
      action: TASK_AUDIT.addAssignee,
      targetType: "workflow_instance",
      targetId: instanceId,
      after: { stepKey: input.stepKey, taskKey, userId: String(userId) },
    });
    await this.engine.advance(instanceId);
    const task = await this.tasks.findOne(tenantId, { instanceId, taskKey });
    if (!task) {
      throw new Error(`新增審核者後沒有建出任務 ${taskKey}`);
    }
    return task;
  }

  private async retryOnce(
    facts: FormOperatorFacts,
    input: RetryAdvanceInstanceInput,
  ): Promise<InstanceRecord> {
    const instanceId = toObjectId(input.instanceId, "instanceId");
    await this.requireInstanceInTenant(facts, instanceId);
    await this.instances.findOneAndUpdate(
      systemContext(),
      { _id: instanceId },
      {
        $push: {
          history: {
            at: new Date(),
            kind: "advance_retried",
            userId: facts.operator.actorId,
          },
        },
      },
    );
    await this.audit.record(facts.operator, {
      action: TASK_AUDIT.retryAdvance,
      targetType: "workflow_instance",
      targetId: instanceId,
    });
    const advanced = await this.engine.advance(instanceId);
    if (!advanced) {
      throw workflowNotFoundError(`Instance not found: ${input.instanceId}`);
    }
    return advanced;
  }

  // ---- 內部 ----

  /** 決定的守門(寫入之前;擋下 = 整個交易回復,此時還沒有寫入)。核准一律經 `runApproveGuard`。 */
  private async guardDecision(
    facts: FormOperatorFacts,
    decision: Decision,
    task: WorkflowTaskRecord,
  ): Promise<void> {
    const submission = await this.submissions.findById(
      task.tenantId,
      task.submissionId,
    );
    if (submission === null) {
      // isDecidable 已確認它存在;同一個交易內讀不到 = 資料不一致
      throw new Error(`任務 ${String(task._id)} 的提交不存在`);
    }
    const input = {
      operator: facts.operator,
      submission,
      stepKey: task.stepKey,
    };
    switch (decision) {
      case "approved": {
        await this.lifecycle.runApproveGuard(input);
        return;
      }
      case "rejected": {
        await this.lifecycle.guard("beforeReject", input);
        return;
      }
      case "returned": {
        await this.lifecycle.guard("beforeReturn", input);
        return;
      }
    }
  }

  /** 任務在操作者的租戶內;否則當不存在。 */
  private async requireTask(
    facts: FormOperatorFacts,
    taskId: string,
  ): Promise<WorkflowTaskRecord> {
    const id = toObjectId(taskId, "taskId");
    const task =
      facts.tenantId === null
        ? null
        : await this.tasks.findOne(facts.tenantId, { _id: id });
    if (!task) {
      throw workflowNotFoundError(`Task not found: ${taskId}`);
    }
    return task;
  }

  private async requireInstanceInTenant(
    facts: FormOperatorFacts,
    instanceId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    const instance = await this.engine.findInstance(instanceId);
    if (
      instance?.tenantId === null ||
      instance === null ||
      facts.tenantId === null ||
      !instance.tenantId.equals(facts.tenantId)
    ) {
      throw workflowNotFoundError(`Instance not found: ${String(instanceId)}`);
    }
    return instance.tenantId;
  }

  /** 決定的前置(Spec §6「決定」1):任務屬於提交目前的實例、實例進行中、關卡在 active 且為 active。 */
  private async isDecidable(
    task: WorkflowTaskRecord,
    instance: InstanceRecord | null,
  ): Promise<boolean> {
    if (instance === null || !LIVE.includes(instance.status as never)) {
      return false;
    }
    const submission = await this.submissions.findById(
      task.tenantId,
      task.submissionId,
    );
    const step = instance.steps.find((state) => state.stepKey === task.stepKey);
    return (
      submission?.currentInstanceId?.equals(instance._id) === true &&
      instance.activeStepKeys.includes(task.stepKey) &&
      step?.status === "active"
    );
  }

  private async liveInstanceOf(
    instanceId: Types.ObjectId,
  ): Promise<InstanceRecord> {
    const instance = await this.engine.findInstance(instanceId);
    if (instance === null || !LIVE.includes(instance.status as never)) {
      throw workflowConflictError(
        "The instance is no longer in review",
        "INSTANCE_CHANGED",
      );
    }
    return instance;
  }

  private activeStep(
    instance: InstanceRecord,
    stepKey: string,
  ): InstanceRecord["steps"][number] {
    const step = instance.steps.find((state) => state.stepKey === stepKey);
    if (
      step?.status !== "active" ||
      !instance.activeStepKeys.includes(stepKey)
    ) {
      throw workflowConflictError(
        `Step ${stepKey} is not in progress`,
        "INSTANCE_CHANGED",
      );
    }
    return step;
  }

  /** 改派 / 新增審核者的對象:啟用中、仍在本租戶。 */
  private async assertEligible(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    if (!(await this.directory.isEligible(tenantId, userId))) {
      throw workflowForbiddenError(
        "The assignee must be an enabled user in this tenant",
        "ASSIGNEE_NOT_ELIGIBLE",
      );
    }
  }

  private async reload(task: WorkflowTaskRecord): Promise<WorkflowTaskRecord> {
    return (await this.tasks.findOne(task.tenantId, { _id: task._id })) ?? task;
  }
}

/** 任務 id 的形狀(Mongo ObjectId 的 24 位十六進位)。 */
const OBJECT_ID_PATTERN = /^[\da-f]{24}$/i;

/** B15:計畫裡這一項代理的原審核者們(決定事件帶著,時間軸寫「由 X 代理 A、B」);沒有 → 空陣列。 */
function delegatorIdsOf(
  instance: InstanceRecord,
  stepKey: string,
  taskKey: string,
): Types.ObjectId[] {
  const step = instance.steps.find((one) => one.stepKey === stepKey);
  const item = step?.plan.find((one) => one.taskKey === taskKey);
  return [...(item?.delegatorIds ?? [])];
}

function failed(
  taskId: string,
  reason: WorkflowBatchApproveFailureEnum,
  projectReason: string | null = null,
): BatchApproveOutcome {
  return { taskId, ok: false, reason, projectReason };
}

/** 條件更新沒命中:交易內讀到的實例與寫入時不同(不應發生;並發由寫入衝突重跑處理)。 */
function instanceChangedError(): Error {
  return workflowConflictError(
    "The instance changed; reload and try again",
    "INSTANCE_CHANGED",
  );
}

function requireActor(facts: FormOperatorFacts): Types.ObjectId {
  const actorId = facts.operator.actorId;
  if (actorId === null) {
    throw workflowForbiddenError("An operator is required");
  }
  return actorId;
}

/** 申請人不能審自己的單(改派 / 新增審核者也不能指給他)。 */
function assertNotApplicant(
  instance: InstanceRecord,
  userId: Types.ObjectId,
): void {
  if (instance.createdBy?.equals(userId) === true) {
    throw workflowForbiddenError(
      "The applicant cannot review their own submission",
      "ASSIGNEE_NOT_ELIGIBLE",
    );
  }
}
