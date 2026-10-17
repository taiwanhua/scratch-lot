import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import {
  MarkNotificationsReadInput,
  MyNotificationsInput,
} from "./dto/notifications.input";
import {
  MarkNotificationsReadPayload,
  MyNotificationPreferencesPayload,
  MyNotificationUnreadCountPayload,
  MyNotificationsPayload,
} from "./models/notifications.model";
import { NotificationInboxService } from "./notification-inbox.service";

/**
 * 我的通知(底座規格第 5 章「通知鈴與通知清單」):只讀寫自己的,所有登入者都能用 ——
 * 不經模組權限(通知鈴在頂端列,不是模組;同個人偏好)。
 */
@Resolver()
export class NotificationsResolver {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Query(() => MyNotificationsPayload, { name: "myNotifications" })
  myNotifications(
    @Args("input") input: MyNotificationsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyNotificationsPayload> {
    return this.inbox.list(operator, input);
  }

  @Query(() => MyNotificationUnreadCountPayload, {
    name: "myNotificationUnreadCount",
  })
  async myNotificationUnreadCount(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyNotificationUnreadCountPayload> {
    return { count: await this.inbox.unreadCount(operator) };
  }

  /** 個人設定「偏好」分頁的管道開關;開關本身經 `updateMyPreferences` 寫入。 */
  @Query(() => MyNotificationPreferencesPayload, {
    name: "myNotificationPreferences",
  })
  async myNotificationPreferences(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyNotificationPreferencesPayload> {
    return { items: await this.inbox.myPreferences(operator) };
  }

  @Mutation(() => MarkNotificationsReadPayload)
  async markNotificationsRead(
    @Args("input") input: MarkNotificationsReadInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MarkNotificationsReadPayload> {
    return { unreadCount: await this.inbox.markRead(operator, input.ids) };
  }

  /** 全部標已讀(沒有輸入:GQL-02 的例外)。 */
  @Mutation(() => MarkNotificationsReadPayload)
  async markAllNotificationsRead(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MarkNotificationsReadPayload> {
    return { unreadCount: await this.inbox.markAllRead(operator) };
  }
}
