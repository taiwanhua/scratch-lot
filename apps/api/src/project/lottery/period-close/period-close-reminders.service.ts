import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  addLocalMonths,
  localMonthDiff,
  localMonthOf,
  localMonthText,
  parseLocalDate,
} from "@repo/domain/form";
import { ACCOUNTS_TABS } from "@repo/domain/project/lottery-accounts";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { scheduleHitAt } from "../../../notifications/notification-schedule";
import { NotificationSettingsService } from "../../../notifications/notification-settings.service";
import { NotificationService } from "../../../notifications/notification.service";
import {
  type ScheduledJobContext,
  ScheduledJobRegistry,
  type ScheduledJobTenant,
} from "../../../scheduled-jobs/scheduled-job-registry";
import { LotteryPeriodClosesRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import {
  LOTTERY_ACCOUNTS_TAB_REF,
  LOTTERY_PERIOD_CLOSE_OVERDUE,
} from "../../notifications";

/** 排程工作 key(`docs/deployment.md`「Cloud Scheduler」;全域唯一)。 */
export const PERIOD_CLOSE_OVERDUE_JOB_KEY = "lottery.period-close-overdue";

/**
 * 關帳逾期(B14;專案規格 3.4、3.5、10.4):每月第 N 天的寄送時間(預設第 3 天 09:00,租戶時區;通知設定頁可調,
 * 寫法「每月第 N 天」,那個月沒有這一天用月底)檢查**上個月**還沒關帳 → 負責人提醒(組織範圍 = 租戶,
 * 預設收件人 = 持有 `accounts.close-period`)。同一個時點只寄一次(`dedupeKey` 帶租戶與時點)。
 * 上個月租戶還沒開始使用(租戶頂層建立在那之後)不寄。每 15 分鐘跑一次;「這個時點該不該寄」用底座的 `scheduleHitAt`。
 */
@Injectable()
export class PeriodCloseRemindersService implements OnModuleInit {
  private readonly logger = new Logger(PeriodCloseRemindersService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationService,
    private readonly closes: LotteryPeriodClosesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: PERIOD_CLOSE_OVERDUE_JOB_KEY,
      every: "15m",
      handler: (context) => this.run(context),
    });
  }

  /** 一次排程:逐租戶(根組織沒有帳)。 */
  async run(context: ScheduledJobContext): Promise<void> {
    for (const tenant of context.tenants) {
      if (tenant.tenantId === null) {
        continue;
      }
      try {
        await this.runTenant(tenant.tenantId, tenant, context.scheduledFor);
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenant.tenantId)} 的關帳逾期提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async runTenant(
    tenantId: Types.ObjectId,
    tenant: ScheduledJobTenant,
    scheduledFor: Date,
  ): Promise<void> {
    const effective = await this.settings.effectiveSchedule(
      tenantId,
      LOTTERY_PERIOD_CLOSE_OVERDUE,
    );
    const hit = scheduleHitAt(effective.schedule, {
      scheduledFor,
      timezone: tenant.timezone,
      modifiedAt: effective.modifiedAt,
    });
    if (hit === null) {
      return;
    }
    const hitDate = parseLocalDate(hit.localDate);
    if (hitDate === null) {
      return;
    }
    const previousMonth = addLocalMonths(hitDate, -1);
    const previous = localMonthText(previousMonth);
    // 排程的租戶系統身分(ADR-0005「例外出口」)
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const org = await this.orgs.findById(reader, tenantId, {
      select: "createdAt",
    });
    const startedAt = (org as { createdAt?: Date } | null)?.createdAt;
    if (
      startedAt !== undefined &&
      localMonthDiff(
        localMonthOf(startedAt.getTime(), tenant.timezone),
        previousMonth,
      ) < 0
    ) {
      return;
    }
    // 依序關帳:上個月關了 = 之前全都關了
    const closed = await this.closes.findOne(reader, { month: previous });
    if (closed !== null) {
      return;
    }
    await this.notifications.notify({
      type: LOTTERY_PERIOD_CLOSE_OVERDUE,
      tenantId,
      orgId: tenantId,
      params: { period: previous },
      // 點進去 = 帳戶管理的關帳分頁(分頁沒有月份參數,列出全部月份)
      ref: { type: LOTTERY_ACCOUNTS_TAB_REF, id: ACCOUNTS_TABS.close },
      dedupeKey: `${LOTTERY_PERIOD_CLOSE_OVERDUE}:${String(tenantId)}:${hit.occurrence}`,
    });
  }
}
