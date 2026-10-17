import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { NotificationsCoreModule } from "../notifications/notifications-core.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ScheduledJobsModule } from "../scheduled-jobs/scheduled-jobs.module";
import { StorageModule } from "../storage/storage.module";
import { MeOrgTenantNameResolver } from "./me-org-tenant-name.resolver";
import { PrintAgentAuthGuard } from "./print-agent-auth.guard";
import { PrintAgentReleaseService } from "./print-agent-release.service";
import { PrintAgentController } from "./print-agent.controller";
import { PrintAgentsService } from "./print-agents.service";
import { PrintJobsService } from "./print-jobs.service";
import { PrintersService } from "./printers.service";
import { PrintingNotifier } from "./printing-notifier";
import { PrintingResolver } from "./printing.resolver";

/**
 * 列印(底座規格第 6 章 B8;docs/modules/printers.md):
 * 後台的 GraphQL(印表機管理、列印按鈕)+ 代理程式的 HTTP 端點(配對、拿工作、認領、回報、心跳、訂閱憑證)。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    StorageModule,
    ScheduledJobsModule,
    NotificationsCoreModule,
  ],
  controllers: [PrintAgentController],
  providers: [
    PrintAgentReleaseService,
    PrintingNotifier,
    PrintJobsService,
    PrintAgentsService,
    PrintersService,
    PrintAgentAuthGuard,
    PrintingResolver,
    MeOrgTenantNameResolver,
  ],
})
export class PrintingModule {}
