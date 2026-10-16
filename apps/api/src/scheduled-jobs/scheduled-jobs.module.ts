import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { ScheduledJobRegistry } from "./scheduled-job-registry";
import { ScheduledJobRunner } from "./scheduled-job-runner.service";
import { ScheduledJobsController } from "./scheduled-jobs.controller";
import {
  SchedulerAuthGuard,
  SchedulerIdentityVerifier,
  schedulerIdentityConfigProvider,
} from "./scheduler-identity";

/**
 * 排程任務:Cloud Scheduler 呼叫的內部端點、工作登記處與執行器。
 * 要登記工作的功能模組(底座或專案)匯入本 module,注入 `ScheduledJobRegistry`,
 * 在 `onModuleInit` 呼叫 `registerScheduledJob({ key, every, handler })`。
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ScheduledJobsController],
  providers: [
    schedulerIdentityConfigProvider,
    SchedulerIdentityVerifier,
    SchedulerAuthGuard,
    ScheduledJobRegistry,
    ScheduledJobRunner,
  ],
  exports: [ScheduledJobRegistry],
})
export class ScheduledJobsModule {}
