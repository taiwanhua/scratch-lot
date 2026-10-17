import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  NotificationSettingsInput,
  ResetNotificationSettingInput,
  UpdateNotificationSettingInput,
} from "./dto/notifications.input";
import {
  type NotificationSettingModel,
  NotificationSettingPayload,
  NotificationSettingsPayload,
} from "./models/notifications.model";
import {
  type NotificationSettingItem,
  NotificationSettingsService,
} from "./notification-settings.service";

/** 人員條件以 JSON 進出(同資料範圍的條件樹)。 */
function toModel(item: NotificationSettingItem): NotificationSettingModel {
  return {
    ...item,
    audience: { ...item.audience },
    defaultAudience: { ...item.defaultAudience },
  };
}

/**
 * 通知設定(`system.notification-settings`;`docs/modules/notification-settings.md`):
 * resolver 只做「守門 + 轉呼叫」,規則在 service(STRUCT-01);每個 key 對應權限表的同一行。
 */
@Resolver()
export class NotificationSettingsResolver {
  constructor(private readonly service: NotificationSettingsService) {}

  @RequirePermission("system.notification-settings.view")
  @Query(() => NotificationSettingsPayload, { name: "notificationSettings" })
  async notificationSettings(
    @Args("input") input: NotificationSettingsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<NotificationSettingsPayload> {
    const page = await this.service.list(operator, input);
    return { ...page, items: page.items.map((item) => toModel(item)) };
  }

  @RequirePermission("system.notification-settings.edit")
  @Mutation(() => NotificationSettingPayload)
  async updateNotificationSetting(
    @Args("input") input: UpdateNotificationSettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<NotificationSettingPayload> {
    return { setting: toModel(await this.service.update(operator, input)) };
  }

  @RequirePermission("system.notification-settings.edit")
  @Mutation(() => NotificationSettingPayload)
  async resetNotificationSetting(
    @Args("input") input: ResetNotificationSettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<NotificationSettingPayload> {
    return { setting: toModel(await this.service.reset(operator, input)) };
  }
}
