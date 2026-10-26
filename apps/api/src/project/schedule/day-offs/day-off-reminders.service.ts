import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  addLocalDays,
  addLocalMonths,
  localDateOf,
  localDateText,
  localMonthText,
} from "@repo/domain/form";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { scheduleHitAt } from "../../../notifications/notification-schedule";
import {
  type EffectiveSchedule,
  NotificationSettingsService,
} from "../../../notifications/notification-settings.service";
import { NotificationService } from "../../../notifications/notification.service";
import {
  type ScheduledJobContext,
  ScheduledJobRegistry,
} from "../../../scheduled-jobs/scheduled-job-registry";
import { ScheduleRelationshipsRepository } from "../../database/schedule/schedule.repositories";
import {
  SCHEDULE_DAY_OFF_CLOSING,
  SCHEDULE_DAY_OFF_OPEN,
  SCHEDULE_MY_DAY_OFFS_REF,
} from "../../notifications";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import {
  type DayOffWindow,
  type DayOffWindowValue,
  dayOffWindowFor,
  dayOffWindowValueOf,
} from "./day-off-window";

/** 排程工作 key(`docs/deployment.md`「Cloud Scheduler」;全域唯一)。 */
export const DAY_OFF_REMINDERS_JOB_KEY = "schedule.day-off-reminders";

const ORG_STAFF = "org_schedule_staff";

/** 哪一個日期是這一型的目標日:開放日或截止日。 */
const TARGET_OF = {
  [SCHEDULE_DAY_OFF_OPEN]: (window: DayOffWindow) => window.startDate,
  [SCHEDULE_DAY_OFF_CLOSING]: (window: DayOffWindow) => window.endDate,
} as const;

type ReminderType = keyof typeof TARGET_OF;

/**
 * 畫休開放 / 畫休即將截止(B14;規格 3.4、3.5、14.11):當事人通知,收件人 = 可以排這家店的排班人員。
 *
 * - 日期照各店的規則「畫休開放期間」(生效值);提前幾天、幾點寄照通知設定(預設開放日當天 09:00、
 *   截止日前 1 天 09:00),整個租戶一套;時點以**租戶時區**計
 * - 每 15 分鐘跑一次;「這個時點該不該寄」用底座的 `scheduleHitAt`(漏跑 6 小時內補寄、改了時間不補)
 * - `dedupeKey` 帶類型、店、目標月與時點:同一個時點只寄一次;同一人可以排兩家店 → 兩家店各一則
 */
@Injectable()
export class DayOffRemindersService implements OnModuleInit {
  private readonly logger = new Logger(DayOffRemindersService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationService,
    private readonly relationships: ScheduleRelationshipsRepository,
    private readonly orgs: OrgsRepository,
    private readonly rules: ScheduleRulesService,
    private readonly staff: ScheduleStaffService,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: DAY_OFF_REMINDERS_JOB_KEY,
      every: "15m",
      handler: (context) => this.run(context),
    });
  }

  /** 一次排程:逐租戶(根組織沒有排班)。 */
  async run(context: ScheduledJobContext): Promise<void> {
    for (const tenant of context.tenants) {
      if (tenant.tenantId === null) {
        continue;
      }
      try {
        await this.runTenant(
          tenant.tenantId,
          tenant.timezone,
          context.scheduledFor,
        );
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenant.tenantId)} 的畫休提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async runTenant(
    tenantId: Types.ObjectId,
    timezone: string,
    scheduledFor: Date,
  ): Promise<void> {
    // 排程的租戶系統身分:可見範圍 = 這個租戶的整棵組織樹(ADR-0005「例外出口」)
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const links = await this.relationships.findMany(reader, {
      type: ORG_STAFF,
      tenantId,
    });
    const storeIds = [
      ...new Map(links.map((link) => [String(link.firstId), link.firstId])),
    ].map(([, id]) => id);
    if (storeIds.length === 0) {
      return;
    }
    const schedules = {
      [SCHEDULE_DAY_OFF_OPEN]: await this.settings.effectiveSchedule(
        tenantId,
        SCHEDULE_DAY_OFF_OPEN,
      ),
      [SCHEDULE_DAY_OFF_CLOSING]: await this.settings.effectiveSchedule(
        tenantId,
        SCHEDULE_DAY_OFF_CLOSING,
      ),
    };
    for (const storeId of storeIds) {
      try {
        const settings = await this.rules.effectiveSettingsForOrg(
          reader,
          storeId,
        );
        // 與登記檢查同一個判斷:只看值、不看開關(`dayOffWindowValueOf`)
        const value = dayOffWindowValueOf(settings.get("dayOffWindow"));
        for (const type of [
          SCHEDULE_DAY_OFF_OPEN,
          SCHEDULE_DAY_OFF_CLOSING,
        ] as const) {
          await this.remind(type, schedules[type], value, {
            reader,
            tenantId,
            storeId,
            timezone,
            scheduledFor,
          });
        }
      } catch (error) {
        // 單一家店失敗不擋後面的(下一輪再試;dedupeKey 保證不重複)
        this.logger.error(
          `分店 ${String(storeId)} 的畫休提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async remind(
    type: ReminderType,
    effective: EffectiveSchedule,
    value: DayOffWindowValue,
    at: {
      reader: OperatorContext;
      tenantId: Types.ObjectId;
      storeId: Types.ObjectId;
      timezone: string;
      scheduledFor: Date;
    },
  ): Promise<void> {
    const found = this.hitOf(type, effective, value, at);
    if (found === null) {
      return;
    }
    const reader = at.reader;
    const candidates = await this.staff.listScheduleCandidates(
      reader,
      at.storeId,
    );
    if (candidates.length === 0) {
      return;
    }
    const org = await this.orgs.findById(reader, at.storeId);
    await this.notifications.notify({
      type,
      tenantId: at.tenantId,
      orgId: at.storeId,
      recipients: {
        kind: "users",
        userIds: candidates.map((candidate) => candidate.userId),
      },
      params: {
        orgName: org?.name ?? "",
        month: found.window.month,
        opensOn: found.window.startDate,
        closesOn: found.window.endDate,
      },
      // 點進去 = 我的畫休的那個月(目標月)
      ref: { type: SCHEDULE_MY_DAY_OFFS_REF, id: found.window.month },
      dedupeKey: `${type}:${String(at.storeId)}:${found.window.month}:${found.occurrence}`,
    });
  }

  /**
   * 目標日(開放日 / 截止日)可能落在這個月或下個月(提前天數可調):應寄時點只會是排程這一刻的
   * 今天或昨天,所以目標日 = 今天 / 昨天 + 提前天數,其中真的是某個目標月的開放日 / 截止日的才交給
   * `scheduleHitAt` 判斷。
   */
  private hitOf(
    type: ReminderType,
    effective: EffectiveSchedule,
    value: DayOffWindowValue,
    at: { timezone: string; scheduledFor: Date },
  ): { window: DayOffWindow; occurrence: string } | null {
    if (effective.schedule.kind !== "days-before") {
      return null;
    }
    const today = localDateOf(at.scheduledFor.getTime(), at.timezone);
    for (const days of effective.schedule.daysBefore) {
      for (const base of [today, addLocalDays(today, -1)]) {
        const date = addLocalDays(base, days);
        const target = localDateText(date);
        // 目標日在某個月 → 它是下個月(目標月)的開放期間
        const window = dayOffWindowFor(
          localMonthText(
            addLocalMonths({ year: date.year, month: date.month }, 1),
          ),
          value,
        );
        if (TARGET_OF[type](window) !== target) {
          continue;
        }
        const hit = scheduleHitAt(effective.schedule, {
          scheduledFor: at.scheduledFor,
          timezone: at.timezone,
          date,
          modifiedAt: effective.modifiedAt,
        });
        if (hit !== null) {
          return { window, occurrence: hit.occurrence };
        }
      }
    }
    return null;
  }
}
