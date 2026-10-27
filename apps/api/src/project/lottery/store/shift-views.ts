import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { TICKET_EVENT_TYPE } from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import type { LotteryShiftDocument } from "../../database/lottery-store/lottery-shifts.repository";
import { expectedDrawerCash } from "./drawer-cash";
import type { LotteryStoreShiftModel } from "./models/lottery-store.model";

export type ShiftRecord = Persisted<LotteryShiftDocument>;

/** 售出 / 撤銷的事件(本班已售 = 售出 − 撤銷)。 */
const SALE_TYPES: readonly string[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
];
const UNDO_TYPES: readonly string[] = [TICKET_EVENT_TYPE.saleUndo];

/**
 * 班次 → 畫面(標題列、你開著的班):負責人名稱、抽屜應有(`expectedDrawerCash`)、本班已售。
 * 使用者名稱以租戶為邊界讀(負責人可能是別家分店支援的人;用途「反查」)。
 */
@Injectable()
export class StoreShiftViews {
  constructor(
    private readonly events: LotteryTicketEventsRepository,
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
  ) {}

  async userNames(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.users.findMany(reader, {
      _id: { $in: [...new Map(ids.map((id) => [String(id), id])).values()] },
    });
    return new Map(found.map((user) => [String(user._id), user.name]));
  }

  /** 每一班的本班已售(張 / 金額)。 */
  async soldOf(
    operator: OperatorContext,
    shiftIds: readonly Types.ObjectId[],
  ): Promise<Map<string, { count: number; amount: number }>> {
    if (shiftIds.length === 0) {
      return new Map();
    }
    const rows = await this.events.aggregate(operator, [
      {
        $match: {
          shiftId: { $in: [...shiftIds] },
          type: { $in: [...SALE_TYPES, ...UNDO_TYPES] },
        },
      },
      {
        $group: {
          _id: "$shiftId",
          count: {
            $sum: {
              $cond: [
                { $in: ["$type", UNDO_TYPES] },
                { $multiply: [-1, "$quantity"] },
                "$quantity",
              ],
            },
          },
          amount: {
            $sum: {
              $cond: [
                { $in: ["$type", UNDO_TYPES] },
                { $multiply: [-1, "$amount"] },
                "$amount",
              ],
            },
          },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        { count: Number(row.count ?? 0), amount: Number(row.amount ?? 0) },
      ]),
    );
  }

  async toModels(
    operator: OperatorContext,
    shifts: readonly ShiftRecord[],
    cashPointNames: ReadonlyMap<string, string>,
  ): Promise<LotteryStoreShiftModel[]> {
    if (shifts.length === 0) {
      return [];
    }
    const tenantId = shifts[0]?.tenantId ?? null;
    const [names, sold, expected] = await Promise.all([
      this.userNames(
        operator,
        tenantId,
        shifts.map((shift) => shift.openedBy),
      ),
      this.soldOf(
        operator,
        shifts.map((shift) => shift._id),
      ),
      Promise.all(shifts.map((shift) => expectedDrawerCash(operator, shift))),
    ]);
    return shifts.map((shift, index) => {
      const stats = sold.get(String(shift._id)) ?? { count: 0, amount: 0 };
      return {
        id: String(shift._id),
        cashPoint: {
          id: String(shift.cashPointId),
          name: cashPointNames.get(String(shift.cashPointId)) ?? "",
        },
        openedBy: {
          id: String(shift.openedBy),
          name: names.get(String(shift.openedBy)) ?? "",
        },
        openedAt: shift.openedAt,
        isMine:
          operator.actorId !== null && shift.openedBy.equals(operator.actorId),
        openingFloat: shift.openingFloat,
        expectedCash: expected[index] ?? shift.openingFloat,
        soldCount: stats.count,
        soldAmount: stats.amount,
        unmatchedEntry: shift.scheduleEntryId === null,
      };
    });
  }
}

/** 字串 id → ObjectId;不合法 → null。 */
export function parseId(
  value: string | null | undefined,
): Types.ObjectId | null {
  return typeof value === "string" && Types.ObjectId.isValid(value)
    ? new Types.ObjectId(value)
    : null;
}
