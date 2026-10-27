import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { SidebarBadgesModule } from "../sidebar-badges/sidebar-badges.module";
import { AudienceReferencesService } from "./audience-references.service";

/**
 * 「找出引用某角色的人員條件」(`AudienceReferencesService`):讀通知設定、側欄數字設定、流程版本與資料範圍規則
 * (側欄數字只算有登記的模組:匯入 `SidebarBadgesModule` 取登記處)。
 * 獨立成一個模組,不放進 `AudienceCoreModule`:它要注入 @Global 的通知類型登記(`NOTIFICATION_TYPES`),
 * 受管定義 CLI 這類只匯入 `AudienceCoreModule` 的組裝沒有那份登記。
 */
@Module({
  imports: [DatabaseModule, SidebarBadgesModule],
  providers: [AudienceReferencesService],
  exports: [AudienceReferencesService],
})
export class AudienceReferencesModule {}
