import { Module } from "@nestjs/common";

import { AudienceCoreModule } from "../audience/audience-core.module";
import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";
import { RealtimeModule } from "../realtime/realtime.module";
import {
  EmailChannelAdapter,
  InAppChannelAdapter,
  NOTIFICATION_CHANNEL_ADAPTERS,
  type NotificationChannelAdapter,
  assertChannelAdapters,
} from "./notification-channels";
import { NotificationService } from "./notification.service";

/**
 * 通知的單一入口 `NotificationService.notify()` 與管道轉接器,不帶 GraphQL 端點:
 * 流程引擎與專案功能匯入它就能送通知,不會連帶啟動通知清單與通知設定的 resolver
 * (同 `AudienceCoreModule` 的分法)。類型與連結登記由全域的 `NotificationRegistryModule` 提供。
 *
 * 新增管道:寫一個 `NotificationChannelAdapter`、在這裡加進 providers 與 `NOTIFICATION_CHANNEL_ADAPTERS`,
 * 並在 `NOTIFICATION_CHANNELS` 登記 key(兩邊對不上 → 起不來)。
 */
@Module({
  imports: [DatabaseModule, AudienceCoreModule, MailModule, RealtimeModule],
  providers: [
    InAppChannelAdapter,
    EmailChannelAdapter,
    {
      provide: NOTIFICATION_CHANNEL_ADAPTERS,
      inject: [InAppChannelAdapter, EmailChannelAdapter],
      useFactory: (
        ...adapters: NotificationChannelAdapter[]
      ): readonly NotificationChannelAdapter[] =>
        assertChannelAdapters(adapters),
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationsCoreModule {}
