import { Injectable } from "@nestjs/common";
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
import { WorkflowDecisionEnum } from "../models/workflow-instance.model";
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
import type {
  AddStepAssigneeInput,
  DecideTaskInput,
  ReassignTaskInput,
  RetryAdvanceInstanceInput,
} from "./dto/workflow-engine.input";
import type { InstanceRecord } from "./instance-writes";
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

/**
 * 審核動作(Spec 6b §6「決定」「撤回、改派、新增審核者、審核者失效」)。**每個動作是一個交易**
 * (ADR-0013):讀、寫實例與任務、稽核、推進全在同一個交易裡,任一步失敗全部回復。並發的兩個動作寫到同一份
 * 實例 → 後到的寫入衝突、整個交易由 driver 重跑,重讀後依當下狀態判斷(下列語意不變):
 *
 * - `decideTask`:前置檢查後寫實例(`$push decisions` + `$push history` + `$inc editVersion`,
 *   條件含「關卡仍 active、我仍是這一項的有效承辦人、這個 taskKey 還沒有決定」),**不比對** `editVersion`;
 *   條件不成立 → `stepClosed`、任務不動。接受後 `advance`。
 * - `reassignTask` / `addStepAssignee`:`editVersion` 條件更新(條件本身含「該 taskKey 尚無決定」);
 *   決定先提交 → 重跑後讀到決定 → 「此任務已決定」。
 * - `retryAdvanceInstance`:寫 `advance_retried` 後推進。
 */
@Injectable()
export class TaskActionsService {
  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly submissions: WorkflowSubmissionStore,
    private readonly directory: TenantDirectoryService,
    private readonly engine: WorkflowEngineService,
    private readonly hooks: WorkflowEngineHooks,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  decide(
    facts: FormOperatorFacts,
    input: DecideTaskInput,
  ): Promise<{ task: WorkflowTaskRecord; result: DecideResult }> {
    return this.transactions.withTransaction(() =>
      this.decideOnce(facts, input),
    );
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

  // ---- 交易內的動作本體 ----

  private async decideOnce(
    facts: FormOperatorFacts,
    input: DecideTaskInput,
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
    if (task.editVersion !== input.expectedEditVersion) {
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
      { _id: task._id, editVersion: input.expectedEditVersion },
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
