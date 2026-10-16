import { Logger } from "@nestjs/common";

import { assertOutsideTransaction } from "../database/transaction";
import {
  buildActivationEmail,
  buildNotificationEmail,
  buildPasswordResetEmail,
} from "./mail-templates";
import type { MailConfig } from "./mail.config";

export type MailKind = "activation" | "password-reset" | "notification";

/** 啟用信 / 重設信共用的輸入:收件人、稱呼、「設定新密碼」頁連結(含 token)、連結到期時間。 */
export interface ActionEmailInput {
  to: string;
  name: string;
  link: string;
  expiresAt: Date;
}

/**
 * 通知信(底座規格第 5 章;email 管道):標題 / 內容由通知類型的範本產生(與站內通知同一份),
 * 連結是通知的連結登記換成的完整網址;沒有連結 = null。
 */
export interface NotificationEmailInput {
  to: string;
  name: string;
  /** 通知類型 key(例 `workflow.result`) */
  notificationType: string;
  title: string;
  body: string;
  link: string | null;
  /** 收件人的語言(個人偏好 `locale`);決定問候語、連結說明與署名的語系,沒有或認不得 = 繁中 */
  locale: string | null;
}

/** 模板產出、交給 adapter 投遞的一封信。 */
export interface MailMessage {
  kind: MailKind;
  /** 通知信才有:通知類型 key */
  notificationType?: string;
  to: string;
  /** 信裡的連結;通知信沒有連結時為 null */
  link: string | null;
  subject: string;
  text: string;
  html: string;
}

/**
 * 寄信介面(ADR-0010):呼叫端只認 `sendActivationEmail` / `sendPasswordResetEmail` / `sendNotificationEmail`;
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

  /** 通知信(通知的 email 管道;是否寄由總開關 `WORKFLOW_MAIL_ENABLED` 在呼叫端決定)。 */
  sendNotificationEmail(input: NotificationEmailInput): Promise<void> {
    return this.send(buildNotificationEmail(input));
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
