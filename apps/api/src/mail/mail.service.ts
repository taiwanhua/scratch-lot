import { Logger } from "@nestjs/common";

import { assertOutsideTransaction } from "../database/transaction";
import {
  buildActivationEmail,
  buildPasswordResetEmail,
  buildWorkflowResultEmail,
  buildWorkflowTaskEmail,
} from "./mail-templates";
import type { MailConfig } from "./mail.config";

export type MailKind =
  "activation" | "password-reset" | "workflow-task" | "workflow-result";

/** 啟用信 / 重設信共用的輸入:收件人、稱呼、「設定新密碼」頁連結(含 token)、連結到期時間。 */
export interface ActionEmailInput {
  to: string;
  name: string;
  link: string;
  expiresAt: Date;
}

/** 審核任務通知(給審核者):表單名、實例快照的標題槽、關卡名、申請中心詳情頁連結。 */
export interface WorkflowTaskEmailInput {
  to: string;
  name: string;
  formName: string;
  title: string | null;
  stepName: string;
  link: string;
}

/** 審核結果通知(給申請人):核准 / 駁回 / 退回;駁回 / 退回附理由。 */
export interface WorkflowResultEmailInput {
  to: string;
  name: string;
  formName: string;
  title: string | null;
  result: "approved" | "rejected" | "returned";
  comment: string | null;
  link: string;
}

/** 模板產出、交給 adapter 投遞的一封信。 */
export interface MailMessage {
  kind: MailKind;
  to: string;
  link: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * 寄信介面(ADR-0010):呼叫端只認 `sendActivationEmail` / `sendPasswordResetEmail` / 審核流程的兩封通知;
 * 模板與收件白名單在此共用,供應商只是 `deliver` 的 adapter(Resend 是第一個;測試 / 本地用記錄用 adapter)。
 * 亦為 Nest 的注入 token(MailModule 依 RESEND_API_KEY 有無決定實作)。
 */
export abstract class MailService {
  /** 以實際 adapter 的類別名為 log 前綴(RecordingMailService / ResendMailService)。 */
  protected readonly logger: Logger;

  constructor(protected readonly config: MailConfig) {
    this.logger = new Logger(new.target.name);
  }

  sendActivationEmail(input: ActionEmailInput): Promise<void> {
    return this.send(buildActivationEmail(input));
  }

  sendPasswordResetEmail(input: ActionEmailInput): Promise<void> {
    return this.send(buildPasswordResetEmail(input));
  }

  /** 審核流程:有新任務(Spec 6b §7;是否寄由 `WORKFLOW_MAIL_ENABLED` 在呼叫端決定)。 */
  sendWorkflowTaskEmail(input: WorkflowTaskEmailInput): Promise<void> {
    return this.send(buildWorkflowTaskEmail(input));
  }

  /** 審核流程:申請有結果(核准 / 駁回 / 退回)。 */
  sendWorkflowResultEmail(input: WorkflowResultEmailInput): Promise<void> {
    return this.send(buildWorkflowResultEmail(input));
  }

  /** 實際投遞一封信;失敗即拋錯。 */
  protected abstract deliver(message: MailMessage): Promise<void>;

  /** 白名單有值時只寄名單內(dev / staging 防誤寄真人);名單外靜默略過、不視為錯誤。 */
  private async send(message: MailMessage): Promise<void> {
    // 交易可能自動重試或回復,信寄出去就收不回來:一律排到交易成功之後(afterCommit)
    assertOutsideTransaction("寄信");
    if (!isRecipientAllowed(this.config.allowlist, message.to)) {
      this.logger.warn(
        `收件人 ${message.to} 不在 MAIL_ALLOWLIST 內,略過 ${message.kind} 信`,
      );
      return;
    }
    await this.deliver(message);
  }
}

export function isRecipientAllowed(allowlist: string[], to: string): boolean {
  return allowlist.length === 0 || allowlist.includes(to.trim().toLowerCase());
}
