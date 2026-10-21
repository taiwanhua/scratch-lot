import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryDealersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";

/** 一個批購日來源給的候選日期(沒有就 null)。 */
export interface PurchaseDateCandidates {
  lastPurchaseDate: Date | null;
  lastSelfPurchaseDate: Date | null;
}

/**
 * 批購日的另一個來源(進貨單:有效進貨單上最新的批購日期)。由進貨單的功能在 `onModuleInit`
 * 呼叫 `registerSource` 登記;本模組只看基準日。
 */
export type PurchaseDateSource = (
  session: ClientSession | null,
  tenantId: Types.ObjectId | null,
  dealerId: Types.ObjectId,
) => Promise<PurchaseDateCandidates>;

const latest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>(
    (best, date) =>
      date !== null && (best === null || date > best) ? date : best,
    null,
  );

/**
 * 甲類的「最近一次批購日 / 本人批購日」(專案規格 5.2):存成欄位 `lastPurchaseDate` /
 * `lastSelfPurchaseDate`,值 = max(基準日, 各來源的候選日期)。
 *
 * - 經銷商的基準日改了 → 經銷商管理在同一個交易裡呼叫
 * - 進貨單送出 / 駁回 / 作廢 → 進貨單在同一個交易裡呼叫(並以 `registerSource` 提供進貨單那一份)
 *
 * 介面固定:`recomputeDealerPurchaseDates(session, tenantId, dealerId)`。
 */
@Injectable()
export class DealerPurchaseDates {
  private readonly sources: PurchaseDateSource[] = [];

  constructor(
    private readonly dealers: LotteryDealersRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  registerSource(source: PurchaseDateSource): void {
    this.sources.push(source);
  }

  async recomputeDealerPurchaseDates(
    session: ClientSession | null,
    tenantId: Types.ObjectId | null,
    dealerId: Types.ObjectId,
  ): Promise<void> {
    // 根組織沒有經銷商(經銷商一律屬於某個租戶)
    if (tenantId === null) {
      return;
    }
    const options = session === null ? {} : { session };
    // 進貨單 / 經銷商在交易內呼叫:以租戶系統身分讀寫這一筆(條件另釘 `_id` + `tenantId`)
    const writer = await tenantBoundaryContext(this.orgs, null, tenantId);
    const dealer = await this.dealers.findOne(
      writer,
      { _id: dealerId, tenantId },
      options,
    );
    if (dealer?.type !== "a") {
      return;
    }
    const candidates: PurchaseDateCandidates[] = [];
    for (const source of this.sources) {
      candidates.push(await source(session, tenantId, dealerId));
    }
    const lastPurchaseDate = latest([
      dealer.lastPurchaseBaseDate,
      ...candidates.map((candidate) => candidate.lastPurchaseDate),
    ]);
    const lastSelfPurchaseDate = latest([
      dealer.lastSelfPurchaseBaseDate,
      ...candidates.map((candidate) => candidate.lastSelfPurchaseDate),
    ]);
    await this.dealers.updateById(
      writer,
      dealer._id,
      { $set: { lastPurchaseDate, lastSelfPurchaseDate } },
      options,
    );
  }
}
