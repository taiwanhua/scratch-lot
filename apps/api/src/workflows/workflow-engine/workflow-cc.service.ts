import { Injectable, Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type AssigneeSource,
  type CcEvent,
  type WorkflowDefinition,
  isReviewStep,
  stepOf,
} from "@repo/domain/workflow";

import {
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "../../database/database.module";
import {
  WORKFLOW_CC,
  WORKFLOW_INSTANCE_REF,
} from "../../notifications/base-notification-types";
import { NotificationService } from "../../notifications/notification.service";
import { systemContext } from "../tenant-directory.service";
import { definitionOfVersion } from "../workflow-definition-input";
import { AudienceSourceService } from "./audience-source.service";
import type { InstanceRecord } from "./instance-writes";
import { StepEntryService } from "./step-entry.service";
import { WorkflowNotifier } from "./workflow-notifier.service";

/** 單據層的三種時機(整個流程的知會對象)。 */
export type OutcomeCcEvent = Extract<
  CcEvent,
  "completed" | "rejected" | "voided"
>;

/**
 * 知會(《底座規格》3.9 B17):通知「知會對象」,他們不用審核,之後以「任務持有者」同等規則唯讀該修訂。
 *
 * | 時機                     | 誰收                         | 由誰呼叫                                  |
 * | ------------------------ | ---------------------------- | ----------------------------------------- |
 * | 關卡整關通過 / 被跳過    | 該關的知會對象(`steps[].cc`) | 推進觸發 `stepPassed` 的同一處            |
 * | 單據完成 / 被駁回        | 整個流程的知會對象(`cc`)     | 推進把提交同步成完成 / 駁回的同一處       |
 * | 單據被作廢               | 整個流程的知會對象(`cc`)     | 作廢寫入之後(`FormSubmissionsService`)    |
 *
 * - **與觸發它的動作同一個交易**:通知(`notify()`)與讀取授權的名單(實例 `ccRecipientIds`)都寫進
 *   呼叫端的交易;動作回復 → 沒有知會通知、也讀不到。站內信號在交易提交後才送。
 * - **不重複**:`dedupeKey` = 類型 + 實例 + 時機(關卡的兩種再帶關卡 key);推進只在條件更新真的命中時
 *   呼叫這裡,重試推進不會再呼叫。
 * - 知會對象依**這張單據**算(`AudienceSourceService.resolveAudienceSource`,與審核者同一支):只算
 *   啟用中、仍在本租戶的人;不剔除申請人;算不到人 = 不知會。表單欄位來源指向別張表單(送出時不另檢查)→
 *   當作算不到人並記 log。
 * - 內容只讀實例快照(表單名、標題槽、關卡名),連結到申請中心詳情頁。
 *
 * 交易內的讀寫依序 `await`(TX-02);錯誤照樣往外拋 = 整個動作回復(TX-04)。
 */
@Injectable()
export class WorkflowCcService {
  private readonly logger = new Logger(WorkflowCcService.name);

  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly entries: StepEntryService,
    private readonly sources: AudienceSourceService,
    private readonly notifications: NotificationService,
    private readonly notifier: WorkflowNotifier,
  ) {}

  /** 關卡整關通過(`skipped = false`)或被跳過 → 該關的知會對象。 */
  async stepPassed(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    stepKey: string,
    skipped: boolean,
  ): Promise<void> {
    const step = stepOf(definition, stepKey);
    if (step === undefined || !isReviewStep(step) || !step.cc) {
      return;
    }
    await this.notify(instance, step.cc, {
      event: skipped ? "step-skipped" : "step-passed",
      stepName: step.name,
      dedupeSuffix: `step:${stepKey}`,
    });
  }

  /** 單據完成 / 被駁回 / 被作廢 → 整個流程的知會對象。 */
  async outcome(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    event: OutcomeCcEvent,
  ): Promise<void> {
    if (!definition.cc) {
      return;
    }
    await this.notify(instance, definition.cc, {
      event,
      stepName: null,
      dedupeSuffix: event,
    });
  }

  /** 作廢(不經推進):讀實例與它走的那一版定義,再照 `outcome` 知會。 */
  async voided(instanceId: Types.ObjectId): Promise<void> {
    const instance = await this.instances.findOne(systemContext(), {
      _id: instanceId,
    });
    if (instance === null) {
      return;
    }
    const version = await this.versions.findOne(systemContext(), {
      workflowKey: instance.workflowKey,
      version: instance.workflowVersion,
    });
    if (version === null) {
      this.logger.warn(
        `實例 ${String(instanceId)} 的流程版本 ${instance.workflowKey}@${String(instance.workflowVersion)} 不存在,作廢不知會`,
      );
      return;
    }
    await this.outcome(instance, definitionOfVersion(version), "voided");
  }

  private async notify(
    instance: InstanceRecord,
    source: AssigneeSource,
    message: { event: CcEvent; stepName: string | null; dedupeSuffix: string },
  ): Promise<void> {
    const recipientIds = await this.recipientsOf(instance, source);
    if (recipientIds.length === 0) {
      return;
    }
    // 先記讀取授權的名單,再寫通知:兩者同一個交易,回復時一起消失
    await this.instances.findOneAndUpdate(
      systemContext(),
      { _id: instance._id },
      { $addToSet: { ccRecipientIds: { $each: recipientIds } } },
    );
    await this.notifications.notify({
      type: WORKFLOW_CC,
      tenantId: instance.tenantId,
      orgId: instance.orgId,
      recipients: { kind: "users", userIds: recipientIds },
      params: {
        subject: await this.notifier.subjectOf(instance),
        event: message.event,
        stepName: message.stepName,
      },
      ref: { type: WORKFLOW_INSTANCE_REF, id: String(instance._id) },
      dedupeKey: `${WORKFLOW_CC}:${String(instance._id)}:${message.dedupeSuffix}`,
    });
  }

  /** 依這張單據(實例的修訂)算知會對象。 */
  private async recipientsOf(
    instance: InstanceRecord,
    source: AssigneeSource,
  ): Promise<Types.ObjectId[]> {
    if (source.kind === "field" && source.formKey !== instance.formKey) {
      this.logger.warn(
        `實例 ${String(instance._id)} 的知會對象欄位屬於表單 ${source.formKey},不是 ${instance.formKey},不知會`,
      );
      return [];
    }
    const context = await this.entries.submissionContextOf(instance);
    return context === null
      ? []
      : this.sources.resolveAudienceSource(source, context);
  }
}
