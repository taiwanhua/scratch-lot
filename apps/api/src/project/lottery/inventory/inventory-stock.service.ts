import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type BookTicketCounts,
  INVENTORY_PERMISSIONS,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  holdingsWithoutPendingSkips,
  isSealedInStore,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { parseId } from "../accounts/accounts-util";
import { tenantOfOperator } from "../master-data-tenant";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import { countsOfBook, pendingSkipCountOfBook } from "../tickets/books.service";
import { notFoundError, validationError } from "../tickets/inventory-error";
import type {
  LotteryAllocationsInput,
  LotteryStockOverviewInput,
  SetLotteryAllocationInput,
} from "./dto/lottery-inventory.input";
import { InventoryAccess } from "./inventory-access";
import { InventoryNames, type TenantOrg } from "./inventory-names";
import type {
  LotteryAllocationCellModel,
  LotteryAllocationsPayload,
  LotteryInventoryGameModel,
  LotteryInventoryRefModel,
  LotteryStockOverviewPayload,
  LotteryStockOverviewRowModel,
} from "./models/lottery-inventory.model";

const NOTE_MAX = 200;

/** 每本在一家店的張數統計(不算跳號)。 */
interface BookStock {
  _id: {
    orgId: Types.ObjectId;
    gameId: Types.ObjectId;
    bookId: Types.ObjectId;
  };
  total: number;
  unsoldStock: number;
  counter: number;
  sold: number;
}

/** 庫存概況要的本上事實:拆過沒有、待標註張數。 */
interface BookFacts {
  /** 整本原封不動時的庫存張數(整本都在一家店才算那家店未拆);不是 → -1。 */
  sealedStock: number;
  /** 本上的各狀態張數與待標註張數(扣在哪家店用 `holdingsWithoutPendingSkips`) */
  counts: BookTicketCounts;
  pending: number;
}

/** 本 → 分店 → 這家店要扣的待標註張數(規格 7.1;和本的詳情「所在分店」同一個共用函式)。 */
type PendingDeductions = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** 一本在一家店是不是原封不動:從沒拆過,而且這家店的張全是未售、在庫存。 */
const isSealedRow = (row: BookStock, facts: BookFacts | undefined): boolean =>
  row.total > 0 &&
  row.total === row.unsoldStock &&
  row.total === facts?.sealedStock;

/** 一家店 × 一款遊戲的庫存概況合計。 */
interface StockTotal {
  orgId: string;
  gameId: string;
  unopened: number;
  openedStock: number;
  counter: number;
  sold: number;
}

/** 依本的列合計成「分店:遊戲」→ 合計(未拆數本、拆過的庫存張、檯面、已售)。 */
function stockTotalsOf(
  bookRows: readonly BookStock[],
  factsOf: ReadonlyMap<string, BookFacts>,
  deductions: PendingDeductions,
): Map<string, StockTotal> {
  const totals = new Map<string, StockTotal>();
  for (const row of bookRows) {
    const key = `${String(row._id.orgId)}:${String(row._id.gameId)}`;
    const total = totals.get(key) ?? {
      orgId: String(row._id.orgId),
      gameId: String(row._id.gameId),
      unopened: 0,
      openedStock: 0,
      counter: 0,
      sold: 0,
    };
    const facts = factsOf.get(String(row._id.bookId));
    const sealed = isSealedRow(row, facts);
    total.unopened += sealed ? 1 : 0;
    // 待標註算在未售時,只在扣的那一家店扣一次(實體不存在;規格 7.1):先扣庫存(拆過),不夠再扣檯面
    const pending = sealed
      ? 0
      : (deductions.get(String(row._id.bookId))?.get(String(row._id.orgId)) ??
        0);
    const fromStock = Math.min(pending, row.unsoldStock);
    total.openedStock += sealed ? 0 : row.unsoldStock - fromStock;
    total.counter += Math.max(0, row.counter - (pending - fromStock));
    total.sold += row.sold;
    totals.set(key, total);
  }
  return totals;
}

/**
 * 預計要給本數與庫存概況(專案規格 7.6、5.1、5.2):庫存管理的「預計要給本數」分頁、遊戲詳情的
 * 「庫存概況」「預計要給本數」、乙類詳情的「預計要給本數」「在店庫存」共用同一份資料與權限 ——
 * 讀取看庫存管理有沒有綁;修改要 `inventory.edit-allocations`(沒有時唯讀)。
 * 分店 = 操作者看得到的分店(`InventoryNames.storesOf`)。
 */
@Injectable()
export class InventoryStockService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly games: LotteryGamesRepository,
    private readonly allocations: LotteryAllocationsService,
    private readonly names: InventoryNames,
    private readonly access: InventoryAccess,
    private readonly orgs: OrgsRepository,
  ) {}

  async allocationsOf(
    operator: OperatorContext,
    input: LotteryAllocationsInput,
  ): Promise<LotteryAllocationsPayload> {
    const grant = await this.access.assertModule(operator);
    const tenantOrgs = await this.names.tenantOrgs(operator);
    const onlyOrg = this.visibleOrgOf(operator, tenantOrgs, input.orgId);
    const onlyGame = await this.gameOf(operator, input.gameId);
    const candidates =
      onlyOrg === null
        ? tenantOrgs.filter((org) => isOrgVisible(operator, org.id))
        : [onlyOrg];
    const cells = await this.allocations.allocationMatrix(
      operator,
      candidates.map((org) => org.id),
      onlyGame === null ? undefined : [onlyGame.id],
    );
    const stores =
      onlyOrg === null
        ? this.names.storesOf(
            operator,
            tenantOrgs,
            new Set(cells.map((cell) => cell.orgId)),
          )
        : [onlyOrg];
    const storeIds = new Set(stores.map((org) => String(org.id)));
    const games =
      onlyGame === null
        ? await this.gamesWith(
            operator,
            cells.map((cell) => cell.gameId),
          )
        : [
            {
              id: onlyGame.id,
              gameCode: onlyGame.gameCode,
              name: onlyGame.name,
            },
          ];
    return {
      stores: stores.map((org) => ({ id: String(org.id), name: org.name })),
      games: games.map((game) => ({ ...game, id: String(game.id) })),
      cells: cells.filter((cell) => storeIds.has(cell.orgId)),
      canEdit: grant.has(INVENTORY_PERMISSIONS.editAllocations),
    };
  }

  /** 操作者看得到的店(`isVisibleStore`;尋回「回到哪家店」的選項)。只要登入:店名不是機密。 */
  async visibleStores(
    operator: OperatorContext,
  ): Promise<LotteryInventoryRefModel[]> {
    const tenantOrgs = await this.names.tenantOrgs(operator);
    return this.names
      .storesOf(operator, tenantOrgs)
      .map((org) => ({ id: String(org.id), name: org.name }));
  }

  /** 修改一格(`inventory.edit-allocations` 由 resolver 守;寫 audit_log)。 */
  async setAllocation(
    operator: OperatorContext,
    input: SetLotteryAllocationInput,
  ): Promise<LotteryAllocationCellModel> {
    const orgId = parseId(input.orgId);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      throw notFoundError("分店不存在");
    }
    const game = await this.gameOf(operator, input.gameId);
    if (game === null) {
      throw notFoundError("遊戲不存在");
    }
    if ((input.note?.length ?? 0) > NOTE_MAX) {
      throw validationError("備註太長", ["note"]);
    }
    await this.allocations.setAllocation(operator, {
      orgId,
      gameId: game.id,
      plannedBooks: input.plannedBooks,
      note: input.note ?? null,
    });
    return this.allocations.allocationStatus(operator, orgId, game.id);
  }

  /**
   * 庫存概況:分店 × 遊戲的未拆(本)、庫存(拆過,張)、檯面(張)、已售(張)。遊戲詳情給 `gameId`(每家看得到
   * 的分店一列);乙類詳情給 `orgId`(對應分店有庫存的遊戲各一列)。張照操作者自己的範圍讀(只算看得到的分店)。
   * 未拆 = 這本從沒拆過、在這家店的張全部未售且在庫存;其他在庫存的未售張算「庫存(拆過)」(使用者 10/27 定案:
   * 拆過收回、尋回、調回的張不再從概況消失)。
   */
  async stockOverview(
    operator: OperatorContext,
    input: LotteryStockOverviewInput,
  ): Promise<LotteryStockOverviewPayload> {
    await this.access.assertModule(operator);
    const tenantOrgs = await this.names.tenantOrgs(operator);
    const onlyOrg = this.visibleOrgOf(operator, tenantOrgs, input.orgId);
    const onlyGame = await this.gameOf(operator, input.gameId);
    const stores =
      onlyOrg === null ? this.names.storesOf(operator, tenantOrgs) : [onlyOrg];
    const notRevoked = await this.notRevokedFilter(operator);
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: {
          ...notRevoked,
          ...(onlyOrg === null ? {} : { orgId: onlyOrg.id }),
          ...(onlyGame === null ? {} : { gameId: onlyGame.id }),
          status: { $ne: TICKET_STATUS.skipped },
        },
      },
      {
        $group: {
          _id: { orgId: "$orgId", gameId: "$gameId", bookId: "$bookId" },
          total: { $sum: 1 },
          unsoldStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TICKET_STATUS.unsold] },
                    { $eq: ["$location.kind", TICKET_LOCATION_KIND.stock] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          counter: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TICKET_STATUS.unsold] },
                    { $eq: ["$location.kind", TICKET_LOCATION_KIND.counter] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          sold: {
            $sum: { $cond: [{ $eq: ["$status", TICKET_STATUS.sold] }, 1, 0] },
          },
        },
      },
    ]);
    const bookRows = rows as unknown as BookStock[];
    const factsOf = await this.bookFactsOf(
      operator,
      bookRows
        .filter((row) => row.unsoldStock + row.counter > 0)
        .map((row) => row._id.bookId),
    );
    const deductions = await this.pendingDeductionsOf(operator, factsOf);
    const totals = stockTotalsOf(bookRows, factsOf, deductions);
    const games =
      onlyGame === null
        ? await this.gamesWith(
            operator,
            [...totals.values()].map((total) => total.gameId),
            false,
          )
        : [
            {
              id: onlyGame.id,
              gameCode: onlyGame.gameCode,
              name: onlyGame.name,
            },
          ];
    const items: LotteryStockOverviewRowModel[] = [];
    for (const store of stores) {
      for (const game of games) {
        const total = totals.get(`${String(store.id)}:${String(game.id)}`);
        if (total === undefined && onlyGame === null) {
          continue;
        }
        items.push({
          org: { id: String(store.id), name: store.name },
          game: { ...game, id: String(game.id) },
          unopenedBooks: total?.unopened ?? 0,
          openedStockTickets: total?.openedStock ?? 0,
          counterTickets: total?.counter ?? 0,
          soldTickets: total?.sold ?? 0,
        });
      }
    }
    return { items };
  }

  /** 這些本拆過沒有(`firstOpenedAt`)與待標註張數(一次讀完)。 */
  private async bookFactsOf(
    operator: OperatorContext,
    bookIds: readonly Types.ObjectId[],
  ): Promise<Map<string, BookFacts>> {
    if (bookIds.length === 0) {
      return new Map();
    }
    const books = await this.books.findMany(
      operator,
      { _id: { $in: [...bookIds] } },
      {
        select:
          "firstOpenedAt lastTicketNo standardTickets skippedTicketNos ticketCounts",
      },
    );
    return new Map(
      books.map((book) => [
        String(book._id),
        {
          sealedStock: isSealedInStore(
            {
              counts: countsOfBook(book),
              firstOpenedAt: book.firstOpenedAt ?? null,
            },
            countsOfBook(book).stock,
          )
            ? countsOfBook(book).stock
            : -1,
          counts: countsOfBook(book),
          pending: pendingSkipCountOfBook(book),
        },
      ]),
    );
  }

  /**
   * 有待標註的本,各分店要扣幾張(規格 7.1;`holdingsWithoutPendingSkips`,和本的詳情「所在分店」同一個):
   * 各分店的未售張數(含在途)要看整本、跨店,所以以租戶邊界讀(一次彙總,不逐本查;只篩了一家店時也照整本判斷)。
   */
  private async pendingDeductionsOf(
    operator: OperatorContext,
    factsOf: ReadonlyMap<string, BookFacts>,
  ): Promise<PendingDeductions> {
    const pendingBooks = [...factsOf]
      .filter(([, facts]) => facts.pending > 0)
      .map(([id]) => id);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (pendingBooks.length === 0 || tenantId === null) {
      return new Map();
    }
    const whole = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const rows = (await this.tickets.aggregate(whole, [
      {
        $match: {
          bookId: { $in: pendingBooks.map((id) => new Types.ObjectId(id)) },
          status: TICKET_STATUS.unsold,
        },
      },
      {
        $group: {
          _id: { bookId: "$bookId", orgId: "$orgId" },
          count: { $sum: 1 },
        },
      },
    ])) as {
      _id: { bookId: Types.ObjectId; orgId: Types.ObjectId };
      count: number;
    }[];
    const holdingsOf = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const key = String(row._id.bookId);
      const holdings = holdingsOf.get(key) ?? new Map<string, number>();
      holdings.set(String(row._id.orgId), row.count);
      holdingsOf.set(key, holdings);
    }
    const result = new Map<string, Map<string, number>>();
    for (const [bookId, holdings] of holdingsOf) {
      const facts = factsOf.get(bookId);
      if (facts === undefined) {
        continue;
      }
      const after = holdingsWithoutPendingSkips(
        holdings,
        facts.counts,
        facts.pending,
      );
      const deducted = new Map<string, number>();
      for (const [orgId, count] of holdings) {
        const less = count - (after.get(orgId) ?? count);
        if (less > 0) {
          deducted.set(orgId, less);
        }
      }
      result.set(bookId, deducted);
    }
    return result;
  }

  /** 篩選的分店:不給 → null;給了要在租戶裡且看得到,否則 `NOT_FOUND`。 */
  private visibleOrgOf(
    operator: OperatorContext,
    tenantOrgs: readonly TenantOrg[],
    raw: string | null | undefined,
  ): TenantOrg | null {
    if (raw == null) {
      return null;
    }
    const orgId = parseId(raw);
    const org =
      orgId === null
        ? undefined
        : tenantOrgs.find((item) => item.id.equals(orgId));
    if (org === undefined || !isOrgVisible(operator, org.id)) {
      throw notFoundError("分店不存在");
    }
    return org;
  }

  /** 進貨單作廢後的本(`revoked`)不算庫存(規格 7.1、8.2):張的條件排除那些本。 */
  private async notRevokedFilter(
    operator: OperatorContext,
  ): Promise<Record<string, unknown>> {
    const revoked = await this.books.findMany(
      operator,
      { status: "revoked" },
      { select: "_id" },
    );
    return revoked.length === 0
      ? {}
      : { bookId: { $nin: revoked.map((book) => book._id) } };
  }

  private async gameOf(
    operator: OperatorContext,
    raw: string | null | undefined,
  ): Promise<{ id: Types.ObjectId; gameCode: string; name: string } | null> {
    if (raw == null) {
      return null;
    }
    const gameId = parseId(raw);
    const game =
      gameId === null ? null : await this.games.findById(operator, gameId);
    if (!game) {
      throw notFoundError("遊戲不存在");
    }
    return { id: game._id, gameCode: game.gameCode, name: game.name };
  }

  /**
   * 矩陣的欄:販售中的遊戲 + 有資料的遊戲(`includeOnSale = false` 時只有有資料的),依代號排序。
   */
  private async gamesWith(
    operator: OperatorContext,
    gameIds: readonly string[],
    includeOnSale = true,
  ): Promise<
    (Omit<LotteryInventoryGameModel, "id"> & { id: Types.ObjectId })[]
  > {
    const ids = [...new Set(gameIds)].flatMap((id) => {
      const parsed = parseId(id);
      return parsed === null ? [] : [parsed];
    });
    const conditions: Record<string, unknown>[] = [{ _id: { $in: ids } }];
    if (includeOnSale) {
      conditions.push({ status: "on_sale" });
    }
    const games = await this.games.findMany(operator, { $or: conditions });
    return games
      .map((game) => ({
        id: game._id,
        gameCode: game.gameCode,
        name: game.name,
      }))
      .toSorted((a, b) => a.gameCode.localeCompare(b.gameCode));
  }
}
