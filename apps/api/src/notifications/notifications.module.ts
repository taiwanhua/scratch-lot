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
 * 通知的 API 功能(`docs/modules/notification-settings.md`):
 * 我的通知清單 / 未讀數 / 標已讀 / 管道開關(所有登入者),與通知設定頁(`system.notification-settings`)。
 * 送通知的 `notify()` 在 `NotificationsCoreModule`,使用處匯入那一個。
 * 宣告了可調時間的排程工作(B14)匯入本 module,用 `NotificationSettingsService.effectiveSchedule`
 * 取租戶目前生效的提醒時間(「排程接口」)。
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
  exports: [NotificationsCoreModule, NotificationSettingsService],
})
export class NotificationsModule {}
