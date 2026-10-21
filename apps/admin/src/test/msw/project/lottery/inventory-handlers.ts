import { HttpResponse } from "msw";

import { INVENTORY_PERMISSIONS as PERMISSIONS } from "@repo/domain/project/lottery";
import type {
  CorrectLotterySkippedTicketsMutationVariables,
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
    correct: CorrectLotterySkippedTicketsMutationVariables["input"][];
    recover: RecoverLotteryTicketsMutationVariables["input"][];
    scrap: ScrapLotteryTicketsMutationVariables["input"][];
    allocation: SetLotteryAllocationMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

const notFound = () =>
  graphqlError("VALIDATION_FAILED", "NOT_FOUND", { code: "NOT_FOUND" });

const forbiddenError = () =>
  graphqlError("FORBIDDEN", "FORBIDDEN", { code: "FORBIDDEN" });

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
      canCorrectSkips:
        has(PERMISSIONS.markSkipped) && detail.book.skippedTicketNos.length > 0,
      canRecover: has(PERMISSIONS.recover),
      canScrap: has(PERMISSIONS.scrap),
      canShowCost: has(PERMISSIONS.showCost),
    },
  });
  let detailState = details;
  let cellState = cells;
  const inputs: InventoryWorld["inputs"] = {
    correct: [],
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
        data: { lotteryInventoryBooks: { items, totalCount: items.length } },
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
    api.mutation("CorrectLotterySkippedTickets", ({ variables }) => {
      const { input } =
        variables as CorrectLotterySkippedTicketsMutationVariables;
      const denied = forbidden(PERMISSIONS.markSkipped);
      if (denied) return denied;
      inputs.correct.push(input);
      const detail = detailState.find((item) => item.book.id === input.bookId);
      if (detail === undefined) return notFound();
      if (input.ticketNos.length !== detail.book.requiredSkipCount) {
        return validation("SKIP_COUNT_MISMATCH", ["ticketNos"]);
      }
      detailState = detailState.map((item) =>
        item === detail
          ? {
              ...item,
              book: { ...item.book, skippedTicketNos: input.ticketNos },
              tickets: item.tickets.map((ticket) => {
                if (input.ticketNos.includes(ticket.ticketNo)) {
                  return { ...ticket, status: "skipped" };
                }
                return ticket.status === "skipped"
                  ? { ...ticket, status: "unsold" }
                  : ticket;
              }),
            }
          : item,
      );
      return HttpResponse.json({
        data: { correctLotterySkippedTickets: action(input.ticketNos.length) },
      });
    }),
    api.mutation("RecoverLotteryTickets", ({ variables }) => {
      const { input } = variables as RecoverLotteryTicketsMutationVariables;
      const denied = forbidden(PERMISSIONS.recover);
      if (denied) return denied;
      inputs.recover.push(input);
      const ids = input.tickets.map((item) => item.ticketId);
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
