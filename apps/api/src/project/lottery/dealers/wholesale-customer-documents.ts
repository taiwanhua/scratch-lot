import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryWholesaleCustomerLocksRepository } from "../../database/lottery-dealers/lottery-dealers.repository";

/**
 * 批售客戶要從批售單知道的兩件事(專案規格 21.2)。由批售單的功能在 `onModuleInit` 呼叫
 * `WholesaleCustomerDocuments.registerSource` 登記;本模組不認得批售單的資料表。
 */
export interface WholesaleCustomerDocumentSource {
  /** 這些客戶「已完成批售單」的最新出貨時間;沒有的客戶不放進回傳。 */
  lastShippedAt: (
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    customerIds: readonly Types.ObjectId[],
  ) => Promise<ReadonlyMap<string, Date>>;
  /**
   * 有沒有任何批售單(含草稿)引用這位客戶。在刪除的交易裡呼叫;問的是整個租戶,
   * 不限操作者看得到的單。
   */
  isReferenced: (
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    customerId: Types.ObjectId,
  ) => Promise<boolean>;
}

/**
 * 批售單來源的登記(做法同 `DealerPurchaseDates.registerSource` 與遊戲的引用檢查 `game-usage.ts`):
 * 沒有任何登記 = 沒有批售單 → 最近一次批售日無紀錄、沒有引用。
 */
@Injectable()
export class WholesaleCustomerDocuments {
  private readonly sources: WholesaleCustomerDocumentSource[] = [];

  constructor(
    private readonly locks: LotteryWholesaleCustomerLocksRepository,
  ) {}

  registerSource(source: WholesaleCustomerDocumentSource): void {
    this.sources.push(source);
  }

  /** 客戶 id → 最近一次批售的出貨時間(各來源取最晚)。 */
  async lastShippedAt(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    customerIds: readonly Types.ObjectId[],
  ): Promise<ReadonlyMap<string, Date>> {
    const latest = new Map<string, Date>();
    if (customerIds.length === 0) {
      return latest;
    }
    const found = await Promise.all(
      this.sources.map((source) =>
        source.lastShippedAt(operator, tenantId, customerIds),
      ),
    );
    for (const [id, date] of found.flatMap((dates) => [...dates])) {
      const current = latest.get(id);
      if (current === undefined || date > current) {
        latest.set(id, date);
      }
    }
    return latest;
  }

  /**
   * 交易內碰這位客戶的守門文件:「送出批售單」(掛接點 `submitted`)與「刪除客戶」都呼叫,兩個交易在這一筆上衝突、
   * 重跑的一方看得到對方,不會留下指到已刪除客戶的單。`operator` = 看得到整個租戶的上下文(呼叫端的租戶邊界);
   * 守門文件在新增客戶時建(`createLock`),沒有的(例:直接寫進資料庫的)在同一個交易裡先建。
   */
  async serialize(
    operator: OperatorContext,
    customer: { _id: Types.ObjectId; orgId: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    const touched = await this.locks.findOneAndUpdate(
      operator,
      { customerId: customer._id },
      { $inc: { version: 1 } },
      { session },
    );
    if (touched === null) {
      await this.createLock(operator, customer, session);
    }
  }

  /** 新增客戶時(同一個交易)建守門文件。 */
  async createLock(
    operator: OperatorContext,
    customer: { _id: Types.ObjectId; orgId: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    await this.locks.create(
      operator,
      { orgId: customer.orgId, customerId: customer._id, version: 0 },
      { session },
    );
  }

  async isReferenced(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    customerId: Types.ObjectId,
  ): Promise<boolean> {
    for (const source of this.sources) {
      if (await source.isReferenced(operator, tenantId, customerId)) {
        return true;
      }
    }
    return false;
  }
}
