import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  RECENT_SALES_DAYS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  estimatedPurchaseAmountOf,
  isNewGame,
  recentSalesOf,
  recentSalesSince,
  requisitionStateOf,
  sortRequisitionCandidates,
} from "@repo/domain/project/lottery";
import { GAME_STATUS } from "@repo/domain/project/lottery-master-data";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import { inTransitBooksOf } from "./in-transit";
import type {
  LotteryPurchaseListModel,
  LotteryRequisitionCandidateModel,
  LotteryRequisitionStateModel,
} from "./models/requisition.model";
import { notFoundError } from "./requisition-error";

const [SEVEN_DAYS, THIRTY_DAYS] = RECENT_SALES_DAYS;

/** 算賣出張數的事件:售出、盤點補登算 +,撤銷算 −。 */
const SALE_TYPES = [TICKET_EVENT_TYPE.sale, TICKET_EVENT_TYPE.saleStocktake];
const SALE_UNDO_TYPES = [TICKET_EVENT_TYPE.saleUndo];

interface GameFacts {
  gameCode: string;
  name: string;
  unitPrice: number;
  bookPrice: number;
  defaultRate: number;
}

interface RequisitionGroup {
  requisitionId: string;
  serialNo: string | null;
  orgId: string;
  completedAt: Date;
  lines: { gameId: string; books: number }[];
}

function isVisible(operator: OperatorContext, orgId: Types.ObjectId): boolean {
  return (
    operator.visibleOrgIds === "all" ||
    operator.visibleOrgIds.some((id) => id.equals(orgId))
  );
}

function byGameCode(
  left: { gameCode: string },
  right: { gameCode: string },
): number {
  return left.gameCode.localeCompare(right.gameCode, "zh-Hant");
}

/**
 * 叫貨單的讀取(專案規格 8.1;正本 `docs/modules/project/purchasing.md`「api 介面」):
 *
 * - `candidates`:新增頁的遊戲清單(所有販售中的遊戲 × 這家店的目前庫存、在途、近 7 / 30 天、預計 / 已給)
 * - `purchaseList`:採購清單(有效且未被引用的副本列,依遊戲 × 分店加總 + 待購買的叫貨單)
 * - `states`:已完成叫貨單的衍生狀態(列表的「狀態」欄)
 *
 * 範圍一律照操作者的可見範圍(總部看全部分店,店長看自己的店);權限由 resolver 守。
 */
@Injectable()
export class RequisitionQueryService {
  constructor(
    private readonly games: LotteryGamesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly lines: LotteryRequisitionLinesRepository,
    private readonly allocations: LotteryAllocationsService,
  ) {}

  async candidates(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    now = new Date(),
  ): Promise<LotteryRequisitionCandidateModel[]> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || !isVisible(operator, orgId)) {
      throw notFoundError("分店不存在");
    }
    const games = await this.games.findMany(
      operator,
      { status: GAME_STATUS.onSale },
      { select: "gameCode name unitPrice bookPrice defaultRate launchedAt" },
    );
    if (games.length === 0) {
      return [];
    }
    const gameIds = games.map((game) => game._id);
    const [stock, sales, inTransit, allocations] = await Promise.all([
      this.stockOf(operator, orgId, gameIds),
      this.salesOf(operator, orgId, gameIds, now),
      inTransitBooksOf({ tenantId, orgId }),
      this.allocations.allocationStatuses(operator, orgId, gameIds),
    ]);
    const rows = games.map((game, index) => {
      const id = String(game._id);
      const launchedAt = game.launchedAt ?? null;
      const isNew = isNewGame(launchedAt, now);
      const sold = sales.get(id);
      const allocation = allocations[index];
      return {
        gameId: id,
        gameCode: game.gameCode,
        name: game.name,
        unitPrice: game.unitPrice,
        bookPrice: game.bookPrice,
        defaultRate: game.defaultRate,
        launchedAt,
        isNew,
        stockTickets: stock.get(id) ?? 0,
        inTransitBooks: inTransit.get(id) ?? 0,
        sold7: recentSalesOf(isNew, sold?.sold7 ?? 0),
        sold30: recentSalesOf(isNew, sold?.sold30 ?? 0),
        plannedBooks: allocation?.plannedBooks ?? null,
        givenBooks: allocation?.givenBooks ?? 0,
      };
    });
    return sortRequisitionCandidates(rows, now);
  }

  async purchaseList(
    operator: OperatorContext,
  ): Promise<LotteryPurchaseListModel> {
    const lines = await this.lines.findMany(
      operator,
      { voidedAt: null, referencedBy: null },
      { select: "orgId requisitionId serialNo gameId books completedAt" },
    );
    const gameIds = [...new Set(lines.map((line) => String(line.gameId)))];
    const found =
      gameIds.length === 0
        ? []
        : await this.games.findMany(
            operator,
            { _id: { $in: gameIds.map((id) => new Types.ObjectId(id)) } },
            { select: "gameCode name unitPrice bookPrice defaultRate" },
          );
    const games = new Map<string, GameFacts>(
      found.map((game) => [String(game._id), game]),
    );
    const orgIds: string[] = [];
    const byGame = new Map<string, Map<string, number>>();
    const requisitions = new Map<string, RequisitionGroup>();
    for (const line of lines) {
      const gameId = String(line.gameId);
      if (!games.has(gameId)) {
        continue;
      }
      const orgId = String(line.orgId);
      if (!orgIds.includes(orgId)) {
        orgIds.push(orgId);
      }
      const byOrg = byGame.get(gameId) ?? new Map<string, number>();
      byOrg.set(orgId, (byOrg.get(orgId) ?? 0) + line.books);
      byGame.set(gameId, byOrg);
      const key = String(line.requisitionId);
      const group = requisitions.get(key) ?? {
        requisitionId: key,
        serialNo: line.serialNo,
        orgId,
        completedAt: line.completedAt,
        lines: [],
      };
      group.lines.push({ gameId, books: line.books });
      requisitions.set(key, group);
    }
    const estimateOf = (
      items: readonly { gameId: string; books: number }[],
    ): number =>
      estimatedPurchaseAmountOf(
        items.flatMap((item) => {
          const game = games.get(item.gameId);
          return game === undefined
            ? []
            : [
                {
                  bookPrice: game.bookPrice,
                  defaultRate: game.defaultRate,
                  books: item.books,
                },
              ];
        }),
      );
    const rows = [...byGame.entries()].flatMap(([gameId, byOrg]) => {
      const game = games.get(gameId);
      if (game === undefined) {
        return [];
      }
      const branches = [...byOrg.entries()].map(([orgId, books]) => ({
        orgId,
        books,
      }));
      const totalBooks = branches.reduce(
        (sum, branch) => sum + branch.books,
        0,
      );
      return [
        {
          gameId,
          gameCode: game.gameCode,
          name: game.name,
          unitPrice: game.unitPrice,
          branches,
          totalBooks,
          estimatedAmount: estimateOf([{ gameId, books: totalBooks }]),
        },
      ];
    });
    return {
      orgIds,
      rows: rows.toSorted(byGameCode),
      requisitions: [...requisitions.values()]
        .map((group) => ({
          requisitionId: group.requisitionId,
          serialNo: group.serialNo,
          orgId: group.orgId,
          books: group.lines.reduce((sum, line) => sum + line.books, 0),
          estimatedAmount: estimateOf(group.lines),
          completedAt: group.completedAt,
        }))
        .toSorted(
          (left, right) =>
            right.completedAt.getTime() - left.completedAt.getTime(),
        ),
    };
  }

  async states(
    operator: OperatorContext,
    requisitionIds: readonly string[],
  ): Promise<LotteryRequisitionStateModel[]> {
    const ids = requisitionIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) {
      return [];
    }
    const lines = await this.lines.findMany(
      operator,
      { requisitionId: { $in: ids }, voidedAt: null },
      { select: "requisitionId referencedBy" },
    );
    const states = new Map<string, string>();
    for (const line of lines) {
      states.set(
        String(line.requisitionId),
        requisitionStateOf(line.referencedBy?.type ?? null),
      );
    }
    return [...states.entries()].map(([requisitionId, state]) => ({
      requisitionId,
      state,
    }));
  }

  /** 目前庫存:這家店各遊戲未售、在庫存或檯面上的張數。 */
  private async stockOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    gameIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: {
          orgId,
          gameId: { $in: [...gameIds] },
          status: TICKET_STATUS.unsold,
          "location.kind": {
            $in: [TICKET_LOCATION_KIND.stock, TICKET_LOCATION_KIND.counter],
          },
        },
      },
      { $group: { _id: "$gameId", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), Number(row.count)]));
  }

  /** 近 7 / 30 天賣出張數(售出 + 盤點補登 − 撤銷)。 */
  private async salesOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    gameIds: readonly Types.ObjectId[],
    now: Date,
  ): Promise<Map<string, { sold7: number; sold30: number }>> {
    const since7 = recentSalesSince(now, SEVEN_DAYS);
    const since30 = recentSalesSince(now, THIRTY_DAYS);
    const signed = {
      $cond: [
        { $in: ["$type", SALE_UNDO_TYPES] },
        { $multiply: ["$quantity", -1] },
        "$quantity",
      ],
    };
    const rows = await this.events.aggregate(operator, [
      {
        $match: {
          orgId,
          gameId: { $in: [...gameIds] },
          type: { $in: [...SALE_TYPES, ...SALE_UNDO_TYPES] },
          at: { $gte: since30, $lte: now },
        },
      },
      {
        $group: {
          _id: "$gameId",
          sold30: { $sum: signed },
          sold7: { $sum: { $cond: [{ $gte: ["$at", since7] }, signed, 0] } },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          sold7: Math.max(0, Number(row.sold7)),
          sold30: Math.max(0, Number(row.sold30)),
        },
      ]),
    );
  }
}
