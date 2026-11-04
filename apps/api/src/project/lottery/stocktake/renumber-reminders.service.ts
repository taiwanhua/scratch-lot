import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Types } from "mongoose";

import { addLocalDays, localDateOf, localDateText } from "@repo/domain/form";
import { renumberStoreDueAtOf } from "@repo/domain/project/lottery";
import { LOTTERY_SETTING_KEYS } from "@repo/domain/project/lottery-settings";

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
  LOTTERY_RENUMBER_DUE,
  LOTTERY_STORE_BOARD_REF,
} from "../../notifications";
import { StoreCountModeService } from "../settings/store-count-mode.service";

/** 排程工作 key(`docs/deployment.md`「Cloud Scheduler」;全域唯一)。 */
export const RENUMBER_DUE_JOB_KEY = "lottery.renumber-due";

/**
 * 補點編號到期(張數店規格第 10 節、16.8 RN4;照抄 `daily-close-reminders.service.ts`):張數店與轉換中的店,
 * 「補點編號提醒」的週期到了 → **到期當天起每天**寄送時間(預設 09:00,租戶時區;通知設定頁可調、可關)
 * 發負責人提醒(組織範圍 = 這家店本身,預設人員條件 = 店長)。同一家店一天一則(`dedupeKey` 帶分店與當天的時點);
 * 補點編號核准後到期時間往後算,就不再寄。每 15 分鐘跑一次,讀取一次讀完(張數店、設定、分店名稱各一次)。
 */
@Injectable()
export class RenumberRemindersService implements OnModuleInit {
  private readonly logger = new Logger(RenumberRemindersService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly notifications: NotificationService,
    private readonly countModes: StoreCountModeService,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: RENUMBER_DUE_JOB_KEY,
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
          `租戶 ${String(tenant.tenantId)} 的補點編號到期提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async runTenant(
    tenantId: Types.ObjectId,
    tenant: ScheduledJobTenant,
    scheduledFor: Date,
  ): Promise<void> {
    // 排程的租戶系統身分:可見範圍 = 這個租戶的整棵組織樹(ADR-0005「例外出口」)
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const storeIds = await this.countModes.countStoreIdsOf(reader, tenantId);
    if (storeIds.length === 0) {
      return;
    }
    const effective = await this.settings.effectiveSchedule(
      tenantId,
      LOTTERY_RENUMBER_DUE,
    );
    const [stores, orgs] = await Promise.all([
      this.countModes.storesOf(reader, tenantId, storeIds, [
        LOTTERY_SETTING_KEYS.renumberReminder,
      ]),
      this.orgs.findMany(
        reader,
        { _id: { $in: storeIds } },
        { select: "name" },
      ),
    ]);
    const names = new Map(orgs.map((org) => [String(org._id), org.name]));
    for (const orgId of storeIds) {
      const key = String(orgId);
      const store = stores.get(key);
      const record = store?.record ?? null;
      const dueAt =
        record === null
          ? null
          : renumberStoreDueAtOf(
              store?.settings.get(LOTTERY_SETTING_KEYS.renumberReminder) ?? "",
              {
                lastRenumberAt: record.lastRenumberAt ?? null,
                since: record.since ?? null,
              },
            );
      const name = names.get(key);
      if (dueAt === null || name === undefined) {
        continue;
      }
      // 「逾期後每天」從起算日的隔天寄:起算日 = 到期日的前一天 → 到期當天起每天
      const hit = scheduleHitAt(effective.schedule, {
        scheduledFor,
        timezone: tenant.timezone,
        date: addLocalDays(localDateOf(dueAt.getTime(), tenant.timezone), -1),
        modifiedAt: effective.modifiedAt,
      });
      if (hit === null) {
        continue;
      }
      const last = record?.lastRenumberAt ?? null;
      await this.notifications.notify({
        type: LOTTERY_RENUMBER_DUE,
        tenantId,
        orgId: new Types.ObjectId(key),
        params: {
          orgName: name,
          last:
            last === null
              ? ""
              : localDateText(localDateOf(last.getTime(), tenant.timezone)),
        },
        // 點進去 = 那家店的看板(頂部「建議補點編號」與 [日結])
        ref: { type: LOTTERY_STORE_BOARD_REF, id: key },
        dedupeKey: `${LOTTERY_RENUMBER_DUE}:${key}:${hit.occurrence}`,
      });
    }
  }
}
