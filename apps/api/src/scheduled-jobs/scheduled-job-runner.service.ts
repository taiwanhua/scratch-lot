import { Injectable, Logger } from "@nestjs/common";

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

/** 一次呼叫裡,某工作某時點的處理結果。`skipped` = 該時點已有執行紀錄(別的呼叫跑過或正在跑)。 */
export interface ScheduledJobOutcome {
  key: string;
  scheduledFor: string;
  status: "succeeded" | "failed" | "skipped";
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
    const runId = await this.runs.claim(job.key, scheduledFor, new Date());
    if (runId === null) {
      return outcome("skipped");
    }
    try {
      await job.handler({ key: job.key, scheduledFor, tenants });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `排程工作「${job.key}」(${scheduledFor.toISOString()})失敗:${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.runs.finish(runId, "failed", new Date(), message);
      return outcome("failed");
    }
    await this.runs.finish(runId, "succeeded", new Date());
    return outcome("succeeded");
  }
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
