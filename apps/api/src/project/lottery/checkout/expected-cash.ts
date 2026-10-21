import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  CASH_CORRECTION_FORM_KEY,
  type ExpectedCashItemKind,
  REDEMPTION_STATUS,
  SALE_REVERSAL_FORM_KEY,
  TICKET_EVENT_TYPE,
} from "@repo/domain/project/lottery";
import { CASH_MOVEMENT_TYPE } from "@repo/domain/project/lottery-accounts";

import { FormSubmissionsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { LotteryCashMovementsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import type {
  CheckoutCashEntry,
  CheckoutCashItem,
} from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import type { DrawerShift } from "../store/drawer-cash";

/** 售出類事件(+)與撤銷(−);盤點補登售出也是售出。 */
const SALE_TYPES: readonly string[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
];
const UNDO_TYPES: readonly string[] = [TICKET_EVENT_TYPE.saleUndo];

/** 現金流水類型 → 應有現金的項;流入抽屜 +、流出 −(`refund` 一定是流出、更正依方向)。 */
const MOVEMENT_KIND: Readonly<Record<string, ExpectedCashItemKind>> = {
  [CASH_MOVEMENT_TYPE.deposit]: "deposits",
  [CASH_MOVEMENT_TYPE.withdraw]: "withdrawals",
  [CASH_MOVEMENT_TYPE.transferOut]: "transfer_out",
  [CASH_MOVEMENT_TYPE.transferIn]: "transfer_in",
  [CASH_MOVEMENT_TYPE.refund]: "refunds",
  [CASH_MOVEMENT_TYPE.correctionIncrease]: "corrections",
  [CASH_MOVEMENT_TYPE.correctionDecrease]: "corrections",
};

/** 公式的順序(規格 6.9):期初 + 銷售 − 兌獎 − 投庫 + 出庫 − 調貨支出 + 調貨收入 − 退貨退款 ± 現金更正。 */
const ITEM_ORDER: readonly ExpectedCashItemKind[] = [
  "opening",
  "sales",
  "redemptions",
  "deposits",
  "withdrawals",
  "transfer_out",
  "transfer_in",
  "refunds",
  "corrections",
];

/** 流水指回的單據(撤銷售出申請、現金更正單、調貨單)用單號當顯示文字。 */
const SUBMISSION_REF_TYPES: ReadonlySet<string> = new Set([
  "store",
  SALE_REVERSAL_FORM_KEY,
  CASH_CORRECTION_FORM_KEY,
  "purchasing.transfer",
]);

/**
 * 應有現金的各項明細(規格 6.9;抽屜應有的來源 `drawer-cash.ts` 只給合計,交班精靈與結帳單要逐項列出、
 * 每筆可點回單據):**只算已完成的單據、不含事後更正**(`postCloseOf`),和 `expectedDrawerCash` 同一套來源,
 * 合計一定相等(`checkout.test.ts` 逐項驗)。`reader` 是呼叫端的讀取身分(操作者,或租戶邊界的系統身分)。
 */
@Injectable()
export class ExpectedCashItems {
  constructor(
    private readonly events: LotteryTicketEventsRepository,
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly movements: LotteryCashMovementsRepository,
    private readonly submissions: FormSubmissionsRepository,
  ) {}

  async of(
    reader: OperatorContext,
    shift: DrawerShift,
    session?: ClientSession,
  ): Promise<CheckoutCashItem[]> {
    const options = session === undefined ? {} : { session };
    const items = new Map<ExpectedCashItemKind, CheckoutCashItem>(
      ITEM_ORDER.map((kind) => [
        kind,
        { kind, count: 0, amount: 0, entries: [] },
      ]),
    );
    const push = (kind: ExpectedCashItemKind, entry: CheckoutCashEntry) => {
      const item = items.get(kind);
      if (item !== undefined) {
        item.count += 1;
        item.amount += entry.amount;
        item.entries.push(entry);
      }
    };
    const opening = items.get("opening");
    if (opening !== undefined) {
      opening.amount = shift.openingFloat;
    }

    // 銷售:售出(含盤點補登)+、當下撤銷 −;只給張數與金額,不逐張列
    const saleRows = await this.events.aggregate(
      reader,
      [
        {
          $match: {
            shiftId: shift._id,
            postCloseOf: null,
            cashEffect: { $in: ["increase", "decrease"] },
          },
        },
        {
          $group: {
            _id: null,
            count: {
              $sum: {
                $cond: [
                  { $in: ["$type", UNDO_TYPES] },
                  { $multiply: [-1, "$quantity"] },
                  { $cond: [{ $in: ["$type", SALE_TYPES] }, "$quantity", 0] },
                ],
              },
            },
            amount: {
              $sum: {
                $cond: [
                  { $eq: ["$cashEffect", "increase"] },
                  "$amount",
                  { $multiply: [-1, "$amount"] },
                ],
              },
            },
          },
        },
      ],
      options,
    );
    const sales = items.get("sales");
    if (sales !== undefined) {
      sales.count = Number(saleRows[0]?.count ?? 0);
      sales.amount = Number(saleRows[0]?.amount ?? 0);
    }

    // 兌獎:班開著時登記、沒有在班開著時撤銷的(交班後的撤銷 / 新增是事後更正,不算)
    const redemptionRows = await this.redemptions.findMany(
      reader,
      { shiftId: shift._id, postCloseOf: null },
      { sort: { redeemedAt: 1, _id: 1 }, ...options },
    );
    for (const row of redemptionRows) {
      const revokedWhileOpen =
        row.status === REDEMPTION_STATUS.revoked &&
        row.revokePostCloseOf === null;
      if (revokedWhileOpen) {
        continue;
      }
      push("redemptions", {
        refType: "redemption",
        refId: row._id,
        label: row.ticketLabel,
        occurredAt: row.redeemedAt,
        amount: -row.prizeAmount,
      });
    }

    await this.pushMovements(reader, shift, options, push);
    return ITEM_ORDER.flatMap((kind) => {
      const item = items.get(kind);
      return item === undefined ? [] : [item];
    });
  }

  /** 現金流水:投庫 −、出庫 +(扣掉開班領零用金那一筆,已是期初)、調貨 ±、退貨退款 −、現金更正 ±。 */
  private async pushMovements(
    reader: OperatorContext,
    shift: DrawerShift,
    options: { session?: ClientSession },
    push: (kind: ExpectedCashItemKind, entry: CheckoutCashEntry) => void,
  ): Promise<void> {
    const movementRows = await this.movements.findMany(
      reader,
      {
        shiftId: shift._id,
        postCloseOf: null,
        $or: [{ from: "drawer" }, { to: "drawer" }],
      },
      { sort: { occurredAt: 1, _id: 1 }, ...options },
    );
    const serials = await this.serialsOf(
      reader,
      movementRows.flatMap((row) =>
        row.refId !== null &&
        row.refType !== null &&
        SUBMISSION_REF_TYPES.has(row.refType)
          ? [row.refId]
          : [],
      ),
      options,
    );
    for (const row of movementRows) {
      if (
        shift.openingMovementId !== null &&
        row._id.equals(shift.openingMovementId)
      ) {
        continue;
      }
      const kind = MOVEMENT_KIND[row.type];
      if (kind === undefined) {
        continue;
      }
      const signed = row.to === "drawer" ? row.amount : -row.amount;
      push(kind, {
        refType: "movement",
        refId: row._id,
        label:
          (row.refId === null ? null : serials.get(String(row.refId))) ??
          row.note ??
          "",
        occurredAt: row.occurredAt,
        amount: signed,
      });
    }
  }

  /** 流水指回的單據 → 單號(點回單據時顯示)。 */
  private async serialsOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
    options: { session?: ClientSession },
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.submissions.findMany(
      reader,
      { _id: { $in: [...ids] } },
      { select: "serialNo", ...options },
    );
    return new Map(
      rows.flatMap((row) =>
        typeof row.serialNo === "string"
          ? [[String(row._id), row.serialNo] as const]
          : [],
      ),
    );
  }
}
