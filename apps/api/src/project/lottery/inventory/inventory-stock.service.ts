import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
} from "@repo/domain/project/lottery";

import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import { LotteryTicketsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { parseId } from "../accounts/accounts-util";
import { LotteryAllocationsService } from "../tickets/allocations.service";
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
    private readonly games: LotteryGamesRepository,
    private readonly allocations: LotteryAllocationsService,
    private readonly names: InventoryNames,
    private readonly access: InventoryAccess,
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
   * 庫存概況:分店 × 遊戲的未拆(本)、檯面(張)、已售(張)。遊戲詳情給 `gameId`(每家看得到的分店一列);
   * 乙類詳情給 `orgId`(對應分店有庫存的遊戲各一列)。張照操作者自己的範圍讀(只算看得到的分店)。
   * 未拆 = 這本在這家店的張全部未售且在庫存。
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
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: {
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
    const totals = new Map<
      string,
      {
        orgId: string;
        gameId: string;
        unopened: number;
        counter: number;
        sold: number;
      }
    >();
    for (const row of rows as unknown as BookStock[]) {
      const key = `${String(row._id.orgId)}:${String(row._id.gameId)}`;
      const total = totals.get(key) ?? {
        orgId: String(row._id.orgId),
        gameId: String(row._id.gameId),
        unopened: 0,
        counter: 0,
        sold: 0,
      };
      total.unopened += row.total > 0 && row.total === row.unsoldStock ? 1 : 0;
      total.counter += row.counter;
      total.sold += row.sold;
      totals.set(key, total);
    }
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
          counterTickets: total?.counter ?? 0,
          soldTickets: total?.sold ?? 0,
        });
      }
    }
    return { items };
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
