import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { RealtimePublisher } from "./realtime-publisher.service";
import { RealtimeTicketService } from "./realtime-ticket.service";
import {
  RealtimeTransport,
  createRealtimeTransport,
} from "./realtime-transport";
import { REALTIME_CONFIG, realtimeConfigProvider } from "./realtime.config";
import { RealtimeResolver } from "./realtime.resolver";

/**
 * 即時通道的 API 端:送出信號(`RealtimePublisher`)與訂閱憑證(`realtimeTicket`)。
 * 呼叫端只注入 `RealtimePublisher`;Worker 位址與兩把密鑰見 `realtime.config.ts`。
 * 專案的看板頻道登記(`REALTIME_BOARDS`)由 `DatabaseModule` 這個固定組裝入口提供。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    realtimeConfigProvider,
    {
      provide: RealtimeTransport,
      inject: [REALTIME_CONFIG],
      useFactory: createRealtimeTransport,
    },
    RealtimePublisher,
    RealtimeTicketService,
    RealtimeResolver,
  ],
  exports: [RealtimePublisher, RealtimeTicketService],
})
export class RealtimeModule {}
