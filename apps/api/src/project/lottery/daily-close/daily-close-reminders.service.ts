import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import { localDateOf, localDateText } from "@repo/domain/form";

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
import {
  LOTTERY_DAILY_CLOSE_OVERDUE,
  LOTTERY_STORE_BOARD_REF,
} from "../../notifications";
import { DailyCloseLedger } from "./daily-close-ledger";
import { isDailyCloseOverdue } from "./daily-close-overdue";

/** 排程工作 key(`docs/deployment.md`「Cloud Scheduler」;全域唯一)。 */
export const DAILY_CLOSE_OVERDUE_JOB_KEY = "lottery.daily-close-overdue";

/**
 * 日結逾期(B14;專案規格 3.4、3.5、6.10):這家店最早一張還沒被日結涵蓋計算的交班結帳,**送出日的隔天起每天**
 * 寄送時間(預設 09:00,租戶時區;通知設定頁可調,寫法「逾期後每天」)→ 負責人提醒(組織範圍 = 這家店本身,
 * 預設人員條件 = 店長)。同一家店一天一則(`dedupeKey` 帶分店與當天的時點);被日結涵蓋計算後就不再寄。
 * 每 15 分鐘跑一次;「這個時點該不該寄」用底座的 `scheduleHitAt`(6 小時內漏跑補寄、改了時間不補)。
 */
@Injectable()
export class DailyCloseRemindersService implements OnModuleInit {
  private readonly logger = new Logger(DailyCloseRemindersService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationService,
    private readonly dailyLedger: DailyCloseLedger,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: DAILY_CLOSE_OVERDUE_JOB_KEY,
      every: "15m",
      handler: (context) => this.run(context),
    });
  }

  /** 一次排程:逐租戶(根組織沒有店面)。 */
  async run(context: ScheduledJobContext): Promise<void> {
    for (const tenant of context.tenants) {
      if (tenant.tenantId === null) {
        continue;
      }
      try {
        await this.runTenant(tenant.tenantId, tenant, context.scheduledFor);
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenant.tenantId)} 的日結逾期提醒失敗:${error instanceof Error ? error.message : String(error)}`,
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
      LOTTERY_DAILY_CLOSE_OVERDUE,
    );
    // 排程的租戶系統身分:可見範圍 = 這個租戶的整棵組織樹(ADR-0005「例外出口」)
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const earliest = await this.dailyLedger.earliestUncovered(reader);
    for (const [orgIdText, submittedAt] of earliest) {
      // 和側欄數字同一個逾期時點;之後每天的時點、漏跑補寄與去重照底座 `scheduleHitAt`
      if (
        !isDailyCloseOverdue(
          submittedAt,
          effective,
          tenant.timezone,
          scheduledFor,
        )
      ) {
        continue;
      }
      const since = localDateOf(submittedAt.getTime(), tenant.timezone);
      const hit = scheduleHitAt(effective.schedule, {
        scheduledFor,
        timezone: tenant.timezone,
        date: since,
        modifiedAt: effective.modifiedAt,
      });
      if (hit === null) {
        continue;
      }
      const org = await this.orgs.findById(reader, orgIdText);
      if (org === null) {
        continue;
      }
      await this.notifications.notify({
        type: LOTTERY_DAILY_CLOSE_OVERDUE,
        tenantId,
        orgId: org._id,
        params: { orgName: org.name, since: localDateText(since) },
        // 點進去 = 那家店的看板(頂部 [日結])
        ref: { type: LOTTERY_STORE_BOARD_REF, id: orgIdText },
        dedupeKey: `${LOTTERY_DAILY_CLOSE_OVERDUE}:${orgIdText}:${hit.occurrence}`,
      });
    }
  }
}
