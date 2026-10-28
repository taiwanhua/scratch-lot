import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { temporalIsoOf } from "@repo/domain/form";
import {
  type WorkflowDefinition,
  allowsReturn,
  applicantAsReviewerOf,
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
import {
  WorkflowEngineService,
  definitionKeyOf,
  groupByTenant,
} from "./workflow-engine.service";

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
    const [model] = await this.instanceModels([instance], viewer);
    if (model === undefined) {
      throw new Error(`實例 ${String(instance._id)} 沒有產生對外形狀`);
    }
    return model;
  }

  /**
   * 一頁實例 → 對外形狀(順序同輸入)。定義、使用者名稱、任務、模組 / 表單 / 流程名稱都依整頁一次讀
   * (TX-07),指令數不隨列數成長(任務與客製流程依租戶各一次)。
   */
  async instanceModels(
    instances: readonly InstanceRecord[],
    viewer: InstanceViewer,
  ): Promise<WorkflowInstanceModel[]> {
    if (instances.length === 0) {
      return [];
    }
    const definitions = await this.engine.definitionsOf(instances);
    const names = await this.userNames.load(
      systemContext(),
      instances.flatMap((instance) => userIdsOf(instance)),
    );
    const { myTasksOf, taskIdsOf } = await this.instanceTasksOf(
      instances,
      viewer,
    );
    const myTaskModelsOf = new Map<string, WorkflowTaskModel[]>();
    for (const model of await this.taskModels(
      instances.flatMap(
        (instance) => myTasksOf.get(String(instance._id)) ?? [],
      ),
      viewer.titleOnly === true,
    )) {
      myTaskModelsOf.set(model.instanceId, [
        ...(myTaskModelsOf.get(model.instanceId) ?? []),
        model,
      ]);
    }
    const moduleNames = await this.moduleNamesOf(
      instances.map((instance) => instance.moduleKey),
    );
    const formNames = await this.formNamesOf(
      instances.map((instance) => instance.formKey),
    );
    const workflowNames = await this.workflowNamesOf(instances);
    return instances.map((instance) => {
      const key = String(instance._id);
      return this.toInstanceModel(instance, viewer, {
        definition: definitionIn(definitions, instance),
        names,
        taskIdByKey: taskIdsOf.get(key) ?? new Map<string, string>(),
        myTasks: myTaskModelsOf.get(key) ?? [],
        moduleName: moduleNames.get(instance.moduleKey) ?? null,
        formName: formNames.get(instance.formKey) ?? null,
        workflowName: workflowNames.get(instance.workflowKey) ?? null,
      });
    });
  }

  /**
   * 一頁實例的任務(依租戶各一次):我的任務,與計畫項目的任務 id(流程管理者要對別人的任務改派,
   * `reassignTask` 收 taskId:只有他拿得到)。流程管理者讀全部任務、我的任務從裡面挑;否則只讀我的。
   */
  private async instanceTasksOf(
    instances: readonly InstanceRecord[],
    viewer: InstanceViewer,
  ): Promise<{
    myTasksOf: Map<string, WorkflowTaskRecord[]>;
    taskIdsOf: Map<string, Map<string, string>>;
  }> {
    const myTasksOf = new Map<string, WorkflowTaskRecord[]>();
    const taskIdsOf = new Map<string, Map<string, string>>();
    const actorId = viewer.actorId;
    if (actorId === null && !viewer.canManage) {
      return { myTasksOf, taskIdsOf };
    }
    for (const group of groupByTenant(instances)) {
      const tasks = await this.tasks.findMany(group.tenantId, {
        instanceId: { $in: group.instances.map((instance) => instance._id) },
        ...(viewer.canManage || actorId === null
          ? {}
          : { assigneeId: actorId }),
      });
      for (const task of tasks) {
        const key = String(task.instanceId);
        if (viewer.canManage) {
          const ids = taskIdsOf.get(key) ?? new Map<string, string>();
          ids.set(task.taskKey, String(task._id));
          taskIdsOf.set(key, ids);
        }
        if (actorId !== null && task.assigneeId.equals(actorId)) {
          myTasksOf.set(key, [...(myTasksOf.get(key) ?? []), task]);
        }
      }
    }
    return { myTasksOf, taskIdsOf };
  }

  private toInstanceModel(
    instance: InstanceRecord,
    viewer: InstanceViewer,
    loaded: {
      definition: WorkflowDefinition;
      names: ReadonlyMap<string, string>;
      taskIdByKey: ReadonlyMap<string, string>;
      myTasks: WorkflowTaskModel[];
      moduleName: string | null;
      formName: string | null;
      workflowName: string | null;
    },
  ): WorkflowInstanceModel {
    const { definition, names, taskIdByKey } = loaded;
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
      moduleName: loaded.moduleName,
      formKey: instance.formKey,
      formName: loaded.formName,
      formVersion: instance.formVersion,
      workflowKey: instance.workflowKey,
      workflowName: loaded.workflowName,
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
          allowsApplicantAssignee:
            !isJoinStep(node) &&
            applicantAsReviewerOf(node.autoApprove) === "review",
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
      myTasks: loaded.myTasks,
      abilities: {
        canWithdraw: isApplicant && isLive && !hasDecisions,
        canManage: viewer.canManage,
      },
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      finishedAt: instance.finishedAt,
    };
  }

  /** 一批任務 → 對外形狀(實例、定義、名稱依整批一次讀,TX-07)。 */
  async taskModels(
    tasks: readonly WorkflowTaskRecord[],
    titleOnly = false,
  ): Promise<WorkflowTaskModel[]> {
    if (tasks.length === 0) {
      return [];
    }
    const found = await this.engine.findInstances(
      tasks.map((task) => task.instanceId),
    );
    const instances = new Map(
      found.map((instance) => [String(instance._id), instance]),
    );
    const definitions = await this.engine.definitionsOf(found);
    const names = await this.userNames.load(systemContext(), [
      ...tasks.map((task) => task.assigneeId),
      ...found.map((instance) => instance.createdBy),
    ]);
    const moduleNames = await this.moduleNamesOf(
      tasks.map((task) => task.moduleKey),
    );
    const formNames = await this.formNamesOf(tasks.map((task) => task.formKey));
    return tasks.map((task) => {
      const instance = instances.get(String(task.instanceId));
      const definition = instance
        ? definitionIn(definitions, instance)
        : undefined;
      return {
        id: String(task._id),
        instanceId: String(task.instanceId),
        submissionId: String(task.submissionId),
        revision: task.revision,
        moduleKey: task.moduleKey,
        moduleName: moduleNames.get(task.moduleKey) ?? null,
        formKey: task.formKey,
        formName: formNames.get(task.formKey) ?? null,
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
      };
    });
  }

  /** 表單 key → 名稱(key 全域唯一;去重後一次讀)。 */
  private async formNamesOf(
    formKeys: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const keys = [...new Set(formKeys)];
    if (keys.length === 0) {
      return new Map();
    }
    const forms = await this.forms.findMany(systemContext(), {
      key: { $in: keys },
    });
    return new Map(forms.map((form) => [form.key, form.name]));
  }

  /** 模組 key → 名稱(key 全域唯一;去重後一次讀)。 */
  private async moduleNamesOf(
    moduleKeys: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const keys = [...new Set(moduleKeys)];
    if (keys.length === 0) {
      return new Map();
    }
    const modules = await this.modules.findMany(systemContext(), {
      key: { $in: keys },
    });
    return new Map(modules.map((module) => [module.key, module.name]));
  }

  /**
   * 流程 key → 名稱:先找共用的(`tenantId = null`),共用沒有的再到實例的租戶找客製的(依租戶各一次);
   * key 全域唯一。
   */
  private async workflowNamesOf(
    instances: readonly InstanceRecord[],
  ): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    const shared = await this.workflows.findMany(null, {
      key: {
        $in: [...new Set(instances.map((instance) => instance.workflowKey))],
      },
    });
    for (const workflow of shared) {
      names.set(workflow.key, workflow.name);
    }
    for (const group of groupByTenant(instances)) {
      const missing = [
        ...new Set(
          group.instances
            .map((instance) => instance.workflowKey)
            .filter((key) => !names.has(key)),
        ),
      ];
      if (missing.length === 0) {
        continue;
      }
      const owned = await this.workflows.findMany(group.tenantId, {
        key: { $in: missing },
      });
      for (const workflow of owned) {
        names.set(workflow.key, workflow.name);
      }
    }
    return names;
  }
}

/** 實例上出現的所有使用者 id(申請人、計畫項目、決定、歷程;名稱整頁一次讀)。 */
function userIdsOf(instance: InstanceRecord): (Types.ObjectId | null)[] {
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
  return userIds;
}

/** `definitionsOf` 的結果裡這個實例的那一版(`definitionsOf` 已確認每版都在)。 */
function definitionIn(
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  instance: InstanceRecord,
): WorkflowDefinition {
  const definition = definitions.get(definitionKeyOf(instance));
  if (definition === undefined) {
    throw new Error(`流程版本 ${definitionKeyOf(instance)} 不存在`);
  }
  return definition;
}
