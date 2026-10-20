import { Module } from "@nestjs/common";

import { AudienceCoreModule } from "../audience/audience-core.module";
import { DatabaseModule } from "../database/database.module";
import { WorkflowsCoreModule } from "../workflows/workflows-core.module";
import { SidebarBadgeRegistry } from "./sidebar-badge-registry";
import { SidebarBadgeSettingsResolver } from "./sidebar-badge-settings.resolver";
import { SidebarBadgeSettingsService } from "./sidebar-badge-settings.service";
import { SidebarBadgesResolver } from "./sidebar-badges.resolver";
import { SidebarBadgesService } from "./sidebar-badges.service";

/**
 * 側欄計數登記制(`docs/concepts/frontend-architecture.md`「側欄」):
 * 要顯示側欄數字的功能模組(底座或專案)匯入本 module,注入 `SidebarBadgeRegistry`,
 * 在 `onModuleInit` 呼叫 `registerBadge({ moduleKey, count })`。
 * 「誰看得到」的租戶設定(通知設定頁「側欄數字」區塊)也在這裡:`SidebarBadgeSettingsService`。
 */
@Module({
  imports: [DatabaseModule, AudienceCoreModule, WorkflowsCoreModule],
  providers: [
    SidebarBadgeRegistry,
    SidebarBadgesService,
    SidebarBadgesResolver,
    SidebarBadgeSettingsService,
    SidebarBadgeSettingsResolver,
  ],
  exports: [SidebarBadgeRegistry],
})
export class SidebarBadgesModule {}
