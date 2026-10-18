import { type MailMessage, MailService } from "./mail.service";

/**
 * 記錄用 adapter:不真寄出,把每封信記在 `sent` 並印到 stdout —
 * 測試從中讀出連結裡的 token 走下一步;本地開發沒有 RESEND_API_KEY 時也用它(從 log 拿連結)。
 */
export class RecordingMailService extends MailService {
  readonly sent: MailMessage[] = [];

  protected override deliver(message: MailMessage): Promise<void> {
    this.sent.push(message);
    this.logger.log(
      `[記錄用 adapter,未真寄出] ${message.kind} → ${message.to}\n主旨:${message.subject}\n連結:${message.link ?? "(無)"}`,
    );
    return Promise.resolve();
  }
}
