import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Types } from "mongoose";

import {
  type NotifiedResult,
  type WorkflowDefinition,
  stepOf,
} from "@repo/domain/workflow";

import {
  FormsRepository,
  UsersRepository,
} from "../../database/database.module";
import { afterCommit } from "../../database/transaction";
import { MailService } from "../../mail/mail.service";
import { systemContext } from "../tenant-directory.service";
import type { InstanceRecord } from "./instance-writes";

/** 本地 admin 的 dev server(同 `auth/password/password.config.ts` 的預設)。 */
const DEFAULT_ADMIN_APP_URL = "http://localhost:3001";

/**
 * 審核流程的通知信(Spec 6b §7「通知信」):任務建立(給審核者)、有結果(核准 / 駁回 / 退回,給申請人)。
 *
 * - 開關 `WORKFLOW_MAIL_ENABLED`(普通 env,預設關;`docs/env-registry.md`):**每次登記寄信時讀**,
 *   關閉時只寫 log。收件人仍受既有 `MAIL_ALLOWLIST` 約束(`MailService` 那一層)。
 * - **交易內登記、提交後寄**:推進在交易內呼叫這裡,只把寄信登記到交易提交之後(`afterCommit`,TX-03);
 *   引擎接著在同一個交易追加歷程標記(任務信 `task_created`、結果信 `notified`)。交易回復(含被自動重試
 *   丟掉的那一輪)就不寄、標記也不存在。收件人與表單名在提交後才讀。
 * - **盡力通知**:寄信失敗只記 log、不影響推進,歷程**仍記為已通知**;重試推進看標記不重寄,
 *   所以不保證恰好一次、也不保證一定寄達。
 * - 內容只讀**實例快照**(表單名、實例上的標題槽、關卡名),不讀提交最新的摘要;
 *   連結到申請中心詳情頁 `<ADMIN_APP_URL>/apply-center/view-page/<實例 id>`。
 */
@Injectable()
export class WorkflowNotifier {
  private readonly logger = new Logger(WorkflowNotifier.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly users: UsersRepository,
    private readonly forms: FormsRepository,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>("WORKFLOW_MAIL_ENABLED") === "true";
  }

  /** 任務建立通知(排到目前交易提交後寄)。 */
  taskCreated(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    stepKey: string,
    assigneeId: string,
  ): void {
    const label = `任務通知(實例 ${String(instance._id)}、關卡 ${stepKey}、審核者 ${assigneeId})`;
    if (!this.isEnabled()) {
      this.logger.log(`WORKFLOW_MAIL_ENABLED 未開啟,不寄${label}`);
      return;
    }
    afterCommit(() =>
      this.sendTaskCreated(label, instance, definition, stepKey, assigneeId),
    );
  }

  /** 結果通知(排到目前交易提交後寄)。 */
  result(instance: InstanceRecord, result: NotifiedResult): void {
    const label = `結果通知(實例 ${String(instance._id)}、${result})`;
    if (!this.isEnabled()) {
      this.logger.log(`WORKFLOW_MAIL_ENABLED 未開啟,不寄${label}`);
      return;
    }
    afterCommit(() => this.sendResult(label, instance, result));
  }

  private async sendTaskCreated(
    label: string,
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    stepKey: string,
    assigneeId: string,
  ): Promise<void> {
    try {
      const recipient = await this.recipientOf(assigneeId);
      if (recipient === null) {
        this.logger.warn(`${label}:收件人不存在或沒有信箱,略過`);
        return;
      }
      await this.mail.sendWorkflowTaskEmail({
        ...recipient,
        formName: await this.formNameOf(instance.formKey),
        title: instance.summary?.title ?? null,
        stepName: stepOf(definition, stepKey)?.name ?? stepKey,
        link: this.linkOf(instance),
      });
    } catch (error) {
      this.logger.warn(
        `${label}寄送失敗(盡力通知,不影響推進):${String(error)}`,
      );
    }
  }

  private async sendResult(
    label: string,
    instance: InstanceRecord,
    result: NotifiedResult,
  ): Promise<void> {
    try {
      const recipient =
        instance.createdBy === null
          ? null
          : await this.recipientOf(String(instance.createdBy));
      if (recipient === null) {
        this.logger.warn(`${label}:申請人不存在或沒有信箱,略過`);
        return;
      }
      await this.mail.sendWorkflowResultEmail({
        ...recipient,
        formName: await this.formNameOf(instance.formKey),
        title: instance.summary?.title ?? null,
        result,
        comment: result === "approved" ? null : outcomeCommentOf(instance),
        link: this.linkOf(instance),
      });
    } catch (error) {
      this.logger.warn(
        `${label}寄送失敗(盡力通知,不影響推進):${String(error)}`,
      );
    }
  }

  private async recipientOf(
    userId: string,
  ): Promise<{ to: string; name: string } | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    const user = await this.users.findById(systemContext(), userId);
    if (!user || user.email === "") {
      return null;
    }
    return { to: user.email, name: user.name };
  }

  private async formNameOf(formKey: string): Promise<string> {
    const form = await this.forms.findOne(systemContext(), { key: formKey });
    return form?.name ?? formKey;
  }

  private linkOf(instance: InstanceRecord): string {
    const configured = this.config.get<string>("ADMIN_APP_URL")?.trim() ?? "";
    let base = configured === "" ? DEFAULT_ADMIN_APP_URL : configured;
    while (base.endsWith("/")) {
      base = base.slice(0, -1);
    }
    return `${base}/apply-center/view-page/${String(instance._id)}`;
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
