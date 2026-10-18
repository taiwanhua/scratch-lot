import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { temporalIsoOf } from "@repo/domain/form";
import {
  type WorkflowDefinition,
  allowsReturn,
  isJoinStep,
  stepOf,
} from "@repo/domain/workflow";

import {
  FormsRepository,
  ModulesRepository,
} from "../../database/database.module";
import type { WorkflowTaskRecord } from "../../database/workflow-tasks.repository";
import { WorkflowTasksRepository } from "../../database/workflow-tasks.repository";
import { WorkflowsRepository } from "../../database/workflows.repository";
import { FormUserNames, userRefOf } from "../../forms/form-mapper";
import type {
  FormSubmissionSummary,
  FormUserRef,
} from "../../forms/models/form-common.model";
import {
  type WorkflowInstanceModel,
  WorkflowInstanceStatusEnum,
  WorkflowStepStatusEnum,
  type WorkflowTaskModel,
  WorkflowTaskStatusEnum,
} from "../models/workflow-instance.model";
import { systemContext } from "../tenant-directory.service";
import type { InstanceRecord } from "./instance-writes";
import { WorkflowEngineService } from "./workflow-engine.service";

/** 讀者對這個實例的能力(呼叫端算好帶進來)。 */
export interface InstanceViewer {
  actorId: Types.ObjectId | null;
  canManage: boolean;
  /**
   * 只回標題槽(阻擋清單 / 流程管理者的處置回傳):流程管理者不一定讀得到提交內容,
   * 摘要只給辨識用的標題,不給日期 / 金額(流程管理者只看實例與任務摘要,不含提交內容)。
   */
  titleOnly?: boolean;
}

function summaryOf(
  summary: InstanceRecord["summary"],
  titleOnly = false,
): FormSubmissionSummary | null {
  if (!summary) {
    return null;
  }
  return titleOnly
    ? { title: summary.title, date: null, amount: null }
    : {
        title: summary.title,
        date: temporalIsoOf(summary.date),
        amount: summary.amount ?? null,
      };
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

/** 舊資料可能沒有的 id 陣列欄位(`delegatorIds`)→ 一律給陣列;`refsOf` 與收集 userIds 共用同一個判斷。 */
function idsOf(
  ids: readonly Types.ObjectId[] | undefined,
): readonly Types.ObjectId[] {
  return ids ?? [];
}

/** id 們 → 使用者參照(舊資料沒有這個欄位 → 空陣列;被刪除的人 `name` 為 null)。 */
function refsOf(
  ids: readonly Types.ObjectId[] | undefined,
  names: ReadonlyMap<string, string>,
): FormUserRef[] {
  return idsOf(ids)
    .map((id) => userRefOf(id, names))
    .filter((ref) => nonNull(ref));
}

/**
 * 實例與任務的對外形狀(申請中心、審核區塊、阻擋清單共用)。**摘要一律讀實例快照**
 * (`workflow_instances.summary`,該修訂的標題槽),不讀提交最新的 `summary` ——
 * 否則只審過舊修訂的人會看到之後修訂的標題。不含提交內容。
 */
@Injectable()
export class WorkflowPresenter {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly tasks: WorkflowTasksRepository,
    private readonly workflows: WorkflowsRepository,
    private readonly forms: FormsRepository,
    private readonly modules: ModulesRepository,
    private readonly userNames: FormUserNames,
  ) {}

  async instanceModel(
    instance: InstanceRecord,
    viewer: InstanceViewer,
  ): Promise<WorkflowInstanceModel> {
    const definition = await this.engine.definitionOf(instance);
    const userIds: (Types.ObjectId | null)[] = [instance.createdBy];
    for (const step of instance.steps) {
      for (const item of step.plan) {
        userIds.push(
          item.assigneeId,
          ...item.previousAssigneeIds,
          ...idsOf(item.delegatorIds),
        );
      }
      for (const decision of step.decisions) {
        userIds.push(decision.userId);
      }
    }
    for (const event of instance.history) {
      userIds.push(event.userId, event.toUserId, ...idsOf(event.delegatorIds));
    }
    const names = await this.userNames.load(systemContext(), userIds);
    const myTasks =
      viewer.actorId === null || instance.tenantId === null
        ? []
        : await this.tasks.findMany(instance.tenantId, {
            instanceId: instance._id,
            assigneeId: viewer.actorId,
          });
    // 流程管理者要對別人的任務改派(`reassignTask` 收 taskId):只有他拿得到計畫項目的任務 id
    const taskIdByKey = new Map<string, string>();
    if (viewer.canManage && instance.tenantId !== null) {
      const tasks = await this.tasks.findMany(instance.tenantId, {
        instanceId: instance._id,
      });
      for (const task of tasks) {
        taskIdByKey.set(task.taskKey, String(task._id));
      }
    }
    const isLive =
      instance.status === "running" || instance.status === "blocked";
    const hasDecisions = instance.steps.some(
      (step) => step.decisions.length > 0,
    );
    const isApplicant =
      viewer.actorId !== null &&
      instance.createdBy?.equals(viewer.actorId) === true;
    return {
      id: String(instance._id),
      submissionId: String(instance.submissionId),
      revision: instance.revision,
      moduleKey: instance.moduleKey,
      moduleName: await this.moduleNameOf(instance.moduleKey),
      formKey: instance.formKey,
      formName: await this.formNameOf(instance.formKey),
      formVersion: instance.formVersion,
      workflowKey: instance.workflowKey,
      workflowName: await this.workflowNameOf(instance),
      workflowVersion: instance.workflowVersion,
      status: instance.status as WorkflowInstanceStatusEnum,
      summary: summaryOf(instance.summary, viewer.titleOnly === true),
      applicant: userRefOf(instance.createdBy, names),
      activeStepKeys: [...instance.activeStepKeys],
      steps: definition.steps.map((node) => {
        const state = instance.steps.find(
          (candidate) => candidate.stepKey === node.key,
        );
        return {
          stepKey: node.key,
          name: node.name,
          kind: isJoinStep(node) ? "join" : "review",
          mode: isJoinStep(node) ? null : node.mode,
          allowReturn: allowsReturn(node),
          status: (state?.status ?? "pending") as WorkflowStepStatusEnum,
          blocked: state?.blocked ?? false,
          plan: (state?.plan ?? []).map((item) => ({
            taskKey: item.taskKey,
            assignee: userRefOf(item.assigneeId, names) ?? {
              id: String(item.assigneeId),
              name: null,
            },
            previousAssignees: item.previousAssigneeIds
              .map((id) => userRefOf(id, names))
              .filter((ref) => nonNull(ref)),
            assigneeState: item.assigneeState,
            delegators: refsOf(item.delegatorIds, names),
            taskId: taskIdByKey.get(item.taskKey) ?? null,
          })),
          decisions: (state?.decisions ?? []).map((decision) => ({
            taskKey: decision.taskKey,
            user: userRefOf(decision.userId, names) ?? {
              id: String(decision.userId),
              name: null,
            },
            decision: decision.decision,
            comment: decision.comment,
            at: decision.at,
          })),
        };
      }),
      history: instance.history.map((event) => ({
        at: event.at,
        kind: event.kind,
        stepKey: event.stepKey,
        taskKey: event.taskKey,
        user: userRefOf(event.userId, names),
        toUser: userRefOf(event.toUserId, names),
        comment: event.comment,
        result: event.result,
        reason: event.reason ?? null,
        code: event.code ?? null,
        delegators: refsOf(event.delegatorIds, names),
      })),
      outcome: instance.outcome
        ? {
            kind: instance.outcome.kind,
            stepKey: instance.outcome.stepKey,
            taskKey: instance.outcome.taskKey,
          }
        : null,
      editVersion: instance.editVersion,
      myTasks: await this.taskModels(myTasks, viewer.titleOnly === true),
      abilities: {
        canWithdraw: isApplicant && isLive && !hasDecisions,
        canManage: viewer.canManage,
      },
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      finishedAt: instance.finishedAt,
    };
  }

  /** 一批任務 → 對外形狀(實例、表單、模組名稱批次讀)。 */
  async taskModels(
    tasks: readonly WorkflowTaskRecord[],
    titleOnly = false,
  ): Promise<WorkflowTaskModel[]> {
    const instances = new Map<string, InstanceRecord>();
    const definitions = new Map<string, WorkflowDefinition>();
    for (const task of tasks) {
      const key = String(task.instanceId);
      if (!instances.has(key)) {
        const instance = await this.engine.findInstance(task.instanceId);
        if (instance) {
          instances.set(key, instance);
          definitions.set(key, await this.engine.definitionOf(instance));
        }
      }
    }
    const names = await this.userNames.load(systemContext(), [
      ...tasks.map((task) => task.assigneeId),
      ...[...instances.values()].map((instance) => instance.createdBy),
    ]);
    const models: WorkflowTaskModel[] = [];
    for (const task of tasks) {
      const instance = instances.get(String(task.instanceId));
      const definition = definitions.get(String(task.instanceId));
      models.push({
        id: String(task._id),
        instanceId: String(task.instanceId),
        submissionId: String(task.submissionId),
        revision: task.revision,
        moduleKey: task.moduleKey,
        moduleName: await this.moduleNameOf(task.moduleKey),
        formKey: task.formKey,
        formName: await this.formNameOf(task.formKey),
        stepKey: task.stepKey,
        stepName:
          (definition && stepOf(definition, task.stepKey)?.name) ??
          task.stepKey,
        taskKey: task.taskKey,
        status: task.status as WorkflowTaskStatusEnum,
        assignee: userRefOf(task.assigneeId, names) ?? {
          id: String(task.assigneeId),
          name: null,
        },
        applicant: instance ? userRefOf(instance.createdBy, names) : null,
        summary: instance ? summaryOf(instance.summary, titleOnly) : null,
        instanceStatus: (instance?.status ??
          "running") as WorkflowInstanceStatusEnum,
        decidedAt: task.decidedAt,
        comment: task.comment,
        editVersion: task.editVersion,
        createdAt: task.createdAt,
      });
    }
    return models;
  }

  private async formNameOf(formKey: string): Promise<string | null> {
    const form = await this.forms.findOne(systemContext(), { key: formKey });
    return form?.name ?? null;
  }

  private async moduleNameOf(moduleKey: string): Promise<string | null> {
    const module = await this.modules.findOne(systemContext(), {
      key: moduleKey,
    });
    return module?.name ?? null;
  }

  private async workflowNameOf(
    instance: InstanceRecord,
  ): Promise<string | null> {
    const workflow =
      (await this.workflows.findOne(null, { key: instance.workflowKey })) ??
      (instance.tenantId === null
        ? null
        : await this.workflows.findOne(instance.tenantId, {
            key: instance.workflowKey,
          }));
    return workflow?.name ?? null;
  }
}
