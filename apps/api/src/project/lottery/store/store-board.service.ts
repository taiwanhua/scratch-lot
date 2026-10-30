import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { COLLATION_LOCALE, compareDisplayName } from "@repo/domain/collation";
import { localDateOf, startOfLocalDay } from "@repo/domain/form";
import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  isLowStock,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { CashLedgerService } from "../cash/cash-ledger.service";
import type {
  LotteryStoreBoardBookModel,
  LotteryStoreBoardModel,
} from "./models/lottery-store.model";
import { StoreShiftViews, parseId } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreClock } from "./store-clock";
import { notFoundError } from "./store-error";

interface CounterGroup {
  cashPointId: Types.ObjectId;
  bookId: Types.ObjectId;
  total: number;
  remaining: number;
  soldToday: number;
}

/**
 * 看板(規格 6.1、6.2;正本 `docs/modules/project/store.md`「看板」):一家店的啟用中收銀點(依排序),
 * 每個收銀點的開著的班與檯面上的本(卡片)。要 `store.view`,分店在可見範圍內(看不到 → `NOT_FOUND`)。
 */
@Injectable()
export class StoreBoardService {
  constructor(
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly games: LotteryGamesRepository,
    private readonly orgs: OrgsRepository,
    private readonly ledger: CashLedgerService,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  async board(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreBoardModel> {
    await this.access.assertView(operator);
    const orgId = parseId(orgIdText);
    const org =
      orgId === null || !isOrgVisible(operator, orgId)
        ? null
        : await this.orgs.findById(operator, orgId);
    if (orgId === null || org === null) {
      throw notFoundError(`store not found: ${orgIdText}`);
    }
    const found = await this.cashPoints.findMany(operator, {
      orgId,
      enabled: true,
    });
    const points = found.toSorted(
      (a, b) => a.order - b.order || compareDisplayName(a.name, b.name),
    );
    const pointNames = new Map(
      points.map((point) => [String(point._id), point.name]),
    );
    const tenantId = tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
    const openShifts = await this.shifts.findMany(operator, {
      orgId,
      closedAt: null,
    });
    const [shiftModels, cards, vault] = await Promise.all([
      this.views.toModels(operator, openShifts, pointNames),
      this.cardsOf(
        operator,
        tenantId,
        orgId,
        points.map((point) => point._id),
      ),
      this.ledger.vaultExpected(operator, tenantId, orgId),
    ]);
    const shiftByPoint = new Map(
      shiftModels.map((shift) => [shift.cashPoint.id, shift]),
    );
    return {
      org: { id: String(orgId), name: org.name },
      cashPoints: points.map((point) => ({
        id: String(point._id),
        name: point.name,
        positionKey: point.positionKey,
        shift: shiftByPoint.get(String(point._id)) ?? null,
        books: cards.get(String(point._id)) ?? [],
      })),
      myOpenShifts: shiftModels.filter((shift) => shift.isMine),
      vaultExpected: vault.amount,
    };
  }

  /** 每個收銀點檯面上的本(還有未售的張);依遊戲代號、本號排序。 */
  private async cardsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    pointIds: readonly Types.ObjectId[],
  ): Promise<Map<string, LotteryStoreBoardBookModel[]>> {
    if (pointIds.length === 0) {
      return new Map();
    }
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    const now = this.clock.now().getTime();
    const todayStart = new Date(
      startOfLocalDay(localDateOf(now, timezone), timezone),
    );
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: {
          orgId,
          "location.kind": TICKET_LOCATION_KIND.counter,
          "location.cashPointId": { $in: [...pointIds] },
          status: { $ne: TICKET_STATUS.skipped },
        },
      },
      {
        $group: {
          _id: { cashPointId: "$location.cashPointId", bookId: "$bookId" },
          total: { $sum: 1 },
          remaining: {
            $sum: { $cond: [{ $eq: ["$status", TICKET_STATUS.unsold] }, 1, 0] },
          },
          soldToday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TICKET_STATUS.sold] },
                    { $gte: ["$soldAt", todayStart] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const groups: CounterGroup[] = rows
      .map((row) => {
        const key = row._id as {
          cashPointId: Types.ObjectId;
          bookId: Types.ObjectId;
        };
        return {
          cashPointId: key.cashPointId,
          bookId: key.bookId,
          total: Number(row.total ?? 0),
          remaining: Number(row.remaining ?? 0),
          soldToday: Number(row.soldToday ?? 0),
        };
      })
      .filter((group) => group.remaining > 0);
    if (groups.length === 0) {
      return new Map();
    }
    const books = await this.books.findMany(operator, {
      _id: { $in: groups.map((group) => group.bookId) },
    });
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    const games = await this.games.findMany(operator, {
      _id: { $in: books.map((book) => book.gameId) },
    });
    const gameById = new Map(games.map((game) => [String(game._id), game]));
    const cards = new Map<string, LotteryStoreBoardBookModel[]>();
    for (const group of groups) {
      const book = bookById.get(String(group.bookId));
      const game =
        book === undefined ? undefined : gameById.get(String(book.gameId));
      if (book === undefined || game === undefined) {
        continue;
      }
      const list = cards.get(String(group.cashPointId)) ?? [];
      list.push({
        bookId: String(book._id),
        gameCode: book.gameCode,
        gameName: game.name,
        color: game.color,
        unitPrice: game.unitPrice,
        bookNo: book.bookNo,
        remaining: group.remaining,
        total: group.total,
        soldToday: group.soldToday,
        isLowStock: isLowStock(group.remaining, group.total),
      });
      cards.set(String(group.cashPointId), list);
    }
    for (const list of cards.values()) {
      list.sort(
        (a, b) =>
          a.gameCode.localeCompare(b.gameCode, COLLATION_LOCALE) ||
          a.bookNo.localeCompare(b.bookNo, COLLATION_LOCALE),
      );
    }
    return cards;
  }
}
