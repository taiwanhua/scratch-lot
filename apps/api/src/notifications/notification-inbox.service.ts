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
import { notificationCursorInvalid } from "./notifications-error";

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
  pageSize: number;
  /** 下一批的游標;沒有更多 = null */
  nextCursor: string | null;
  totalCount: number;
  unreadCount: number;
}

/** 游標指到的那一則:清單依 `createdAt` 再 `_id` 新到舊排,所以兩個一起才唯一。 */
interface NotificationCursor {
  createdAt: Date;
  id: Types.ObjectId;
}

/** 游標 = `<createdAt ISO>_<_id>` 的 base64url(不透明;前端原樣送回)。 */
export const encodeNotificationCursor = (cursor: NotificationCursor): string =>
  Buffer.from(
    `${cursor.createdAt.toISOString()}_${cursor.id.toHexString()}`,
  ).toString("base64url");

/** 解不開(不是這支產的)→ `null`。 */
export const decodeNotificationCursor = (
  raw: string,
): NotificationCursor | null => {
  const [at, id, ...rest] = Buffer.from(raw, "base64url")
    .toString("utf8")
    .split("_");
  if (at === undefined || id === undefined || rest.length > 0) {
    return null;
  }
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime()) || !/^[\da-f]{24}$/.test(id)) {
    return null;
  }
  return { createdAt, id: new Types.ObjectId(id) };
};

/**
 * 自己的通知清單:只讀寫**自己的**(身分取自登入,不收 userId),
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

  /**
   * 游標分頁:比 `after` 舊的(`createdAt` 較早,或同時間 `_id` 較小)取 `pageSize` 則。
   * 游標記的是位置而不是筆數,所以載入途中有新通知(排在最前面)不會讓下一批重複,
   * 「未讀」清單裡已載入的被標成已讀(離開篩選)也不會讓下一批漏掉。
   */
  async list(
    operator: OperatorContext,
    input: {
      unreadOnly?: boolean | null;
      after?: string | null;
      pageSize?: number;
    },
  ): Promise<NotificationPage> {
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(input.pageSize ?? 20)),
    );
    const mine = this.mineFilter(operator);
    const filter = input.unreadOnly === true ? { ...mine, readAt: null } : mine;
    const after = this.cursorOf(input.after);
    const documents = await this.notifications.findMany(
      operator,
      after === null
        ? filter
        : {
            ...filter,
            $or: [
              { createdAt: { $lt: after.createdAt } },
              { createdAt: after.createdAt, _id: { $lt: after.id } },
            ],
          },
      // 多取一則判斷還有沒有下一批
      { sort: { createdAt: -1, _id: -1 }, limit: pageSize + 1 },
    );
    const page = documents.slice(0, pageSize);
    const last = page.at(-1);
    const totalCount = await this.notifications.count(operator, filter);
    return {
      items: page.map((document) => this.toItem(document)),
      pageSize,
      nextCursor:
        documents.length > pageSize && last !== undefined
          ? encodeNotificationCursor({
              createdAt: last.createdAt,
              id: last._id,
            })
          : null,
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

  /** 缺席 / null / 空字串 = 從最新的開始;解不開 → `INVALID_CURSOR`。 */
  private cursorOf(raw: string | null | undefined): NotificationCursor | null {
    if (raw === undefined || raw === null || raw.length === 0) {
      return null;
    }
    const cursor = decodeNotificationCursor(raw);
    if (cursor === null) {
      throw notificationCursorInvalid();
    }
    return cursor;
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
