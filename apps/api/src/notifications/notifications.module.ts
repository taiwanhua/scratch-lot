import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { UserPreferencesModule } from "../user-preferences/user-preferences.module";
import { WorkflowsCoreModule } from "../workflows/workflows-core.module";
import { NotificationInboxService } from "./notification-inbox.service";
import { NotificationSettingsResolver } from "./notification-settings.resolver";
import { NotificationSettingsService } from "./notification-settings.service";
import { NotificationsCoreModule } from "./notifications-core.module";
import { NotificationsResolver } from "./notifications.resolver";

/**
 * 通知的 API 功能(底座規格第 5 章;`docs/modules/notification-settings.md`):
 * 我的通知清單 / 未讀數 / 標已讀 / 管道開關(所有登入者),與通知設定頁(`system.notification-settings`)。
 * 送通知的 `notify()` 在 `NotificationsCoreModule`,使用處匯入那一個。
 */
@Module({
  imports: [
    DatabaseModule,
    NotificationsCoreModule,
    AuditModule,
    UserPreferencesModule,
    WorkflowsCoreModule,
  ],
  providers: [
    NotificationInboxService,
    NotificationsResolver,
    NotificationSettingsService,
    NotificationSettingsResolver,
  ],
  exports: [NotificationsCoreModule],
})
export class NotificationsModule {}
