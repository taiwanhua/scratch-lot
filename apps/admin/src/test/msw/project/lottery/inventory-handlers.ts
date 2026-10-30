import { HttpResponse } from "msw";

import { INVENTORY_PERMISSIONS as PERMISSIONS } from "@repo/domain/project/lottery";
import type {
  LotteryAllocationCellFieldsFragment,
  LotteryAllocationsQueryVariables,
  LotteryFieldOptionsQueryVariables,
  LotteryInventoryBookDetailFieldsFragment,
  LotteryInventoryBookFieldsFragment,
  LotteryInventoryBookQueryVariables,
  LotteryInventoryBooksQueryVariables,
  LotteryInvestigationRowFieldsFragment,
  LotteryStockOverviewQueryVariables,
  LotteryTicketLookupQueryVariables,
  RecoverLotteryTicketsMutationVariables,
  ScrapLotteryTicketsMutationVariables,
  SetLotteryAllocationMutationVariables,
  SwapLotterySkippedTicketMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  ALL_INVENTORY_PERMISSIONS,
  inventoryGames,
  inventoryOrgs,
  sampleBookDetail,
  sampleInventoryBooks,
  sampleInvestigatingBookDetail,
} from "./inventory-fixtures";
import {
  sampleAllocationCells,
  sampleInvestigations,
  sampleReasonOptions,
  sampleStockOverview,
} from "./inventory-stock-fixtures";

/**
 * 庫存管理的假 api(夾具在 `inventory-fixtures.ts`;規則照 `docs/modules/project/inventory.md`):
 * 有狀態 —— 更正跳號 / 尋回 / 報廢 / 修改預計要給本數後重查看得到。`abilities`、`canEdit`、成本由這裡依
 * 「給的權限」算好(api 的職責),元件只讀。元件測試與 mock 模式共用(`mock/project/mock-world.ts`)。
 */

export interface InventoryWorldOptions {
  books?: LotteryInventoryBookFieldsFragment[];
  details?: LotteryInventoryBookDetailFieldsFragment[];
  investigations?: LotteryInvestigationRowFieldsFragment[];
  cells?: LotteryAllocationCellFieldsFragment[];
  /** 看得到的店(尋回「回到哪家店」);預設三家 */
  stores?: { id: string; name: string }[];
  permissions?: readonly string[];
}

export interface InventoryWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    swap: SwapLotterySkippedTicketMutationVariables["input"][];
    recover: RecoverLotteryTicketsMutationVariables["input"][];
    scrap: ScrapLotteryTicketsMutationVariables["input"][];
    allocation: SetLotteryAllocationMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

const notFound = () => graphqlError("NOT_FOUND");

const forbiddenError = () => graphqlError("FORBIDDEN");

/** 別店的張(`operable = false`)不能操作(api 的 `CROSS_STORE_NOT_ALLOWED`)。 */
const crossStore = (ticketIds: string[]) =>
  graphqlError("FORBIDDEN", "CROSS_STORE_NOT_ALLOWED", {
    reason: "CROSS_STORE_NOT_ALLOWED",
    ticketIds,
  });

const action = (count: number, lossCost: number | null = null) => ({
  __typename: "LotteryInventoryActionPayload" as const,
  count,
  lossCost,
});

/**
 * 篩選的分店:夾具裡的分店照用;其他 id(例:乙類的對應分店是經銷商夾具的組織)借中山店的資料,
 * 換成那個 id。沒給 → null(全部分店)。
 */
const storeFor = (orgId: string | null | undefined) => {
  if (!orgId) {
    return null;
  }
  const known = Object.values(inventoryOrgs).find((org) => org.id === orgId);
  return {
    sourceId: known?.id ?? inventoryOrgs.storeA.id,
    store: known ?? { ...inventoryOrgs.storeA, id: orgId },
  };
};

export const inventoryWorld = ({
  books = sampleInventoryBooks(),
  details = [sampleBookDetail(), sampleInvestigatingBookDetail()],
  investigations = sampleInvestigations(),
  cells = sampleAllocationCells(),
  stores = Object.values(inventoryOrgs),
  permissions = ALL_INVENTORY_PERMISSIONS,
}: InventoryWorldOptions = {}): InventoryWorld => {
  const has = (key: string) => permissions.includes(key);
  const withAbilities = (
    detail: LotteryInventoryBookDetailFieldsFragment,
  ): LotteryInventoryBookDetailFieldsFragment => ({
    ...detail,
    cost: has(PERMISSIONS.showCost) ? detail.cost : null,
    abilities: {
      __typename: "LotteryInventoryBookAbilities",
      // 這本有跳號(記在哪家店都可以)、一張自己範圍內的未售(未鎖定)
      canCorrectSkips:
        has(PERMISSIONS.markSkipped) &&
        detail.tickets.some((ticket) => ticket.status === "skipped") &&
        detail.tickets.some(
          (ticket) =>
            ticket.operable && ticket.status === "unsold" && !ticket.locked,
        ),
      canMarkSkips:
        has(PERMISSIONS.markSkipped) &&
        detail.book.pendingSkipCount > 0 &&
        detail.tickets.some(
          (ticket) =>
            ticket.operable && ticket.status === "unsold" && !ticket.locked,
        ),
      canRecover: has(PERMISSIONS.recover),
      canScrap: has(PERMISSIONS.scrap),
      canShowCost: has(PERMISSIONS.showCost),
    },
  });
  let detailState = details;
  let cellState = cells;
  const inputs: InventoryWorld["inputs"] = {
    swap: [],
    recover: [],
    scrap: [],
    allocation: [],
  };
  const forbidden = (permission: string) =>
    has(permission) ? null : forbiddenError();
  /** 把一本裡的幾張改成新的狀態(版本 +1)。 */
  const updateTickets = (
    ticketIds: readonly string[],
    patch: (status: string) => string,
  ) => {
    detailState = detailState.map((detail) => ({
      ...detail,
      tickets: detail.tickets.map((ticket) =>
        ticketIds.includes(ticket.id)
          ? {
              ...ticket,
              status: patch(ticket.status),
              version: ticket.version + 1,
            }
          : ticket,
      ),
    }));
  };
  const allTickets = () => detailState.flatMap((detail) => detail.tickets);

  const handlers: InventoryWorld["handlers"] = [
    api.query("LotteryInventoryBooks", ({ variables }) => {
      const { input } = variables as LotteryInventoryBooksQueryVariables;
      const items = books.filter(
        (book) =>
          (!input.gameId || book.gameId === input.gameId) &&
          (!input.state ||
            (input.state === "pending_skip"
              ? book.pendingSkipCount > 0
              : book.state === input.state)) &&
          (!input.bookNo || book.bookNo.includes(input.bookNo)),
      );
      return HttpResponse.json({
        data: {
          lotteryInventoryBooks: {
            items,
            totalCount: items.length,
            page: 1,
            pageSize: 50,
          },
        },
      });
    }),
    api.query("LotteryInventoryBook", ({ variables }) => {
      const { id } = variables as LotteryInventoryBookQueryVariables;
      const item = detailState.find((detail) => detail.book.id === id);
      return item === undefined
        ? notFound()
        : HttpResponse.json({
            data: { lotteryInventoryBook: { item: withAbilities(item) } },
          });
    }),
    api.query("LotteryTicketLookup", ({ variables }) => {
      const { input } = variables as LotteryTicketLookupQueryVariables;
      const items = detailState.flatMap((detail) => {
        const found = detail.tickets.find(
          (ticket) => ticket.ticketNo === input.ticketNo,
        );
        return detail.book.bookNo === input.bookNo && found
          ? [
              {
                __typename: "LotteryTicketLookupItem" as const,
                bookId: detail.book.id,
                bookNo: detail.book.bookNo,
                gameCode: detail.book.gameCode,
                gameName: detail.book.gameName,
                unitPrice: detail.book.unitPrice,
                ticketId: found.id,
                ticketNo: found.ticketNo,
                status: found.status,
                version: found.version,
                org: found.org,
                responsibleOrg: found.responsibleOrg,
              },
            ]
          : [];
      });
      return HttpResponse.json({ data: { lotteryTicketLookup: { items } } });
    }),
    api.query("LotteryInvestigations", () =>
      HttpResponse.json({
        data: {
          lotteryInvestigations: {
            items: investigations.map((row) => ({
              ...row,
              cost: has(PERMISSIONS.showCost) ? row.cost : null,
            })),
            canRecover: has(PERMISSIONS.recover),
          },
        },
      }),
    ),
    api.query("LotteryAllocations", ({ variables }) => {
      const { input } = variables as LotteryAllocationsQueryVariables;
      const target = storeFor(input.orgId);
      const stores =
        target === null ? Object.values(inventoryOrgs) : [target.store];
      const games = inventoryGames
        .filter((game) => !input.gameId || game.id === input.gameId)
        .map((game) => ({
          __typename: "LotteryInventoryGame" as const,
          id: game.id,
          gameCode: game.gameCode,
          name: game.name,
        }));
      const cellsOf =
        target === null
          ? cellState
          : cellState
              .filter((item) => item.orgId === target.sourceId)
              .map((item) => ({ ...item, orgId: target.store.id }));
      return HttpResponse.json({
        data: {
          lotteryAllocations: {
            stores,
            games,
            cells: cellsOf.filter((item) =>
              games.some((game) => game.id === item.gameId),
            ),
            canEdit: has(PERMISSIONS.editAllocations),
          },
        },
      });
    }),
    api.query("LotteryStockOverview", ({ variables }) => {
      const { input } = variables as LotteryStockOverviewQueryVariables;
      const target = storeFor(input.orgId);
      const items = sampleStockOverview()
        .filter(
          (row) =>
            (target === null || row.org.id === target.sourceId) &&
            (!input.gameId || row.game.id === input.gameId),
        )
        .map((row) => (target === null ? row : { ...row, org: target.store }));
      return HttpResponse.json({ data: { lotteryStockOverview: { items } } });
    }),
    api.query("LotteryInventoryStores", () =>
      HttpResponse.json({
        data: {
          lotteryInventoryStores: {
            items: stores.map((store) => ({
              __typename: "LotteryInventoryRef" as const,
              ...store,
            })),
          },
        },
      }),
    ),
    api.query("LotteryFieldOptions", ({ variables }) => {
      const { categoryKey } = variables as LotteryFieldOptionsQueryVariables;
      const items = (sampleReasonOptions[categoryKey] ?? []).map((option) => ({
        __typename: "LotteryFieldOption" as const,
        ...option,
      }));
      return HttpResponse.json({
        data: { lotteryFieldOptions: { items, totalCount: items.length } },
      });
    }),
    api.mutation("SetLotteryAllocation", ({ variables }) => {
      const { input } = variables as SetLotteryAllocationMutationVariables;
      const denied = forbidden(PERMISSIONS.editAllocations);
      if (denied) return denied;
      inputs.allocation.push(input);
      const current = cellState.find(
        (item) => item.orgId === input.orgId && item.gameId === input.gameId,
      );
      const item: LotteryAllocationCellFieldsFragment = {
        __typename: "LotteryAllocationCell",
        orgId: input.orgId,
        gameId: input.gameId,
        givenBooks: current?.givenBooks ?? 0,
        givenExtraTickets: current?.givenExtraTickets ?? 0,
        plannedBooks: input.plannedBooks,
        note: input.note ?? null,
      };
      cellState = [...cellState.filter((cell) => cell !== current), item];
      return HttpResponse.json({ data: { setLotteryAllocation: { item } } });
    }),
    api.mutation("SwapLotterySkippedTicket", ({ variables }) => {
      const { input } = variables as SwapLotterySkippedTicketMutationVariables;
      const denied = forbidden(PERMISSIONS.markSkipped);
      if (denied) return denied;
      inputs.swap.push(input);
      const detail = detailState.find((item) => item.book.id === input.bookId);
      if (detail === undefined) return notFound();
      const skipped = detail.tickets.find(
        (ticket) => ticket.id === input.skipped.ticketId,
      );
      const unsold = detail.tickets.find(
        (ticket) => ticket.id === input.unsold.ticketId,
      );
      if (skipped === undefined || unsold === undefined) return notFound();
      detailState = detailState.map((item) =>
        item === detail
          ? {
              ...item,
              tickets: item.tickets.map((ticket) => {
                if (ticket.id === skipped.id) {
                  // 改回未售:接手配對那張的分店與位置
                  return {
                    ...ticket,
                    status: "unsold",
                    org: unsold.org,
                    locationKind: unsold.locationKind,
                    cashPoint: unsold.cashPoint,
                    operable: true,
                  };
                }
                return ticket.id === unsold.id
                  ? { ...ticket, status: "skipped" }
                  : ticket;
              }),
            }
          : item,
      );
      return HttpResponse.json({
        data: { swapLotterySkippedTicket: action(2) },
      });
    }),
    api.mutation("RecoverLotteryTickets", ({ variables }) => {
      const { input } = variables as RecoverLotteryTicketsMutationVariables;
      const denied = forbidden(PERMISSIONS.recover);
      if (denied) return denied;
      inputs.recover.push(input);
      const ids = input.tickets.map((item) => item.ticketId);
      // 從清單選(不給 orgId)只能尋回自己範圍內的張;刷到實體(給 orgId)可跨店
      const outside = allTickets().filter(
        (ticket) => ids.includes(ticket.id) && !ticket.operable,
      );
      if (input.orgId == null && outside.length > 0) {
        return crossStore(outside.map((ticket) => ticket.id));
      }
      const wrong = allTickets().filter(
        (ticket) =>
          ids.includes(ticket.id) &&
          ticket.status !== "investigating" &&
          ticket.status !== "lost",
      );
      if (wrong.length > 0) {
        return validation("TICKET_STATUS_NOT_ALLOWED", ["tickets"]);
      }
      updateTickets(ids, () => "unsold");
      return HttpResponse.json({
        data: { recoverLotteryTickets: action(ids.length) },
      });
    }),
    api.mutation("ScrapLotteryTickets", ({ variables }) => {
      const { input } = variables as ScrapLotteryTicketsMutationVariables;
      const denied = forbidden(PERMISSIONS.scrap);
      if (denied) return denied;
      inputs.scrap.push(input);
      const ids = input.tickets.map((item) => item.ticketId);
      const outside = allTickets().filter(
        (ticket) => ids.includes(ticket.id) && !ticket.operable,
      );
      if (outside.length > 0) {
        return crossStore(outside.map((ticket) => ticket.id));
      }
      const wrong = allTickets().filter(
        (ticket) => ids.includes(ticket.id) && ticket.status !== "unsold",
      );
      if (wrong.length > 0) {
        return validation("TICKET_STATUS_NOT_ALLOWED", ["tickets"]);
      }
      updateTickets(ids, () => "scrapped");
      return HttpResponse.json({
        data: {
          scrapLotteryTickets: action(
            ids.length,
            has(PERMISSIONS.showCost) ? ids.length * 184 : null,
          ),
        },
      });
    }),
  ];
  return { handlers, inputs };
};
