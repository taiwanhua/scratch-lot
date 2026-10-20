import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Types } from "mongoose";

import { userTopic } from "@repo/domain/realtime";

import { UsersRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { MailService } from "../mail/mail.service";
import { RealtimePublisher } from "../realtime/realtime-publisher.service";
import {
  EMAIL_CHANNEL,
  IN_APP_CHANNEL,
  NOTIFICATION_CHANNELS,
} from "./notification-registry";

/** 本地 admin 的 dev server(同 `auth/password/password.config.ts` 的預設)。 */
const DEFAULT_ADMIN_APP_URL = "http://localhost:3001";

/** 通知信的總開關(「開關三層」的環境層;`docs/env-registry.md`)。 */
export const NOTIFICATION_MAIL_SWITCH = "WORKFLOW_MAIL_ENABLED";

/** 交給管道轉接器的一則(交易已提交、`notifications` 已寫入之後)。 */
export interface NotificationDelivery {
  /** `notifications._id` */
  readonly notificationId: Types.ObjectId;
  readonly type: string;
  readonly recipientId: Types.ObjectId;
  readonly title: string;
  readonly body: string;
  /** admin 站內路徑(連結登記表找到的);沒有連結 = null */
  readonly path: string | null;
  /** 收件人的語言(個人偏好 `locale`;沒有設定 = null),email 外框依它 */
  readonly locale: string | null;
}

/**
 * 管道轉接器:`notify()` 在交易**提交後**把該管道的這批交給 `deliver`。
 * 盡力而為:轉接器自己吞掉並記錄失敗,不讓錯誤影響觸發它的動作(那個動作早已提交)。
 */
export interface NotificationChannelAdapter {
  readonly channel: string;
  deliver(
    tenantId: Types.ObjectId | null,
    deliveries: readonly NotificationDelivery[],
  ): Promise<void>;
}

/** 所有管道轉接器(一個管道一個;與 `NOTIFICATION_CHANNELS` 一一對應)的 DI token。 */
export const NOTIFICATION_CHANNEL_ADAPTERS = Symbol(
  "NOTIFICATION_CHANNEL_ADAPTERS",
);

/** 轉接器與已登記的管道必須一一對應;少一個或多一個都讓 app 起不來。 */
export function assertChannelAdapters(
  adapters: readonly NotificationChannelAdapter[],
): readonly NotificationChannelAdapter[] {
  const channels = adapters
    .map((adapter) => adapter.channel)
    .toSorted((a, b) => a.localeCompare(b));
  const expected = [...NOTIFICATION_CHANNELS].toSorted((a, b) =>
    a.localeCompare(b),
  );
  if (channels.join(",") !== expected.join(",")) {
    throw new Error(
      `通知管道轉接器(${channels.join(", ")})與已登記的管道(${expected.join(", ")})對不上`,
    );
  }
  return adapters;
}

/** 讀收件人帳號(email、稱呼)用的上下文:users 不掛 tenantScope,範圍放開只為了讓 BaseRepository 收得到上下文。 */
const RECIPIENT_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

/**
 * 站內通知:`notifications` 已在交易內寫好,這裡只對收件人一次送出 `notification` 信號
 * (`user:<id>` 頻道,不合併;前端收到後重抓未讀數與清單)。
 */
@Injectable()
export class InAppChannelAdapter implements NotificationChannelAdapter {
  readonly channel = IN_APP_CHANNEL;

  constructor(private readonly realtime: RealtimePublisher) {}

  async deliver(
    tenantId: Types.ObjectId | null,
    deliveries: readonly NotificationDelivery[],
  ): Promise<void> {
    const topics = deliveries.map((delivery) =>
      userTopic(String(delivery.recipientId)),
    );
    // publish 本身盡力而為(Worker 失敗只記 log)
    await this.realtime.publish(tenantId, topics, { type: "notification" });
  }
}

/**
 * email:依通知的標題 / 內容寄給收件人的信箱,連結 = `ADMIN_APP_URL` + 站內路徑。
 * 總開關 `WORKFLOW_MAIL_ENABLED` 不是 `"true"` 時只寫 log(**每次寄送時讀**);收件人仍受 `MAIL_ALLOWLIST`
 * 約束(`MailService` 那一層)。寄信失敗只記 log,不影響觸發它的動作。
 */
@Injectable()
export class EmailChannelAdapter implements NotificationChannelAdapter {
  readonly channel = EMAIL_CHANNEL;
  private readonly logger = new Logger(EmailChannelAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly users: UsersRepository,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>(NOTIFICATION_MAIL_SWITCH) === "true";
  }

  async deliver(
    _tenantId: Types.ObjectId | null,
    deliveries: readonly NotificationDelivery[],
  ): Promise<void> {
    for (const delivery of deliveries) {
      const label = `通知信(${delivery.type}、收件人 ${String(delivery.recipientId)})`;
      if (!this.isEnabled()) {
        this.logger.log(`${NOTIFICATION_MAIL_SWITCH} 未開啟,不寄${label}`);
        continue;
      }
      try {
        const user = await this.users.findById(
          RECIPIENT_READER,
          delivery.recipientId,
        );
        if (!user || user.email === "") {
          this.logger.warn(`${label}:收件人不存在或沒有信箱,略過`);
          continue;
        }
        await this.mail.sendNotificationEmail({
          to: user.email,
          name: user.name,
          notificationType: delivery.type,
          title: delivery.title,
          body: delivery.body,
          link: delivery.path === null ? null : this.absoluteUrl(delivery.path),
          locale: delivery.locale,
        });
      } catch (error) {
        this.logger.warn(
          `${label}寄送失敗(盡力通知,不影響觸發它的動作):${String(error)}`,
        );
      }
    }
  }

  private absoluteUrl(path: string): string {
    const configured = this.config.get<string>("ADMIN_APP_URL")?.trim() ?? "";
    let base = configured === "" ? DEFAULT_ADMIN_APP_URL : configured;
    while (base.endsWith("/")) {
      base = base.slice(0, -1);
    }
    return `${base}${path}`;
  }
}
