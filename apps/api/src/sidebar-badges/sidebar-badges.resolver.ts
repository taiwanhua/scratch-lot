import { Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { SidebarBadge } from "./models/sidebar-badge.model";
import { SidebarBadgesService } from "./sidebar-badges.service";

/**
 * 側欄計數:登入者都可以查,只回他看得到的模組(角色綁了那個模組;登記填了 `requires` 時還要持有那條權限);
 * 不需要另外的模組權限。
 */
@Resolver()
export class SidebarBadgesResolver {
  constructor(private readonly service: SidebarBadgesService) {}

  @Query(() => [SidebarBadge], { name: "sidebarBadges" })
  sidebarBadges(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SidebarBadge[]> {
    return this.service.badgesOf(operator);
  }
}
