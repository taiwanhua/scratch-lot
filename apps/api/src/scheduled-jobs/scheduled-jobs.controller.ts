import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";

import { Public } from "../auth/decorators";
import {
  type ScheduledJobOutcome,
  ScheduledJobRunner,
} from "./scheduled-job-runner.service";
import { SchedulerAuthGuard } from "./scheduler-identity";

/** 內部端點的路徑(Cloud Scheduler 工作的目標 = `<API 網址>` + 這個路徑)。 */
export const SCHEDULED_JOBS_RUN_PATH = "/internal/scheduled-jobs/run";

/**
 * Cloud Scheduler 每 15 分鐘 `POST` 一次的內部端點(`docs/deployment.md`「Cloud Scheduler」)。
 * 不走 GraphQL:呼叫者是 Scheduler 的 service account,不是後台使用者,所以標 `@Public()`
 * 跳過登入守門,改由 `SchedulerAuthGuard` 驗 OIDC token。
 * 個別工作失敗也回 200(結果在 body 與執行紀錄):回錯誤會讓 Scheduler 重送,而已取得的時點不會重跑。
 */
@Public()
@UseGuards(SchedulerAuthGuard)
@Controller("internal/scheduled-jobs")
export class ScheduledJobsController {
  constructor(private readonly runner: ScheduledJobRunner) {}

  @Post("run")
  @HttpCode(200)
  async run(): Promise<{ outcomes: ScheduledJobOutcome[] }> {
    return { outcomes: await this.runner.runDueJobs(new Date()) };
  }
}
