import { Injectable } from "@nestjs/common";

import {
  type NotifiedResult,
  type WorkflowDefinition,
  stepOf,
} from "@repo/domain/workflow";

import { FormsRepository } from "../../database/database.module";
import {
  WORKFLOW_INSTANCE_REF,
  WORKFLOW_RESULT,
  WORKFLOW_TASK_CREATED,
} from "../../notifications/base-notification-types";
import { NotificationService } from "../../notifications/notification.service";
import { systemContext } from "../tenant-directory.service";
import type { InstanceRecord } from "./instance-writes";

/**
 * 審核流程的通知(Spec 6b §7;底座規格第 5 章):任務建立(`workflow.task-created`,給審核者)、
 * 有結果(`workflow.result`:核准 / 駁回 / 退回,給申請人)。站內與 email 都由 `notify()` 這一個入口產生。
 *
 * - **與推進同一個交易**:推進在交易內呼叫這裡,通知寫進同一個交易;交易回復(含被自動重試丟掉的那一輪)
 *   就沒有通知、沒有信號、沒有信。站內信號與 email 在交易提交後才送。
 * - **不重複**:`dedupeKey` = 類型 + 實例 + 任務 / 結果(同一位收件人只會有一則);引擎另在同一個交易追加
 *   歷程標記(任務 `task_created`、結果 `notified`),重試推進看標記不會再呼叫這裡。
 * - **盡力通知**:email 依收件人的偏好與總開關 `WORKFLOW_MAIL_ENABLED`,寄信失敗只記 log、不影響推進。
 * - 內容只讀**實例快照**(表單名、實例上的標題槽、關卡名),不讀提交最新的摘要;連結到申請中心詳情頁。
 */
@Injectable()
export class WorkflowNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly forms: FormsRepository,
  ) {}

  /** 任務建立通知(給這個任務的審核者)。 */
  async taskCreated(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    stepKey: string,
    taskKey: string,
    assigneeId: string,
  ): Promise<void> {
    await this.notifications.notify({
      type: WORKFLOW_TASK_CREATED,
      tenantId: instance.tenantId,
      orgId: instance.orgId,
      recipients: { kind: "users", userIds: [assigneeId] },
      params: {
        subject: await this.subjectOf(instance),
        stepName: stepOf(definition, stepKey)?.name ?? stepKey,
      },
      ref: { type: WORKFLOW_INSTANCE_REF, id: String(instance._id) },
      dedupeKey: `${WORKFLOW_TASK_CREATED}:${String(instance._id)}:${taskKey}`,
    });
  }

  /** 結果通知(給申請人);駁回 / 退回附理由。 */
  async result(
    instance: InstanceRecord,
    result: NotifiedResult,
  ): Promise<void> {
    if (instance.createdBy === null) {
      return;
    }
    await this.notifications.notify({
      type: WORKFLOW_RESULT,
      tenantId: instance.tenantId,
      orgId: instance.orgId,
      recipients: { kind: "users", userIds: [instance.createdBy] },
      params: {
        subject: await this.subjectOf(instance),
        result,
        comment: result === "approved" ? null : outcomeCommentOf(instance),
      },
      ref: { type: WORKFLOW_INSTANCE_REF, id: String(instance._id) },
      dedupeKey: `${WORKFLOW_RESULT}:${String(instance._id)}:${result}`,
    });
  }

  /** 「表單名:標題」(實例快照沒有標題時只有表單名);知會與逾時提醒共用。 */
  async subjectOf(instance: InstanceRecord): Promise<string> {
    const form = await this.forms.findOne(systemContext(), {
      key: instance.formKey,
    });
    const formName = form?.name ?? instance.formKey;
    const title = instance.summary?.title ?? null;
    return title ? `${formName}:${title}` : formName;
  }
}

/** 全案終局那一筆決定的理由(駁回 / 退回必填)。 */
function outcomeCommentOf(instance: InstanceRecord): string | null {
  const outcome = instance.outcome;
  if (outcome === null) {
    return null;
  }
  const step = instance.steps.find(
    (state) => state.stepKey === outcome.stepKey,
  );
  return (
    step?.decisions.find((decision) => decision.taskKey === outcome.taskKey)
      ?.comment ?? null
  );
}
