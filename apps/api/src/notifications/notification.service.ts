import { Inject, Injectable, Logger } from "@nestjs/common";
import { Types } from "mongoose";

import type {
  Audience,
  AudienceLeaf,
  AudienceNode,
} from "@repo/domain/audience";

import {
  type AudienceContext,
  AudienceService,
} from "../audience/audience.service";
import {
  NotificationSettingsRepository,
  NotificationsRepository,
  UserPreferencesRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { TransactionService, afterCommit } from "../database/transaction";
import { LOCALE_PREFERENCE_KEY } from "../user-preferences/user-preference-registry";
import {
  NOTIFICATION_CHANNEL_ADAPTERS,
  type NotificationChannelAdapter,
  type NotificationDelivery,
} from "./notification-channels";
import {
  IN_APP_CHANNEL,
  type NotificationLinkRegistration,
  type NotificationParams,
  type NotificationTypeDefinition,
  notificationLinkOf,
  notificationPreferenceKey,
  templateFor,
} from "./notification-registry";
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
} from "./notification-registry.module";

/**
 * 收件人:指定使用者,或人員條件(「列出符合的人」那種用法)。
 * 只有當事人通知要給;負責人提醒的收件人由類型宣告的組織範圍 × 通知設定的人員條件決定,呼叫端不給。
 */
export type NotificationRecipients =
  | { kind: "users"; userIds: readonly (Types.ObjectId | string)[] }
  | { kind: "audience"; audience: Audience; context?: AudienceContext };

export interface NotifyInput {
  /** 通知類型 key(必須已登記) */
  type: string;
  /** 事件所在的租戶頂層 id(根組織 = null);即時信號送到這個租戶,負責人提醒依它找通知設定 */
  tenantId: Types.ObjectId | null;
  /** 事件所在的組織(負責人提醒的組織範圍從它起算) */
  orgId: Types.ObjectId;
  /** 當事人通知必填;負責人提醒不給 */
  recipients?: NotificationRecipients;
  /** 範本參數 */
  params?: NotificationParams;
  /** 連結目標(`refType` 經連結登記表換成頁面路由);沒有連結不給 */
  ref?: { type: string; id: string };
  /** 防重複:同一位收件人、同一個 key 只通知一次 */
  dedupeKey: string;
}

/** 讀寫通知、偏好、使用者、通知設定用的上下文:這幾張都不掛 tenantScope,範圍放開只為了讓 BaseRepository 收得到上下文。 */
const NOTIFICATION_SYSTEM: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

/** 一位收件人這次要送的內容與管道。 */
interface PlannedDelivery {
  recipientId: Types.ObjectId;
  channels: string[];
  title: string;
  body: string;
  /** 收件人的語言(個人偏好;沒有設定 = null) */
  locale: string | null;
}

/**
 * 通知的單一入口:業務程式碼(流程引擎、專案)只呼叫 `notify()`。
 *
 * 1. 查類型登記表 → 2. 解析收件人 → 3. 查收件人偏好(每種類型 × 每個管道的開關;`canDisable` 為否的管道一律開)
 * → 4. 在**交易內**寫 `notifications`(同一位收件人、同一個 `dedupeKey` 已有就整個略過:不寫、不送信號、不寄信;
 *    去重一次查、新的一次 `createMany`,TX-06)
 * → 5. 交易提交後依管道交給轉接器:站內 = 一次送出 `notification` 信號,email = 寄信。
 *
 * 呼叫端已在交易內時就併進呼叫端的交易(動作回復 → 沒有通知、沒有信號、沒有信);不在交易內時自己開一個。
 * 寫入失敗會讓整個交易回復(通知與觸發它的動作同生共死);交易後的送出則盡力而為,失敗只記 log。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_TYPES)
    private readonly types: ReadonlyMap<string, NotificationTypeDefinition>,
    @Inject(NOTIFICATION_LINKS)
    private readonly links: ReadonlyMap<string, NotificationLinkRegistration>,
    @Inject(NOTIFICATION_CHANNEL_ADAPTERS)
    private readonly adapters: readonly NotificationChannelAdapter[],
    private readonly notifications: NotificationsRepository,
    private readonly settings: NotificationSettingsRepository,
    private readonly preferences: UserPreferencesRepository,
    private readonly users: UsersRepository,
    private readonly audiences: AudienceService,
    private readonly transactions: TransactionService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const type = this.typeOf(input);
    await this.transactions.withTransaction(async () => {
      const recipientIds = await this.resolveRecipients(type, input);
      if (recipientIds.length === 0) {
        return;
      }
      const planned = await this.plan(type, input, recipientIds);
      const deliveries = new Map<string, NotificationDelivery[]>();
      const path = notificationLinkOf(
        this.links,
        input.ref?.type ?? null,
        input.ref?.id ?? null,
      );
      if (planned.length === 0) {
        return;
      }
      // 去重一次查、新的一次寫,收件人多寡不影響指令數(TX-06;交易內依序,TX-02)
      const existing = await this.notifications.findMany(
        NOTIFICATION_SYSTEM,
        {
          recipientId: { $in: planned.map((item) => item.recipientId) },
          dedupeKey: input.dedupeKey,
        },
        { includeDeleted: true, select: "recipientId" },
      );
      const notified = new Set(existing.map((row) => String(row.recipientId)));
      const fresh = planned.filter(
        (item) => !notified.has(String(item.recipientId)),
      );
      if (fresh.length === 0) {
        return;
      }
      const created = await this.notifications.createMany(
        NOTIFICATION_SYSTEM,
        fresh.map((item) => ({
          tenantId: input.tenantId,
          orgId: input.orgId,
          recipientId: item.recipientId,
          type: type.key,
          title: item.title,
          body: item.body,
          refType: input.ref?.type ?? null,
          refId: input.ref?.id ?? null,
          dedupeKey: input.dedupeKey,
          channels: item.channels,
          readAt: null,
        })),
      );
      const localeOf = new Map(
        fresh.map((item) => [String(item.recipientId), item.locale]),
      );
      for (const row of created) {
        for (const channel of row.channels) {
          const list = deliveries.get(channel) ?? [];
          list.push({
            notificationId: row._id,
            type: type.key,
            recipientId: row.recipientId,
            title: row.title,
            body: row.body,
            path,
            locale: localeOf.get(String(row.recipientId)) ?? null,
          });
          deliveries.set(channel, list);
        }
      }
      for (const adapter of this.adapters) {
        const batch = deliveries.get(adapter.channel);
        if (batch === undefined || batch.length === 0) {
          continue;
        }
        afterCommit(() => this.deliver(adapter, input.tenantId, batch));
      }
    });
  }

  /** 交易後交給轉接器;轉接器漏接的錯誤也只記 log。 */
  private async deliver(
    adapter: NotificationChannelAdapter,
    tenantId: Types.ObjectId | null,
    batch: readonly NotificationDelivery[],
  ): Promise<void> {
    try {
      await adapter.deliver(tenantId, batch);
    } catch (error) {
      this.logger.warn(
        `通知管道 ${adapter.channel} 送出失敗(盡力而為,不影響觸發它的動作):${String(error)}`,
      );
    }
  }

  private typeOf(input: NotifyInput): NotificationTypeDefinition {
    const type = this.types.get(input.type);
    if (type === undefined) {
      throw new Error(`通知類型「${input.type}」沒有登記`);
    }
    if (type.category === "party" && input.recipients === undefined) {
      throw new Error(`通知類型「${type.key}」是當事人通知,要給 recipients`);
    }
    if (type.category === "responsible" && input.recipients !== undefined) {
      throw new Error(
        `通知類型「${type.key}」是負責人提醒,收件人由通知設定決定,不能給 recipients`,
      );
    }
    return type;
  }

  /** 收件人:去重後的啟用中使用者。 */
  private async resolveRecipients(
    type: NotificationTypeDefinition,
    input: NotifyInput,
  ): Promise<Types.ObjectId[]> {
    let candidates: Types.ObjectId[];
    if (input.recipients === undefined) {
      candidates = await this.responsibleRecipients(type, input);
    } else if (input.recipients.kind === "users") {
      candidates = input.recipients.userIds
        .map(String)
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    } else {
      if (input.tenantId === null) {
        this.logger.warn(
          `通知「${type.key}」以人員條件找收件人,但事件不在任何租戶內,略過`,
        );
        return [];
      }
      candidates = await this.audiences.listAudience(
        input.tenantId,
        input.recipients.audience,
        input.recipients.context,
      );
    }
    const unique = [...new Set(candidates.map(String))].map(
      (id) => new Types.ObjectId(id),
    );
    if (unique.length === 0) {
      return [];
    }
    const enabled = await this.users.findMany(
      NOTIFICATION_SYSTEM,
      { _id: { $in: unique }, enabled: true },
      { select: "_id" },
    );
    const enabledIds = new Set(enabled.map((user) => String(user._id)));
    return unique.filter((id) => enabledIds.has(String(id)));
  }

  /**
   * 負責人提醒:類型宣告的組織範圍 **且** 符合人員條件(租戶在通知設定調整過就用調整後的,
   * 沒有或還原預設就用類型宣告的預設)。每次觸發都重讀設定,所以調整後的下一次就依新條件。
   */
  private async responsibleRecipients(
    type: NotificationTypeDefinition,
    input: NotifyInput,
  ): Promise<Types.ObjectId[]> {
    const { orgScope, defaultAudience } = type;
    if (orgScope === undefined || defaultAudience === undefined) {
      return [];
    }
    const tenantId = input.tenantId;
    if (tenantId === null) {
      this.logger.warn(
        `負責人提醒「${type.key}」的事件不在任何租戶內(根組織),沒有通知設定可用,略過`,
      );
      return [];
    }
    const setting = await this.settings.findOne(NOTIFICATION_SYSTEM, {
      tenantId,
      type: type.key,
    });
    const audience = setting?.audience ?? defaultAudience;
    if (audience.mode !== "match") {
      return [];
    }
    const scope: AudienceLeaf = {
      field: "org",
      cond: "in",
      value: { kind: "dynamic", ref: orgScope.ref },
      range: orgScope.range,
    };
    const filter: AudienceNode = {
      op: "AND",
      children: [scope, audience.filter],
    };
    return this.audiences.listAudience(
      tenantId,
      { mode: "match", filter },
      {
        resolveRef: (ref) => {
          if (ref === "event-org") {
            return [input.orgId];
          }
          return ref === "tenant" ? [tenantId] : [];
        },
      },
    );
  }

  /** 讀收件人的偏好,決定每個人的管道與(依語言產生的)標題 / 內容;所有管道都關的人不送。 */
  private async plan(
    type: NotificationTypeDefinition,
    input: NotifyInput,
    recipientIds: readonly Types.ObjectId[],
  ): Promise<PlannedDelivery[]> {
    const stored = await this.preferences.findMany(NOTIFICATION_SYSTEM, {
      userId: { $in: [...recipientIds] },
    });
    const settingsOf = new Map(
      stored.map((document) => [String(document.userId), document.settings]),
    );
    const planned: PlannedDelivery[] = [];
    for (const recipientId of recipientIds) {
      const settings = settingsOf.get(String(recipientId)) ?? {};
      const channels = type.defaultChannels.filter(
        (channel) =>
          type.canDisable[channel] === false ||
          settings[notificationPreferenceKey(type.key, channel)] !== false,
      );
      if (channels.length === 0) {
        continue;
      }
      const stored = settings[LOCALE_PREFERENCE_KEY];
      const locale = typeof stored === "string" ? stored : null;
      const content = templateFor(type, locale)(input.params ?? {});
      planned.push({ recipientId, channels, locale, ...content });
    }
    return planned;
  }
}

/** 通知清單 / 未讀數只算站內通知(收件人關掉站內的那幾則只為去重而存)。 */
export const IN_APP_FILTER = { channels: IN_APP_CHANNEL } as const;
