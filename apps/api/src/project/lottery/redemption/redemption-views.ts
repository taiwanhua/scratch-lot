import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REDEMPTION_STATUS,
  STORE_PERMISSIONS,
  isRedemptionStatus,
  redemptionRevokeStateOf,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { FormSubmissionsRepository } from "../../../database/base/repositories";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import type { LotteryRedemptionDocument } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import type { StoreGrant } from "../store/store-access";
import type { LotteryRedemptionModel } from "./models/redemption.model";

export type RedemptionRecord = Persisted<LotteryRedemptionDocument>;

const uniqueIds = (ids: readonly (Types.ObjectId | null)[]) => [
  ...new Map(
    ids.flatMap((id) => (id === null ? [] : [[String(id), id] as const])),
  ).values(),
];

/**
 * 兌獎紀錄 → 畫面:遊戲名稱、收銀點、那一班(負責人 · 開班時間 · 已交班)、登記人 / 撤銷人、進貨單單號,
 * 與操作者的撤銷方式(`redemptionRevokeStateOf`)。人名、班次、進貨單以租戶為邊界讀(登記人可能是別家分店
 * 支援的人、進貨單是總部建的;用途「反查」)。
 */
@Injectable()
export class RedemptionViews {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly games: LotteryGamesRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly submissions: FormSubmissionsRepository,
  ) {}

  async toModels(
    operator: OperatorContext,
    rows: readonly RedemptionRecord[],
    grant: StoreGrant,
  ): Promise<LotteryRedemptionModel[]> {
    const [first] = rows;
    if (first === undefined) {
      return [];
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      first.tenantId,
    );
    const shiftIds = uniqueIds(rows.map((row) => row.shiftId));
    const [games, points, shifts, purchases] = await Promise.all([
      this.games.findMany(reader, {
        gameCode: { $in: [...new Set(rows.map((row) => row.gameCode))] },
      }),
      this.cashPoints.findMany(reader, {
        _id: { $in: uniqueIds(rows.map((row) => row.cashPointId)) },
      }),
      this.shifts.findMany(reader, { _id: { $in: shiftIds } }),
      this.submissions.findMany(
        reader,
        {
          _id: { $in: uniqueIds(rows.map((row) => row.purchaseSubmissionId)) },
        },
        { select: "serialNo" },
      ),
    ]);
    const users = await this.users.findMany(reader, {
      _id: {
        $in: uniqueIds([
          ...rows.flatMap((row) => [row.redeemedBy, row.revokedBy]),
          ...shifts.map((shift) => shift.openedBy),
        ]),
      },
    });
    const nameOf = new Map(users.map((user) => [String(user._id), user.name]));
    const gameOf = new Map(games.map((game) => [game.gameCode, game]));
    const pointOf = new Map(points.map((point) => [String(point._id), point]));
    const shiftOf = new Map(shifts.map((shift) => [String(shift._id), shift]));
    const purchaseOf = new Map(
      purchases.map((purchase) => [
        String(purchase._id),
        purchase.serialNo ?? null,
      ]),
    );
    const ref = (id: Types.ObjectId) => ({
      id: String(id),
      name: nameOf.get(String(id)) ?? "",
    });
    return rows.map((row) => {
      const shift = shiftOf.get(String(row.shiftId));
      const status = isRedemptionStatus(row.status)
        ? row.status
        : REDEMPTION_STATUS.inStore;
      const revoke = redemptionRevokeStateOf({
        status,
        isMine:
          operator.actorId !== null && row.redeemedBy.equals(operator.actorId),
        shiftOpen: shift?.closedAt === null,
        canRedeem: grant.has(STORE_PERMISSIONS.redeem),
        canUndoRedeem: grant.has(STORE_PERMISSIONS.undoRedeem),
      });
      return {
        id: String(row._id),
        orgId: String(row.orgId),
        gameCode: row.gameCode,
        gameName: gameOf.get(row.gameCode)?.name ?? null,
        bookNo: row.bookNo,
        ticketNo: row.ticketNo,
        ticketLabel: row.ticketLabel,
        isOwnStore: row.ticketId !== null,
        prizeAmount: row.prizeAmount,
        status,
        cashPoint: {
          id: String(row.cashPointId),
          name: pointOf.get(String(row.cashPointId))?.name ?? "",
        },
        shift: {
          id: String(row.shiftId),
          openedBy:
            shift === undefined ? { id: "", name: "" } : ref(shift.openedBy),
          openedAt: shift?.openedAt ?? row.redeemedAt,
          closed: shift?.closedAt !== null,
        },
        redeemedAt: row.redeemedAt,
        redeemedBy: ref(row.redeemedBy),
        purchase:
          row.purchaseSubmissionId === null
            ? null
            : {
                id: String(row.purchaseSubmissionId),
                serialNo:
                  purchaseOf.get(String(row.purchaseSubmissionId)) ?? null,
              },
        sentAt: row.sentAt,
        revokedAt: row.revokedAt,
        revokedBy: row.revokedBy === null ? null : ref(row.revokedBy),
        revokeReason: row.revokeReason,
        revokeReasonKey: row.revokeReasonKey,
        revokeNote: row.revokeNote,
        replacesId: row.replacesId === null ? null : String(row.replacesId),
        isPostClose: row.postCloseOf !== null,
        note: row.note,
        revokeMode: revoke.mode,
        revokeBlockedBySent: revoke.blockedBySent,
      };
    });
  }
}
