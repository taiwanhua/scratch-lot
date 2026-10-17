import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type ParsedSchedule,
  type ScheduleEvery,
  parseSchedule,
} from "./schedule";

/** 交給 handler 的一個租戶:租戶頂層 id(根組織為 null)與它的時區。 */
export interface ScheduledJobTenant {
  readonly tenantId: Types.ObjectId | null;
  readonly timezone: string;
}

/** 一次執行的上下文。 */
export interface ScheduledJobContext {
  readonly key: string;
  /** 這次執行對應的到期時點(與 `scheduled_job_runs.scheduledFor` 同一個)。 */
  readonly scheduledFor: Date;
  /**
   * 這次要處理的租戶:`daily@HH:mm` 只給當地 HH:mm 落在 `scheduledFor` 的租戶;
   * `15m` / `1h` 給全部租戶。都含根組織(`tenantId = null`),不含停用的租戶。
   */
  readonly tenants: readonly ScheduledJobTenant[];
}

/** `registerScheduledJob` 的參數。 */
export interface ScheduledJobRegistration {
  /** 全域唯一的工作 key(底座與專案共用一個命名空間),也是執行紀錄的 key。 */
  readonly key: string;
  readonly every: ScheduleEvery;
  /** 拋錯 = 這次執行失敗(記在執行紀錄,同一時點不重跑)。 */
  readonly handler: (context: ScheduledJobContext) => Promise<void>;
}

/** 登記好的工作。 */
export interface ScheduledJob extends ScheduledJobRegistration {
  readonly schedule: ParsedSchedule;
}

/** 登記不合契約(key 空白或重複、頻率不認得)時拋出;屬程式錯誤,讓 app 起不來。 */
export class ScheduledJobRegistrationError extends Error {
  override name = "ScheduledJobRegistrationError";
}

/**
 * 排程工作的登記處(`docs/deployment.md`「Cloud Scheduler」):底座與專案的功能模組各自在
 * `onModuleInit` 呼叫 `registerScheduledJob`,Cloud Scheduler 每次呼叫內部端點時,
 * `ScheduledJobRunner` 依這裡的登記判斷哪些工作到期。
 */
@Injectable()
export class ScheduledJobRegistry {
  private readonly registered = new Map<string, ScheduledJob>();

  registerScheduledJob(registration: ScheduledJobRegistration): void {
    const key = registration.key.trim();
    if (key === "" || key !== registration.key) {
      throw new ScheduledJobRegistrationError(
        `排程工作 key 不可空白或前後有空白:「${registration.key}」`,
      );
    }
    if (this.registered.has(key)) {
      throw new ScheduledJobRegistrationError(`排程工作 key「${key}」重複登記`);
    }
    const schedule = parseSchedule(registration.every);
    if (schedule === null) {
      throw new ScheduledJobRegistrationError(
        `排程工作「${key}」的頻率「${registration.every}」不認得(只收 15m、1h、daily@HH:mm)`,
      );
    }
    this.registered.set(key, { ...registration, schedule });
  }

  /** 已登記的工作(依登記順序)。 */
  jobs(): readonly ScheduledJob[] {
    return [...this.registered.values()];
  }
}
