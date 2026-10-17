import { Injectable, Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { ScheduledJobRunsStore } from "../database/scheduled-job-runs.store";
import { tenantIdOfOrg } from "../database/tenant-id";
import { timezoneOfTenantSettings } from "../database/tenant-timezone";
import { dailySlotOf, intervalSlotOf } from "./schedule";
import {
  type ScheduledJob,
  ScheduledJobRegistry,
  type ScheduledJobTenant,
} from "./scheduled-job-registry";

/**
 * 一次呼叫裡,某工作某時點的處理結果。`skipped` = 該時點已有執行紀錄(別的呼叫跑過或正在跑);
 * `error` = 取執行權時資料庫出錯,handler 沒有執行(下一次呼叫再試)。
 */
export interface ScheduledJobOutcome {
  key: string;
  scheduledFor: string;
  status: "succeeded" | "failed" | "skipped" | "error";
}

/**
 * 背景執行沒有操作者:列租戶只讀組織的時區與啟用狀態,範圍放開為 `"all"`
 * (同 `database/tenant-timezone.ts` 讀時區的做法;時區是租戶的設定,不是「你管不管得到」的問題)。
 */
const SYSTEM_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
};

/**
 * 每次 Cloud Scheduler 呼叫執行一輪:依登記判斷到期的 `(工作, 時點)`,逐一取得執行權
 * (`scheduled_job_runs` 唯一索引)後執行 handler。工作之間依序執行,一個失敗不影響其他工作。
 */
@Injectable()
export class ScheduledJobRunner {
  private readonly logger = new Logger(ScheduledJobRunner.name);

  constructor(
    private readonly registry: ScheduledJobRegistry,
    private readonly runs: ScheduledJobRunsStore,
    private readonly orgs: OrgsRepository,
  ) {}

  async runDueJobs(now: Date): Promise<ScheduledJobOutcome[]> {
    const jobs = this.registry.jobs();
    if (jobs.length === 0) {
      return [];
    }
    const tenants = await this.activeTenants();
    const outcomes: ScheduledJobOutcome[] = [];
    for (const job of jobs) {
      for (const [slot, slotTenants] of dueSlots(job, now.getTime(), tenants)) {
        outcomes.push(await this.runOnce(job, new Date(slot), slotTenants));
      }
    }
    return outcomes;
  }

  /** 根組織與啟用中的租戶頂層(不含已刪除),各帶時區。 */
  private async activeTenants(): Promise<ScheduledJobTenant[]> {
    const orgs = await this.orgs.findMany(SYSTEM_READER, {
      $or: [{ parentId: null }, { ancestors: { $size: 1 } }],
      enabled: true,
    });
    return orgs.map((org) => ({
      tenantId: tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors }),
      timezone: timezoneOfTenantSettings(org.settings),
    }));
  }

  private async runOnce(
    job: ScheduledJob,
    scheduledFor: Date,
    tenants: readonly ScheduledJobTenant[],
  ): Promise<ScheduledJobOutcome> {
    const outcome = (status: ScheduledJobOutcome["status"]) => ({
      key: job.key,
      scheduledFor: scheduledFor.toISOString(),
      status,
    });
    const label = `排程工作「${job.key}」(${scheduledFor.toISOString()})`;
    let runId: Types.ObjectId | null;
    try {
      runId = await this.runs.claim(job.key, scheduledFor, new Date());
    } catch (error) {
      // 取不到執行權(資料庫錯誤)就不執行 handler;只記 log,同一輪的其他工作照跑,下一次呼叫再試
      this.logError(`${label}取得執行權失敗`, error);
      return outcome("error");
    }
    if (runId === null) {
      return outcome("skipped");
    }
    let status: "succeeded" | "failed" = "succeeded";
    let message: string | null = null;
    try {
      await job.handler({ key: job.key, scheduledFor, tenants });
    } catch (error) {
      status = "failed";
      message = messageOf(error);
      this.logError(`${label}失敗`, error);
    }
    try {
      await this.runs.finish(runId, status, new Date(), message);
    } catch (error) {
      // 紀錄停在 running,逾時後由之後的呼叫重新取得(`STALE_RUNNING_MS`)
      this.logError(`${label}寫入執行結果失敗`, error);
    }
    return outcome(status);
  }

  private logError(prefix: string, error: unknown): void {
    this.logger.error(
      `${prefix}:${messageOf(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 某工作在 `now` 到期的時點與各時點要處理的租戶:間隔工作一個時點、全部租戶;
 * 每日工作依各租戶時區算當地 HH:mm,時點相同的租戶併成一次(唯一鍵是 `(key, scheduledFor)`)。
 */
export function dueSlots(
  job: Pick<ScheduledJob, "schedule">,
  now: number,
  tenants: readonly ScheduledJobTenant[],
): Map<number, ScheduledJobTenant[]> {
  const { schedule } = job;
  if (schedule.kind === "interval") {
    return new Map([[intervalSlotOf(schedule.intervalMs, now), [...tenants]]]);
  }
  const slots = new Map<number, ScheduledJobTenant[]>();
  for (const tenant of tenants) {
    const slot = dailySlotOf(schedule, now, tenant.timezone);
    if (slot !== null) {
      slots.set(slot, [...(slots.get(slot) ?? []), tenant]);
    }
  }
  return slots;
}
