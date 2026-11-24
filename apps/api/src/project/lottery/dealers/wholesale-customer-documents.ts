import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";

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
