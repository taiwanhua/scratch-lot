import { Injectable, type OnModuleInit } from "@nestjs/common";

import { STORE_KEY } from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { NotificationSettingsService } from "../../../notifications/notification-settings.service";
import { SidebarBadgeRegistry } from "../../../sidebar-badges/sidebar-badge-registry";
import { LOTTERY_DAILY_CLOSE_OVERDUE } from "../../notifications";
import { StoreClock } from "../store/store-clock";
import { DailyCloseLedger } from "./daily-close-ledger";
import { isDailyCloseOverdue } from "./daily-close-overdue";

/**
 * 側欄「店面管理」的數字(專案規格 3.4、6.10;底座 10.4 登記制):**日結逾期的店數** —— 這家店最早一張還沒被
 * 日結涵蓋計算的交班結帳,已經過了送出日隔天的寄送時間(與「日結逾期」提醒同一個時間,通知設定頁可調)。
 * 範圍照操作者的可見範圍。時間會讓數字變,沒有寫入就沒有信號:前端進站取一次、斷線時每 60 秒重抓(底座 10.4)。
 */
@Injectable()
export class StoreBadge implements OnModuleInit {
  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly settings: NotificationSettingsService,
    private readonly dailyLedger: DailyCloseLedger,
    private readonly orgs: OrgsRepository,
    private readonly clock: StoreClock,
  ) {}

  onModuleInit(): void {
    this.registry.registerBadge({
      moduleKey: STORE_KEY,
      // 通知設定頁「側欄數字」的說明(專案字典)
      descriptionKey: "admin.lotteryStore.badgeDescription",
      count: (operator) => this.count(operator),
    });
  }

  async count(operator: OperatorContext): Promise<number> {
    const current =
      operator.currentOrgId === null
        ? null
        : await this.orgs.findById(operator, operator.currentOrgId);
    const tenantId =
      current === null
        ? null
        : tenantIdOfOrg({ _id: current._id, ancestors: current.ancestors });
    if (tenantId === null) {
      return 0;
    }
    const earliest = await this.dailyLedger.earliestUncovered(operator);
    if (earliest.size === 0) {
      return 0;
    }
    const [timezone, effective] = await Promise.all([
      tenantTimezoneOf(this.orgs, operator, tenantId),
      this.settings.effectiveSchedule(tenantId, LOTTERY_DAILY_CLOSE_OVERDUE),
    ]);
    const now = this.clock.now();
    return [...earliest.values()].filter((submittedAt) =>
      isDailyCloseOverdue(submittedAt, effective, timezone, now),
    ).length;
  }
}
