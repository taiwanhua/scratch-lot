import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REDEMPTION_STATUS,
  TICKET_EVENT_TYPE,
} from "@repo/domain/project/lottery";
import { CASH_MOVEMENT_TYPE } from "@repo/domain/project/lottery-accounts";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryCashMovementsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";

/**
 * 事後更正的原因類別(規格 6.12「報表依原因彙總」):兌獎(撤銷 / 撤銷並重新登記)、盤點補登、
 * 退貨退款(撤銷售出申請)、現金更正(現金更正單);其他張數事件(目前沒有)歸 `other`。
 */
export const POST_CLOSE_CATEGORIES = [
  "redemption",
  "stocktake",
  "refund",
  "cashCorrection",
  "other",
] as const;
export type PostCloseCategory = (typeof POST_CLOSE_CATEGORIES)[number];

/** 一筆事後更正:指向哪一班、對那一班抽屜的影響(帶正負號)、什麼時候記的。 */
export interface PostCloseRow {
  shiftId: string;
  category: PostCloseCategory;
  amount: number;
  recordedAt: Date;
}

/** 找哪些事後更正:指向這些班的(任何時候記的),或某家店某段期間記的(指向哪一班都算)。 */
export type PostCloseMatch =
  | { shiftIds: readonly Types.ObjectId[] }
  | { orgId: Types.ObjectId; from: Date; to: Date };

const CORRECTION_TYPES: ReadonlySet<string> = new Set([
  CASH_MOVEMENT_TYPE.correctionIncrease,
  CASH_MOVEMENT_TYPE.correctionDecrease,
]);

/**
 * 事後更正逐筆讀出(規格 6.12;三個來源與交班結帳的 `ticketEventsPostCloseNet` / `CashLedgerService.postCloseNet` /
 * `redemptionPostCloseNet` 同一套規則,這裡多記類別與記錄時間,給報表依原因彙總、分出前期更正):
 *
 * - 張數事件 `postCloseOf`:增加 +、減少 −(盤點補登售出 = `stocktake`)
 * - 現金流水 `postCloseOf`:流入抽屜 +、流出 −(退貨退款 = `refund`、現金更正 = `cashCorrection`)
 * - 兌獎:交班後登記的(`postCloseOf`)−、交班後撤銷的(`revokePostCloseOf` 且已撤銷)+
 *
 * 讀取用呼叫端的讀取身分(報表是租戶邊界、條件已釘分店 / 班)。
 */
@Injectable()
export class PostCloseCorrections {
  constructor(
    private readonly events: LotteryTicketEventsRepository,
    private readonly movements: LotteryCashMovementsRepository,
    private readonly redemptions: LotteryRedemptionsRepository,
  ) {}

  async rowsOf(
    reader: OperatorContext,
    match: PostCloseMatch,
  ): Promise<PostCloseRow[]> {
    if ("shiftIds" in match && match.shiftIds.length === 0) {
      return [];
    }
    const [events, movements, redemptions] = await Promise.all([
      this.eventRows(reader, match),
      this.movementRows(reader, match),
      this.redemptionRows(reader, match),
    ]);
    return [...events, ...movements, ...redemptions];
  }

  private async eventRows(
    reader: OperatorContext,
    match: PostCloseMatch,
  ): Promise<PostCloseRow[]> {
    const filter =
      "shiftIds" in match
        ? { postCloseOf: { $in: [...match.shiftIds] } }
        : {
            orgId: match.orgId,
            at: { $gte: match.from, $lt: match.to },
            postCloseOf: { $ne: null },
          };
    const rows = await this.events.findMany(
      reader,
      { ...filter, cashEffect: { $in: ["increase", "decrease"] } },
      { select: "postCloseOf type cashEffect amount at" },
    );
    return rows.map((row) => ({
      shiftId: String(row.postCloseOf),
      category:
        row.type === TICKET_EVENT_TYPE.saleStocktake ? "stocktake" : "other",
      amount: row.cashEffect === "increase" ? row.amount : -row.amount,
      recordedAt: row.at,
    }));
  }

  private async movementRows(
    reader: OperatorContext,
    match: PostCloseMatch,
  ): Promise<PostCloseRow[]> {
    const filter =
      "shiftIds" in match
        ? { postCloseOf: { $in: [...match.shiftIds] } }
        : {
            orgId: match.orgId,
            occurredAt: { $gte: match.from, $lt: match.to },
            postCloseOf: { $ne: null },
          };
    const rows = await this.movements.findMany(
      reader,
      { ...filter, $or: [{ from: "drawer" }, { to: "drawer" }] },
      { select: "postCloseOf type from to amount occurredAt" },
    );
    return rows.map((row) => {
      let category: PostCloseCategory = "other";
      if (row.type === CASH_MOVEMENT_TYPE.refund) {
        category = "refund";
      } else if (CORRECTION_TYPES.has(row.type)) {
        category = "cashCorrection";
      }
      return {
        shiftId: String(row.postCloseOf),
        category,
        amount: row.to === "drawer" ? row.amount : -row.amount,
        recordedAt: row.occurredAt,
      };
    });
  }

  private async redemptionRows(
    reader: OperatorContext,
    match: PostCloseMatch,
  ): Promise<PostCloseRow[]> {
    const added =
      "shiftIds" in match
        ? { postCloseOf: { $in: [...match.shiftIds] } }
        : {
            orgId: match.orgId,
            redeemedAt: { $gte: match.from, $lt: match.to },
            postCloseOf: { $ne: null },
          };
    const revoked =
      "shiftIds" in match
        ? { revokePostCloseOf: { $in: [...match.shiftIds] } }
        : {
            orgId: match.orgId,
            revokedAt: { $gte: match.from, $lt: match.to },
            revokePostCloseOf: { $ne: null },
          };
    const rows = await this.redemptions.findMany(
      reader,
      { $or: [added, revoked] },
      {
        select:
          "orgId prizeAmount status redeemedAt revokedAt postCloseOf revokePostCloseOf",
      },
    );
    const inMatch = (at: Date | null, shiftId: Types.ObjectId | null) => {
      if (shiftId === null || at === null) {
        return false;
      }
      if ("shiftIds" in match) {
        return match.shiftIds.some((id) => id.equals(shiftId));
      }
      return at >= match.from && at < match.to;
    };
    return rows.flatMap((row): PostCloseRow[] => {
      const result: PostCloseRow[] = [];
      if (inMatch(row.redeemedAt, row.postCloseOf)) {
        result.push({
          shiftId: String(row.postCloseOf),
          category: "redemption",
          amount: -row.prizeAmount,
          recordedAt: row.redeemedAt,
        });
      }
      if (
        row.status === REDEMPTION_STATUS.revoked &&
        row.revokedAt !== null &&
        inMatch(row.revokedAt, row.revokePostCloseOf)
      ) {
        result.push({
          shiftId: String(row.revokePostCloseOf),
          category: "redemption",
          amount: row.prizeAmount,
          recordedAt: row.revokedAt,
        });
      }
      return result;
    });
  }
}

/** 依類別彙總(類別順序固定、0 筆的不列)。 */
export function postCloseByCategory(
  rows: readonly PostCloseRow[],
): { category: PostCloseCategory; count: number; amount: number }[] {
  return POST_CLOSE_CATEGORIES.flatMap((category) => {
    const matched = rows.filter((row) => row.category === category);
    return matched.length === 0
      ? []
      : [
          {
            category,
            count: matched.length,
            amount: matched.reduce((sum, row) => sum + row.amount, 0),
          },
        ];
  });
}
