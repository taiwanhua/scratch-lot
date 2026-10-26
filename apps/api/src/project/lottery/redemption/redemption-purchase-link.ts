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

  /**
   * 勾選的 → 已送兌(記送兌歷程);這張單之前勾、這次沒勾的 → 店內持有(歷程記回到店內持有的時間)。
   * 重送時已是這張單送兌的不動(送兌時間不改寫)。被別人搶先撤銷 / 勾走 → 拋錯(交易回復)。
   */
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
    const now = new Date();
    await this.releaseWhere(session, reader, now, {
      tenantId: ref.tenantId,
      purchaseSubmissionId: ref.submissionId,
      status: REDEMPTION_STATUS.sent,
      _id: { $nin: ids },
    });
    const unique = [...new Map(ids.map((id) => [String(id), id])).values()];
    if (unique.length === 0) {
      return;
    }
    // 一次條件更新(店內持有的);已是這張單送兌的不動
    await this.redemptions.updateMany(
      reader,
      {
        _id: { $in: unique },
        tenantId: ref.tenantId,
        status: REDEMPTION_STATUS.inStore,
      },
      {
        $set: {
          status: REDEMPTION_STATUS.sent,
          purchaseSubmissionId: ref.submissionId,
          sentAt: now,
        },
        $push: {
          sentHistory: {
            sentAt: now,
            releasedAt: null,
            purchaseSubmissionId: ref.submissionId,
          },
        },
        $inc: { version: 1 },
      },
      { session },
    );
    // 寫完應該全部是這張單送兌的;不是 = 有幾筆被別人搶先撤銷 / 勾走
    const sentRows = await this.redemptions.findMany(
      reader,
      {
        _id: { $in: unique },
        status: REDEMPTION_STATUS.sent,
        purchaseSubmissionId: ref.submissionId,
      },
      { select: "_id", session },
    );
    if (sentRows.length === unique.length) {
      return;
    }
    const written = new Set(sentRows.map((row) => String(row._id)));
    const missed = unique.find((id) => !written.has(String(id))) ?? unique[0];
    throw validationError(
      `redemption ${String(missed)} is no longer held in store`,
      ["redemptions"],
      REDEMPTION_REASONS.purchaseRedemptionInvalid,
    );
  }

  /** 這張單勾的全部回到「店內持有」(送兌歷程記回到店內持有的時間)。 */
  async release(
    session: ClientSession | undefined,
    ref: RedemptionPurchaseRef,
  ): Promise<void> {
    const reader = await this.readerOf(ref.tenantId);
    await this.releaseWhere(session, reader, new Date(), {
      tenantId: ref.tenantId,
      purchaseSubmissionId: ref.submissionId,
      status: REDEMPTION_STATUS.sent,
    });
  }

  private async releaseWhere(
    session: ClientSession | undefined,
    reader: OperatorContext,
    at: Date,
    filter: Record<string, unknown>,
  ): Promise<void> {
    // 舊資料沒有送兌歷程:先補空陣列(陣列篩選要欄位存在)
    await this.redemptions.updateMany(
      reader,
      { ...filter, sentHistory: { $exists: false } },
      { $set: { sentHistory: [] } },
      { session },
    );
    await this.redemptions.updateMany(
      reader,
      filter,
      {
        $set: {
          status: REDEMPTION_STATUS.inStore,
          purchaseSubmissionId: null,
          sentAt: null,
          "sentHistory.$[open].releasedAt": at,
        },
        $inc: { version: 1 },
      },
      { session, arrayFilters: [{ "open.releasedAt": null }] },
    );
  }
}
