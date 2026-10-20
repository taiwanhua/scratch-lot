import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { OperatorContext } from "../../../database/operator-context";
import { SidebarBadgeRegistry } from "../../../sidebar-badges/sidebar-badge-registry";
import { LotteryDealersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";
import { thresholdsOf } from "./dealer-dates";
import { DEALERS_KEY } from "./dealer-keys";
import { DealersAccess } from "./dealers-access";

/**
 * 側欄「經銷商管理」的數字(專案規格 3.1、5.2;底座 10.4 登記制):符合任一條件的經銷商人數,
 * **同一位只算一次**,範圍照操作者的可見範圍;解約的不算,營業中與暫停的算。
 *
 * - 證照到期日在今天起 30 天內,或已過期
 * - 甲類的最近一次批購日或最近一次本人批購日距今**超過 180 天**(兩個都無紀錄的不算)
 *
 * 時間會讓數字變(過了一天),沒有寫入就沒有信號:前端進站取一次、斷線時每 60 秒重抓(底座 10.4)。
 * 經銷商新增 / 編輯後對操作者送 `badge:dealers`(`LotteryDealersService`)。
 */
@Injectable()
export class DealerBadge implements OnModuleInit {
  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly dealers: LotteryDealersRepository,
    private readonly access: DealersAccess,
  ) {}

  onModuleInit(): void {
    this.registry.registerBadge({
      moduleKey: DEALERS_KEY,
      count: (operator) => this.count(operator),
    });
  }

  async count(operator: OperatorContext, now?: Date): Promise<number> {
    const grant = await this.access.grantOf(operator, now);
    const thresholds = thresholdsOf(grant.today, grant.timezone);
    const purchaseBefore = thresholds.purchaseBefore();
    return this.dealers.count(operator, {
      status: { $ne: "terminated" },
      $or: [
        { licenseExpiresAt: { $lt: thresholds.licenseBefore } },
        {
          type: "a",
          $or: [
            { lastPurchaseDate: { $lt: purchaseBefore } },
            { lastSelfPurchaseDate: { $lt: purchaseBefore } },
          ],
        },
      ],
    });
  }
}
