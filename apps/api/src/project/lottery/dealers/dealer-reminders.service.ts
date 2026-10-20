import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import { type LocalDate, localDateText } from "@repo/domain/form";

import type { OperatorContext } from "../../../database/operator-context";
import {
  type ScheduleHit,
  scheduleHitAt,
} from "../../../notifications/notification-schedule";
import {
  type EffectiveSchedule,
  NotificationSettingsService,
} from "../../../notifications/notification-settings.service";
import { NotificationService } from "../../../notifications/notification.service";
import {
  type ScheduledJobContext,
  ScheduledJobRegistry,
  type ScheduledJobTenant,
} from "../../../scheduled-jobs/scheduled-job-registry";
import {
  LotteryDealersRepository,
  LotteryRelationshipsRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import {
  LOTTERY_LICENSE_EXPIRING,
  LOTTERY_STORE_RENT_DUE,
} from "../../notifications";
import {
  type RentSetting,
  addDays,
  isRentDueDate,
  localDayOf,
} from "./dealer-dates";
import { ORG_DEALER } from "./dealer-links.service";
import type { DealerRecord } from "./dealer-mapper";

/** 排程工作 key(`docs/deployment.md`「Cloud Scheduler」;全域唯一)。 */
export const DEALER_REMINDERS_JOB_KEY = "lottery.dealer-reminders";

/** 排程讀整個租戶的經銷商:沒有登入主體,以 `tenantId` 釘住範圍。 */
function schedulerReader(): OperatorContext {
  return {
    actorId: null,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

const DEALER_TYPE_NAMES = { a: "甲類", b: "乙類" } as const;

function rentOf(dealer: DealerRecord): RentSetting | null {
  return dealer.type === "b" &&
    dealer.rentCycle !== null &&
    dealer.rentDueDay !== null
    ? {
        cycle: dealer.rentCycle,
        startMonth: dealer.rentStartMonth,
        dueDay: dealer.rentDueDay,
      }
    : null;
}

/**
 * 經銷商的兩種負責人提醒(B14;專案規格 3.4、3.5):
 *
 * - **證照到期**:到期日前 N 天(預設 30、7、0)的寄送時間各一次;過期後不再寄(側欄計數持續顯示)
 * - **牌租繳費提醒**:乙類每期繳費日前 N 天(預設 3、0);繳費日 = 每期第一個月的第 N 日,
 *   那個月沒有這一天用月底
 *
 * 每 15 分鐘跑一次;「這個時點該不該寄」用底座的 `scheduleHitAt`(租戶可在通知設定頁改提前天數與時間)。
 * 收件人照通知設定(組織範圍 = 乙類的對應分店含上層;甲類或沒有對應分店 = 租戶);
 * `dedupeKey` 帶經銷商、目標日與時點,同一個時點只寄一次。解約的經銷商不寄。
 */
@Injectable()
export class DealerRemindersService implements OnModuleInit {
  private readonly logger = new Logger(DealerRemindersService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationService,
    private readonly dealers: LotteryDealersRepository,
    private readonly relationships: LotteryRelationshipsRepository,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: DEALER_REMINDERS_JOB_KEY,
      every: "15m",
      handler: (context) => this.run(context),
    });
  }

  /** 一次排程:逐租戶(根組織沒有經銷商提醒)。 */
  async run(context: ScheduledJobContext): Promise<void> {
    for (const tenant of context.tenants) {
      if (tenant.tenantId === null) {
        continue;
      }
      try {
        await this.runTenant(tenant.tenantId, tenant, context.scheduledFor);
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenant.tenantId)} 的經銷商提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async runTenant(
    tenantId: Types.ObjectId,
    tenant: ScheduledJobTenant,
    scheduledFor: Date,
  ): Promise<void> {
    const license = await this.settings.effectiveSchedule(
      tenantId,
      LOTTERY_LICENSE_EXPIRING,
    );
    const rent = await this.settings.effectiveSchedule(
      tenantId,
      LOTTERY_STORE_RENT_DUE,
    );
    const dealers = await this.dealers.findMany(schedulerReader(), {
      tenantId,
      status: { $ne: "terminated" },
    });
    if (dealers.length === 0) {
      return;
    }
    const stores = await this.relationships.findMany(schedulerReader(), {
      tenantId,
      type: ORG_DEALER,
    });
    const storeOf = new Map(
      stores.map((row) => [String(row.secondId), row.firstId]),
    );
    const timezone = tenant.timezone;
    for (const dealer of dealers) {
      const orgId = storeOf.get(String(dealer._id)) ?? tenantId;
      try {
        await this.licenseReminder(dealer, license, {
          tenantId,
          orgId,
          timezone,
          scheduledFor,
        });
        await this.rentReminder(dealer, rent, {
          tenantId,
          orgId,
          timezone,
          scheduledFor,
        });
      } catch (error) {
        // 單一經銷商失敗不擋後面的(下一輪再試;dedupeKey 保證不重複)
        this.logger.error(
          `經銷商 ${String(dealer._id)} 的提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async licenseReminder(
    dealer: DealerRecord,
    effective: EffectiveSchedule,
    at: ReminderTarget,
  ): Promise<void> {
    const expiresOn = localDayOf(dealer.licenseExpiresAt, at.timezone);
    const hit = scheduleHitAt(effective.schedule, {
      scheduledFor: at.scheduledFor,
      timezone: at.timezone,
      date: expiresOn,
      modifiedAt: effective.modifiedAt,
    });
    if (hit === null) {
      return;
    }
    const expiresText = localDateText(expiresOn);
    await this.notifications.notify({
      type: LOTTERY_LICENSE_EXPIRING,
      tenantId: at.tenantId,
      orgId: at.orgId,
      params: {
        dealerType: DEALER_TYPE_NAMES[dealer.type],
        dealerName: dealer.name,
        expiresOn: expiresText,
        daysLeft: String(hit.daysBefore ?? 0),
      },
      dedupeKey: `${LOTTERY_LICENSE_EXPIRING}:${String(dealer._id)}:${expiresText}:${hit.occurrence}`,
    });
  }

  private async rentReminder(
    dealer: DealerRecord,
    effective: EffectiveSchedule,
    at: ReminderTarget,
  ): Promise<void> {
    const rent = rentOf(dealer);
    if (rent === null || effective.schedule.kind !== "days-before") {
      return;
    }
    const hit = this.rentHit(rent, effective, at);
    if (hit === null) {
      return;
    }
    const dueText = localDateText(hit.dueOn);
    await this.notifications.notify({
      type: LOTTERY_STORE_RENT_DUE,
      tenantId: at.tenantId,
      orgId: at.orgId,
      params: {
        dealerName: dealer.storeName ?? dealer.name,
        dueOn: dueText,
        amount:
          dealer.rentFee === null
            ? null
            : dealer.rentFee.toLocaleString("en-US"),
      },
      dedupeKey: `${LOTTERY_STORE_RENT_DUE}:${String(dealer._id)}:${dueText}:${hit.hit.occurrence}`,
    });
  }

  /**
   * 牌租的目標日不只一個(每期一個):應寄時點只可能落在排程這一刻的今天或昨天,
   * 所以目標日 = 今天 / 昨天 + 提前天數,其中是繳費日的才交給 `scheduleHitAt` 判斷。
   */
  private rentHit(
    rent: RentSetting,
    effective: EffectiveSchedule,
    at: ReminderTarget,
  ): { hit: ScheduleHit; dueOn: LocalDate } | null {
    if (effective.schedule.kind !== "days-before") {
      return null;
    }
    const today = localDayOf(at.scheduledFor, at.timezone);
    for (const days of effective.schedule.daysBefore) {
      for (const base of [today, addDays(today, -1)]) {
        const dueOn = addDays(base, days);
        if (!isRentDueDate(dueOn, rent)) {
          continue;
        }
        const hit = scheduleHitAt(effective.schedule, {
          scheduledFor: at.scheduledFor,
          timezone: at.timezone,
          date: dueOn,
          modifiedAt: effective.modifiedAt,
        });
        if (hit !== null) {
          return { hit, dueOn };
        }
      }
    }
    return null;
  }
}

interface ReminderTarget {
  tenantId: Types.ObjectId;
  orgId: Types.ObjectId;
  timezone: string;
  scheduledFor: Date;
}
