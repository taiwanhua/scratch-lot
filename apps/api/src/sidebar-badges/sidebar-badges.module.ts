import { Module } from "@nestjs/common";

import { SidebarBadgeRegistry } from "./sidebar-badge-registry";
import { SidebarBadgesResolver } from "./sidebar-badges.resolver";
import { SidebarBadgesService } from "./sidebar-badges.service";

/**
 * 側欄計數登記制(`docs/concepts/frontend-architecture.md`「側欄」):
 * 要顯示側欄數字的功能模組(底座或專案)匯入本 module,注入 `SidebarBadgeRegistry`,
 * 在 `onModuleInit` 呼叫 `registerBadge({ moduleKey, count })`。
 */
@Module({
  providers: [
    SidebarBadgeRegistry,
    SidebarBadgesService,
    SidebarBadgesResolver,
  ],
  exports: [SidebarBadgeRegistry],
})
export class SidebarBadgesModule {}
