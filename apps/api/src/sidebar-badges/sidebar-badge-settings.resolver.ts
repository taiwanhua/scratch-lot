import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  ResetSidebarBadgeSettingInput,
  type SidebarBadgeSettingModel,
  SidebarBadgeSettingPayload,
  SidebarBadgeSettingsPayload,
  UpdateSidebarBadgeSettingInput,
} from "./models/sidebar-badge-setting.model";
import {
  type SidebarBadgeSettingItem,
  SidebarBadgeSettingsService,
} from "./sidebar-badge-settings.service";

/** 人員條件以 JSON 進出(同通知設定)。 */
function toModel(item: SidebarBadgeSettingItem): SidebarBadgeSettingModel {
  return {
    ...item,
    audience: item.audience === null ? null : { ...item.audience },
  };
}

/**
 * 側欄數字設定(通知設定頁的「側欄數字」區塊;權限沿用 `system.notification-settings`,
 * `docs/modules/notification-settings.md`):resolver 只做「守門 + 轉呼叫」,規則在 service(STRUCT-01)。
 */
@Resolver()
export class SidebarBadgeSettingsResolver {
  constructor(private readonly service: SidebarBadgeSettingsService) {}

  @RequirePermission("system.notification-settings.view")
  @Query(() => SidebarBadgeSettingsPayload, { name: "sidebarBadgeSettings" })
  async sidebarBadgeSettings(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SidebarBadgeSettingsPayload> {
    const items = await this.service.list(operator);
    return {
      items: items.map((item) => toModel(item)),
      totalCount: items.length,
    };
  }

  @RequirePermission("system.notification-settings.edit")
  @Mutation(() => SidebarBadgeSettingPayload)
  async updateSidebarBadgeSetting(
    @Args("input") input: UpdateSidebarBadgeSettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SidebarBadgeSettingPayload> {
    return { setting: toModel(await this.service.update(operator, input)) };
  }

  @RequirePermission("system.notification-settings.edit")
  @Mutation(() => SidebarBadgeSettingPayload)
  async resetSidebarBadgeSetting(
    @Args("input") input: ResetSidebarBadgeSettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SidebarBadgeSettingPayload> {
    return { setting: toModel(await this.service.reset(operator, input)) };
  }
}
