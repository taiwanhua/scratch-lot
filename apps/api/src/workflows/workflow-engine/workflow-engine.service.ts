import { Injectable, Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type AdvanceAction,
  type AdvanceInput,
  type AdvancePlan,
  type InstanceUpdate,
  type SubmissionStatus,
  type WorkflowDefinition,
  advance,
  isReviewStep,
  stepOf,
} from "@repo/domain/workflow";

import {
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "../../database/database.module";
import { TransactionService, afterCommit } from "../../database/transaction";
import { WorkflowSubmissionStore } from "../../database/workflow-submission-store";
import { WorkflowTasksRepository } from "../../database/workflow-tasks.repository";
import { RealtimePublisher } from "../../realtime/realtime-publisher.service";
import { systemContext } from "../tenant-directory.service";
import { definitionOfVersion } from "../workflow-definition-input";
import { APPLY_CENTER_MODULE_KEY } from "../workflow-keys";
import {
  type InstanceRecord,
  historyEventDocument,
  instanceFilterOf,
  instanceUpdateOf,
  taskProjectionDocument,
  toInstanceSnapshot,
  toObjectId,
  toSubmissionSnapshot,
  toTaskSnapshot,
} from "./instance-writes";
import type { FormEffectName } from "./lifecycle/form-lifecycle-registration";
import {
  type EffectSubject,
  FormLifecycleService,
} from "./lifecycle/form-lifecycle.service";
import { StepEntryService } from "./step-entry.service";
import { WorkflowNotifier } from "./workflow-notifier.service";

/** 一輪動作執行的結果。 */
type RoundResult = "done" | "casFailed" | "invalid";

/** 提交同步成這些狀態 = 觸發對應的事後動作(`submitted` / `voided` 不經推進,由送出 / 作廢觸發)。 */
const EFFECT_OF_SUBMISSION_STATUS: Partial<
  Record<SubmissionStatus, FormEffectName>
> = {
  completed: "completed",
  rejected: "rejected",
  returned: "returned",
  withdrawn: "withdrawn",
};

/** 推進的上限輪數(正常一次推進只要個位數輪;超過代表判斷表在來回打架,記 log 停下)。 */
const MAX_ROUNDS = 60;

/**
 * 引擎的檢查點(正式環境什麼都不做)。要驗「中斷 → 整個動作全部回復」,測試必須能讓某一步**真的**
 * 在交易半路失敗;要驗並發,測試要能在某一步插進另一個請求 —— GraphQL 端點上看不到這個能力,所以測試經
 * `app.get(WorkflowEngineHooks)` 讓指定檢查點丟錯或插入動作(TEST-07 的第二個接縫,理由同 `FormPublishHooks`):
 * - `submit:before-write`:送出建實例之前(已查過同修訂號沒有實例)
 * - `submit:instance-created` / `submit:submission-linked`:送出第 2 / 3 步之後
 * - `decide:before-write` / `decide:accepted`:決定寫入實例之前 / 之後
 * - `withdraw:before-write` / `reassign:before-write` / `add-assignee:before-write`:撤回 / 改派 /
 *   新增審核者寫入實例之前
 * - `action:<動作種類>`:推進執行每一個動作之前(如 `action:createTask`)
 *
 * 檢查點都在交易內:丟錯 = 整個交易回復;插入的動作要在交易外執行(`hooks-fixture.ts` 的 `interleaveAt`),
 * 且只能插在本交易寫入之前 —— 插在寫入之後,另一個請求會等本交易的鎖,而本交易在等它。
 */
@Injectable()
export class WorkflowEngineHooks {
  private last: string | null = null;

  /** 最後走到的檢查點(除錯用)。 */
  get lastCheckpoint(): string | null {
    return this.last;
  }

  reached(checkpoint: string): Promise<void> {
    this.last = checkpoint;
    return Promise.resolve();
  }
}

/**
 * `advance(instance)` 的執行器(Spec 6b §6「冪等推進」;判斷表本體是 `@repo/domain/workflow` 的純函式
 * `advance`,**執行合約**見它的檔頭):
 *
 * 1. 讀實例(權威)、它的全部任務、對應的提交 → `advance` → 列 5 需要時先解析進關結果再呼叫一次
 * 2. 依序執行動作,每個寫入都是條件更新:實例用 `editVersion` CAS(節點以 `arrayFilters` 指到 `stepKey`)、
 *    任務先查 `(instanceId, taskKey)` 再建、投影同步帶讀到的狀態、提交用「仍指向本實例 + 修訂號 + 審核中」
 * 3. `updateInstance` 的條件不成立就結束本輪、重讀再判斷;其他動作條件不成立 = 已做過
 * 4. `invalidState` = 權威資料自相矛盾:不寫、停下、記 log(它會一直出現在「需要推進」)
 *
 * 重複到「沒事可做」,**整段推進(含連續推進)是一個交易**(ADR-0013、TX-01):任何一步失敗,這次推進的
 * 所有寫入一起回復;呼叫端(送出、決定、撤回、改派、新增審核者、失效 hook、重試推進)已在交易內時就併進
 * 呼叫端的交易。並發的另一個交易寫到同一份實例 → 寫入衝突、整個交易由 driver 重跑,重讀後再判斷。
 * 通知與推進同一個交易寫入,站內信號與 email 排在交易提交後(`WorkflowNotifier` → `notify()`)。
 *
 * **掛接點的事後動作**(`lifecycle/`)也在推進裡觸發、同一個交易:實例的條件更新成功且把審核關卡改成
 * `completed` / `skipped` → `stepPassed`(跳過帶 `skipped: true`);提交同步成完成 / 駁回 / 退回 / 撤回且
 * 真的命中 → `completed` / `rejected` / `returned` / `withdrawn`。事後動作拋錯 = 整個推進(與呼叫端的動作)回復。
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly submissions: WorkflowSubmissionStore,
    private readonly entries: StepEntryService,
    private readonly notifier: WorkflowNotifier,
    private readonly hooks: WorkflowEngineHooks,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly lifecycle: FormLifecycleService,
  ) {}

  /**
   * 實例走的那一版流程定義。**每次都讀資料庫,不跨請求快取**:已發布的版本平常不會原地改寫,
   * 但資料庫 reset 後同一個 key / 版號可以是另一份內容(或已不存在),這個 service 活得比它久。
   */
  async definitionOf(instance: {
    workflowKey: string;
    workflowVersion: number;
  }): Promise<WorkflowDefinition> {
    const version = await this.versions.findOne(systemContext(), {
      workflowKey: instance.workflowKey,
      version: instance.workflowVersion,
    });
    if (!version) {
      throw new Error(
        `流程版本 ${instance.workflowKey}@${String(instance.workflowVersion)} 不存在`,
      );
    }
    return definitionOfVersion(version);
  }

  async findInstance(
    instanceId: Types.ObjectId,
  ): Promise<InstanceRecord | null> {
    return this.instances.findOne(systemContext(), { _id: instanceId });
  }

  /**
   * 推進到「沒事可做」(一個交易);回最後讀到的實例(實例不存在回 null)。
   *
   * 推進完對這個實例的審核者(現任與被改派走的)送 `badge:apply-center`(底座規格 10.4):
   * 每個入口(送出、決定、改派、撤回、失效 hook、重試推進)都在寫入後呼叫這裡,任務的建立 / 結束 / 改派
   * 都會經過;多送給同一實例其他審核者只是讓他們重抓一次計數。交易內只用 `afterCommit` 登記,
   * 提交後才讀審核者並送出(回復就不送);失敗只記 log。
   */
  advance(instanceId: Types.ObjectId): Promise<InstanceRecord | null> {
    return this.transactions.withTransaction(async () => {
      const instance = await this.runRounds(instanceId);
      const tenantId = instance?.tenantId ?? null;
      if (instance !== null && tenantId !== null) {
        // 交易內只登記;讀審核者與送出都在提交之後(交易回復就不做),不在交易 session 上吞錯誤(TX-04)
        afterCommit(() => this.publishTaskBadges(tenantId, instance._id));
      }
      return instance;
    });
  }

  /** 交易提交後執行,盡力而為:讀審核者或送出失敗只記 log。 */
  private async publishTaskBadges(
    tenantId: Types.ObjectId,
    instanceId: Types.ObjectId,
  ): Promise<void> {
    try {
      const tasks = await this.tasks.findMany(tenantId, { instanceId });
      const reviewers = new Set(
        tasks.flatMap((task) => [
          String(task.assigneeId),
          ...task.previousAssigneeIds.map(String),
        ]),
      );
      if (reviewers.size > 0) {
        await this.realtime.publishBadge(tenantId, APPLY_CENTER_MODULE_KEY, [
          ...reviewers,
        ]);
      }
    } catch (error) {
      this.logger.warn(
        `實例 ${String(instanceId)} 的側欄計數信號沒有送出(盡力而為):${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runRounds(
    instanceId: Types.ObjectId,
  ): Promise<InstanceRecord | null> {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const instance = await this.findInstance(instanceId);
      if (instance === null) {
        return null;
      }
      const definition = await this.definitionOf(instance);
      const plan = await this.planOf(instance, definition);
      if (plan.actions.length === 0) {
        return instance;
      }
      const result = await this.execute(instance, definition, plan.actions);
      if (result === "invalid") {
        return instance;
      }
    }
    this.logger.warn(
      `實例 ${String(instanceId)} 推進超過 ${String(MAX_ROUNDS)} 輪仍未停下,先停止(可由重試推進接續)`,
    );
    return this.findInstance(instanceId);
  }

  /** 這一輪的判斷(不寫入);給「需要推進」的識別用。 */
  async planOf(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
  ): Promise<AdvancePlan> {
    const tenantId = instance.tenantId;
    // 依序讀:可能在交易內,同一個 session 上不平行讀寫(TX-02)
    const tasks =
      tenantId === null
        ? []
        : await this.tasks.findMany(tenantId, { instanceId: instance._id });
    const submission =
      tenantId === null
        ? null
        : await this.submissions.findById(tenantId, instance.submissionId);
    const input: AdvanceInput = {
      definition,
      instance: toInstanceSnapshot(instance),
      tasks: tasks.map((task) => toTaskSnapshot(task)),
      submission: toSubmissionSnapshot(submission),
      now: new Date(),
    };
    const plan = advance(input);
    const [first] = plan.actions;
    if (first?.kind !== "resolveStepEntry") {
      return plan;
    }
    const step = stepOf(definition, first.stepKey);
    if (step === undefined || !isReviewStep(step)) {
      return {
        row: "invalid",
        actions: [
          {
            kind: "invalidState",
            reason: "entering step is not a review step",
            stepKey: first.stepKey,
          },
        ],
      };
    }
    const entry = await this.entries.resolve(instance, step);
    return advance({ ...input, stepEntries: { [first.stepKey]: entry } });
  }

  private async execute(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    actions: readonly AdvanceAction[],
  ): Promise<RoundResult> {
    for (const action of actions) {
      await this.hooks.reached(`action:${action.kind}`);
      const result = await this.apply(instance, definition, action);
      if (result !== "done") {
        return result;
      }
    }
    return "done";
  }

  private async apply(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    action: AdvanceAction,
  ): Promise<RoundResult> {
    const tenantId = instance.tenantId;
    switch (action.kind) {
      case "resolveStepEntry": {
        // 兩段式已在 planOf 處理;走到這裡代表第二次呼叫仍要求解析,當作資料錯誤
        this.logger.error(
          `實例 ${String(instance._id)} 的關卡 ${action.stepKey} 解析後仍要求進關解析`,
        );
        return "invalid";
      }
      case "invalidState": {
        this.logger.error(
          `實例 ${String(instance._id)} 的權威資料自相矛盾(${action.reason};關卡 ${action.stepKey ?? "-"}、任務 ${action.taskKey ?? "-"}),停止推進、等人工處理`,
        );
        return "invalid";
      }
      case "updateInstance": {
        const { update, arrayFilters } = instanceUpdateOf(action.update);
        const updated = await this.instances.findOneAndUpdate(
          systemContext(),
          instanceFilterOf(instance._id, action.condition),
          update,
          arrayFilters.length > 0 ? { arrayFilters } : {},
        );
        if (updated === null) {
          return "casFailed";
        }
        await this.emitStepPassed(instance, definition, action.update);
        return "done";
      }
      case "updateSubmission": {
        const synced = await this.submissions.updateOne(
          tenantId,
          {
            _id: toObjectId(action.condition.submissionId),
            currentInstanceId: toObjectId(action.condition.currentInstanceId),
            revision: action.condition.revision,
            status: action.condition.status,
          },
          { ...action.set },
          null,
        );
        const event =
          action.set.status === undefined
            ? undefined
            : EFFECT_OF_SUBMISSION_STATUS[action.set.status];
        if (synced && event !== undefined) {
          await this.lifecycle.emit(event, effectSubjectOf(instance), {
            stepKey:
              event === "returned" || event === "rejected"
                ? (instance.outcome?.stepKey ?? null)
                : null,
          });
        }
        return "done";
      }
      case "createTask": {
        await this.createTask(instance, action);
        return "done";
      }
      case "syncTask": {
        await this.tasks.updateOne(
          systemContext(),
          tenantId,
          {
            instanceId: instance._id,
            taskKey: action.taskKey,
            status: action.expectedStatus,
          },
          { $set: taskProjectionDocument(action.set) },
        );
        return "done";
      }
      case "notifyTaskCreated": {
        await this.notifier.taskCreated(
          instance,
          definition,
          action.stepKey,
          action.taskKey,
          action.assigneeId,
        );
        return "done";
      }
      case "notifyResult": {
        await this.notifier.result(instance, action.result);
        return "done";
      }
      case "appendHistoryOnce": {
        const { event } = action;
        await this.instances.findOneAndUpdate(
          systemContext(),
          {
            _id: instance._id,
            history: {
              $not: {
                $elemMatch: {
                  kind: event.kind,
                  taskKey: event.taskKey ?? null,
                  result: event.result ?? null,
                },
              },
            },
          },
          { $push: { history: historyEventDocument(event) } },
        );
        return "done";
      }
    }
  }

  /** 這次更新把哪些審核關卡改成完成 / 跳過 → 各觸發一次 `stepPassed`(匯合節點不是關卡,不觸發)。 */
  private async emitStepPassed(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    update: InstanceUpdate,
  ): Promise<void> {
    for (const [stepKey, step] of Object.entries(update.steps ?? {})) {
      const node = stepOf(definition, stepKey);
      if (
        (step.status !== "completed" && step.status !== "skipped") ||
        node === undefined ||
        !isReviewStep(node)
      ) {
        continue;
      }
      await this.lifecycle.emit("stepPassed", effectSubjectOf(instance), {
        stepKey,
        skipped: step.status === "skipped",
      });
    }
  }

  /**
   * 依計畫建任務;`(instanceId, taskKey)` 已存在 = 已建過(推進重跑不重建)。先查再建(TX-04:交易內
   * 撞唯一鍵後不能接著寫)。並發的最終裁決仍是唯一索引:撞到 E11000(不是暫時性錯誤,driver 不會自動重跑)
   * 就讓錯誤往外拋、整個交易回復並回報;並發的推進通常先以寫入衝突重跑,重讀後就查得到已建的任務。
   */
  private async createTask(
    instance: InstanceRecord,
    action: Extract<AdvanceAction, { kind: "createTask" }>,
  ): Promise<void> {
    const existing = await this.tasks.findOne(instance.tenantId, {
      instanceId: instance._id,
      taskKey: action.taskKey,
    });
    if (existing !== null) {
      return;
    }
    await this.tasks.create(systemContext(), instance.tenantId, {
      instanceId: instance._id,
      stepKey: action.stepKey,
      taskKey: action.taskKey,
      submissionId: instance.submissionId,
      revision: instance.revision,
      moduleKey: instance.moduleKey,
      formKey: instance.formKey,
      assigneeId: toObjectId(action.projection.assigneeId),
      previousAssigneeIds: action.projection.previousAssigneeIds.map((id) =>
        toObjectId(id),
      ),
      status: action.projection.status,
      decidedAt: action.projection.decidedAt,
      comment: action.projection.comment,
    });
  }
}

/** 事後動作的單據資訊:實例抄自提交(修訂號 = 實例的修訂號)。 */
function effectSubjectOf(instance: InstanceRecord): EffectSubject {
  return {
    submissionId: instance.submissionId,
    tenantId: instance.tenantId,
    orgId: instance.orgId,
    moduleKey: instance.moduleKey,
    formKey: instance.formKey,
    revision: instance.revision,
  };
}
