import { Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { SidebarBadge } from "./models/sidebar-badge.model";
import { SidebarBadgesService } from "./sidebar-badges.service";

/**
 * 側欄計數:登入者都可以查,只回他看得到(持有 `<模組 key>.view`)的模組;
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
