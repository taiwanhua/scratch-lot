import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  type PurchaseRedemptionValue,
  REDEMPTION_STATUS,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { REDEMPTION_REASONS, validationError } from "./redemption-error";

/** 進貨單送兌的對象。 */
export interface RedemptionPurchaseRef {
  tenantId: Types.ObjectId | null;
  submissionId: Types.ObjectId;
}

const toId = (id: string) =>
  Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

/**
 * 進貨單勾選兌獎(規格 8.2「兌獎」;`LotteryRedemptionModule` 匯出,進貨單的掛接點在同一個交易呼叫):
 *
 * - `problemOf`:送出前檢查勾選的兌獎紀錄 —— 都在進貨分店、「店內持有」(或已勾在這張單上)、金額和紀錄相同
 * - `markSent`:送出後勾選的改「已送兌」(記 `purchaseSubmissionId`、`sentAt`);這張單之前勾、這次沒勾的回到店內持有;
 *   被搶先撤銷 / 勾走 → `VALIDATION_FAILED`(`PURCHASE_REDEMPTION_INVALID`),交易回復
 * - `release`:撤回 / 退回 / 駁回 / 作廢 → 這張單勾的全部回到「店內持有」
 *
 * 進貨單是總部建的、掛接點以系統身分執行,兌獎紀錄在分店:讀寫以租戶邊界(登記在
 * `project/database/tenant-boundary-callers.ts`,用途「反查」「例外寫入」),條件再釘這張單。
 */
@Injectable()
export class RedemptionPurchaseLink {
  constructor(
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  private readerOf(tenantId: Types.ObjectId | null): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  /** 勾選的兌獎紀錄有問題 → 說明;沒問題 → null。 */
  async problemOf(
    ref: RedemptionPurchaseRef,
    branchId: string | null,
    selected: readonly PurchaseRedemptionValue[],
  ): Promise<string | null> {
    if (selected.length === 0) {
      return null;
    }
    const branch = branchId === null ? null : toId(branchId);
    const ids = selected.map((row) => toId(row.redemptionId));
    if (branch === null || ids.includes(null)) {
      return "invalid redemption reference";
    }
    const reader = await this.readerOf(ref.tenantId);
    const rows = await this.redemptions.findMany(reader, {
      _id: { $in: ids as Types.ObjectId[] },
    });
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    for (const value of selected) {
      const row = byId.get(value.redemptionId);
      if (!row?.orgId.equals(branch)) {
        return "redemption is not in the purchasing branch";
      }
      const available =
        row.status === REDEMPTION_STATUS.inStore ||
        (row.status === REDEMPTION_STATUS.sent &&
          row.purchaseSubmissionId?.equals(ref.submissionId) === true);
      if (!available) {
        return "redemption is not held in store";
      }
      if (row.prizeAmount !== value.prizeAmount) {
        return "prize amount differs from the redemption";
      }
    }
    return null;
  }

  /** 勾選的 → 已送兌;這張單之前勾、這次沒勾的 → 店內持有。被別人搶先撤銷 / 勾走 → 拋錯(交易回復)。 */
  async markSent(
    session: ClientSession | undefined,
    ref: RedemptionPurchaseRef,
    selected: readonly PurchaseRedemptionValue[],
  ): Promise<void> {
    const reader = await this.readerOf(ref.tenantId);
    const ids = selected.flatMap((row) => {
      const id = toId(row.redemptionId);
      return id === null ? [] : [id];
    });
    await this.redemptions.updateMany(
      reader,
      {
        tenantId: ref.tenantId,
        purchaseSubmissionId: ref.submissionId,
        status: REDEMPTION_STATUS.sent,
        _id: { $nin: ids },
      },
      {
        $set: {
          status: REDEMPTION_STATUS.inStore,
          purchaseSubmissionId: null,
          sentAt: null,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    const sentAt = new Date();
    for (const id of ids) {
      const next = await this.redemptions.findOneAndUpdate(
        reader,
        {
          _id: id,
          tenantId: ref.tenantId,
          $or: [
            { status: REDEMPTION_STATUS.inStore },
            {
              status: REDEMPTION_STATUS.sent,
              purchaseSubmissionId: ref.submissionId,
            },
          ],
        },
        {
          $set: {
            status: REDEMPTION_STATUS.sent,
            purchaseSubmissionId: ref.submissionId,
            sentAt,
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (next === null) {
        throw validationError(
          `redemption ${String(id)} is no longer held in store`,
          ["redemptions"],
          REDEMPTION_REASONS.purchaseRedemptionInvalid,
        );
      }
    }
  }

  /** 這張單勾的全部回到「店內持有」。 */
  async release(
    session: ClientSession | undefined,
    ref: RedemptionPurchaseRef,
  ): Promise<void> {
    const reader = await this.readerOf(ref.tenantId);
    await this.redemptions.updateMany(
      reader,
      {
        tenantId: ref.tenantId,
        purchaseSubmissionId: ref.submissionId,
        status: REDEMPTION_STATUS.sent,
      },
      {
        $set: {
          status: REDEMPTION_STATUS.inStore,
          purchaseSubmissionId: null,
          sentAt: null,
        },
        $inc: { version: 1 },
      },
      { session },
    );
  }
}
