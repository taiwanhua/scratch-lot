import { Injectable, Module, type OnModuleInit } from "@nestjs/common";

import type { ScheduledJobContext } from "../scheduled-job-registry";
import { ScheduledJobRegistry } from "../scheduled-job-registry";
import { ScheduledJobsModule } from "../scheduled-jobs.module";

/** 探針工作的 key。 */
export const PROBE_JOB_KEYS = {
  every15m: "test.every-15m",
  daily0800: "test.daily-0800",
  failing: "test.failing",
} as const;

/** 探針工作每次被執行時記下的內容。 */
export interface ProbeCall {
  key: string;
  scheduledFor: string;
  tenantIds: (string | null)[];
}

/**
 * 測試用的排程工作(不進 build:tsconfig.build.json 排除 test-support):
 * 以一般功能模組的方式登記三個工作,經真正的登記處、執行器與執行紀錄跑;只在測試的 `extraModules` 掛上。
 */
@Injectable()
export class ScheduledJobProbe implements OnModuleInit {
  readonly calls: ProbeCall[] = [];

  constructor(private readonly registry: ScheduledJobRegistry) {}

  onModuleInit(): void {
    const record = (context: ScheduledJobContext): Promise<void> => {
      this.calls.push({
        key: context.key,
        scheduledFor: context.scheduledFor.toISOString(),
        tenantIds: context.tenants.map((tenant) =>
          tenant.tenantId === null ? null : String(tenant.tenantId),
        ),
      });
      return Promise.resolve();
    };
    this.registry.registerScheduledJob({
      key: PROBE_JOB_KEYS.every15m,
      every: "15m",
      handler: record,
    });
    this.registry.registerScheduledJob({
      key: PROBE_JOB_KEYS.daily0800,
      every: "daily@08:00",
      handler: record,
    });
    this.registry.registerScheduledJob({
      key: PROBE_JOB_KEYS.failing,
      every: "1h",
      handler: () => Promise.reject(new Error("probe failure")),
    });
  }

  callsOf(key: string): ProbeCall[] {
    return this.calls.filter((call) => call.key === key);
  }
}

@Module({
  imports: [ScheduledJobsModule],
  providers: [ScheduledJobProbe],
})
export class ScheduledJobProbeModule {}
