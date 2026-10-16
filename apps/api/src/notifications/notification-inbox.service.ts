import { Inject, Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import {
  type NotificationDocument,
  NotificationsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { UserPreferencesService } from "../user-preferences/user-preferences.service";
import {
  type NotificationLinkRegistration,
  type NotificationTypeDefinition,
  notificationLinkOf,
  notificationPreferenceKey,
} from "./notification-registry";
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
} from "./notification-registry.module";
import { IN_APP_FILTER } from "./notification.service";

/** 清單每頁上限(GQL-03)。 */
const MAX_PAGE_SIZE = 100;

export interface NotificationListItem {
  id: string;
  type: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  /** 連結登記表換成的 admin 站內路徑;沒有連結 = null */
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationTypePreferenceItem {
  type: string;
  name: string;
  channels: {
    channel: string;
    preferenceKey: string;
    enabled: boolean;
    canDisable: boolean;
  }[];
}

export interface NotificationPage {
  items: NotificationListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  unreadCount: number;
}

/**
 * 自己的通知清單(底座規格第 5 章「通知鈴與通知清單」):只讀寫**自己的**(身分取自登入,不收 userId),
 * 與目前組織無關;只列站內通知,依時間新到舊。所有登入者都能用,不經模組權限(同個人偏好)。
 */
@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly notifications: NotificationsRepository,
    @Inject(NOTIFICATION_LINKS)
    private readonly links: ReadonlyMap<string, NotificationLinkRegistration>,
    @Inject(NOTIFICATION_TYPES)
    private readonly types: ReadonlyMap<string, NotificationTypeDefinition>,
    private readonly preferences: UserPreferencesService,
  ) {}

  /**
   * 個人設定「偏好」分頁的管道開關:每種類型 × 每個 `defaultChannels` 一個開關,值讀自己的個人偏好
   * (`notification_<類型>_<管道>`,沒設過 = 開);`canDisable` 為否的一律開、不能關。
   */
  async myPreferences(
    operator: OperatorContext,
  ): Promise<NotificationTypePreferenceItem[]> {
    const settings = await this.preferences.mine(operator);
    return [...this.types.values()].map((type) => ({
      type: type.key,
      name: type.name,
      channels: type.defaultChannels.map((channel) => {
        const preferenceKey = notificationPreferenceKey(type.key, channel);
        const canDisable = type.canDisable[channel] !== false;
        return {
          channel,
          preferenceKey,
          enabled: !canDisable || settings[preferenceKey] !== false,
          canDisable,
        };
      }),
    }));
  }

  async list(
    operator: OperatorContext,
    input: { unreadOnly?: boolean | null; page?: number; pageSize?: number },
  ): Promise<NotificationPage> {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(input.pageSize ?? 20)),
    );
    const mine = this.mineFilter(operator);
    const filter = input.unreadOnly === true ? { ...mine, readAt: null } : mine;
    const documents = await this.notifications.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    const totalCount = await this.notifications.count(operator, filter);
    return {
      items: documents.map((document) => this.toItem(document)),
      page,
      pageSize,
      totalCount,
      unreadCount: await this.unreadCount(operator),
    };
  }

  unreadCount(operator: OperatorContext): Promise<number> {
    return this.notifications.count(operator, {
      ...this.mineFilter(operator),
      readAt: null,
    });
  }

  /** 標已讀(只動自己的、還沒讀的;別人的或不存在的 id 直接略過)。回目前的未讀數。 */
  async markRead(
    operator: OperatorContext,
    ids: readonly string[],
  ): Promise<number> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length > 0) {
      await this.notifications.updateMany(
        operator,
        { ...this.mineFilter(operator), _id: { $in: objectIds }, readAt: null },
        { $set: { readAt: new Date() } },
      );
    }
    return this.unreadCount(operator);
  }

  /** 全部標已讀。回目前的未讀數(0)。 */
  async markAllRead(operator: OperatorContext): Promise<number> {
    await this.notifications.updateMany(
      operator,
      { ...this.mineFilter(operator), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return this.unreadCount(operator);
  }

  private mineFilter(operator: OperatorContext) {
    if (operator.actorId === null) {
      throw new Error("通知只給已登入的使用者讀寫(operator.actorId 為 null)");
    }
    return { recipientId: operator.actorId, ...IN_APP_FILTER };
  }

  private toItem(
    document: Persisted<NotificationDocument>,
  ): NotificationListItem {
    return {
      id: String(document._id),
      type: document.type,
      title: document.title,
      body: document.body,
      refType: document.refType,
      refId: document.refId,
      link: notificationLinkOf(this.links, document.refType, document.refId),
      readAt: document.readAt,
      createdAt: document.createdAt,
    };
  }
}
