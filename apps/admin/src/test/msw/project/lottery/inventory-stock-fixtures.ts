import { formatTicketNo } from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import type {
  LotteryAllocationCellFieldsFragment,
  LotteryInvestigationRowFieldsFragment,
} from "@repo/graphql";

import {
  type GameFixture,
  inventoryGames,
  inventoryOrgs,
  inventoryTicket,
} from "./inventory-fixtures";

/** 預計要給本數、庫存概況與原因選項的夾具(元件測試、假 api 與 mock 模式共用)。 */

const cell = (
  orgId: string,
  gameId: string,
  givenBooks: number,
  plannedBooks: number | null,
  givenExtraTickets = 0,
): LotteryAllocationCellFieldsFragment => ({
  __typename: "LotteryAllocationCell",
  orgId,
  gameId,
  plannedBooks,
  note: null,
  givenBooks,
  givenExtraTickets,
});

/** Figma IN-06 的矩陣(已給 / 預計)。 */
export const sampleAllocationCells =
  (): LotteryAllocationCellFieldsFragment[] => {
    const [g5164, g5201, g5198, g5133, g5150] = inventoryGames;
    const { storeA, storeB, storeC } = inventoryOrgs;
    return [
      cell(storeA.id, g5164.id, 8, 10),
      cell(storeA.id, g5201.id, 4, 6),
      cell(storeA.id, g5198.id, 12, 10),
      cell(storeA.id, g5133.id, 2, 3),
      cell(storeA.id, g5150.id, 5, 5),
      cell(storeB.id, g5164.id, 3, 5, 30),
      cell(storeB.id, g5201.id, 2, 4),
      cell(storeB.id, g5198.id, 6, 8),
      cell(storeB.id, g5133.id, 0, 2),
      cell(storeB.id, g5150.id, 4, 6),
      cell(storeC.id, g5164.id, 5, 5),
      cell(storeC.id, g5201.id, 1, 3),
      cell(storeC.id, g5198.id, 4, 6),
      cell(storeC.id, g5133.id, 1, 2),
      cell(storeC.id, g5150.id, 2, 4),
    ];
  };

/** 庫存概況(Figma MD-03):每家店 × 每個遊戲。 */
export const sampleStockOverview = () => {
  const counts: Record<string, [number, number, number]> = {
    [inventoryOrgs.storeA.id]: [4, 235, 1862],
    [inventoryOrgs.storeB.id]: [2, 80, 740],
    [inventoryOrgs.storeC.id]: [1, 40, 310],
  };
  return Object.values(inventoryOrgs).flatMap((org) =>
    inventoryGames.map((game) => {
      const [unopened, counter, sold] = counts[org.id] ?? [0, 0, 0];
      return {
        __typename: "LotteryStockOverviewRow" as const,
        org,
        game: {
          __typename: "LotteryInventoryGame" as const,
          id: game.id,
          gameCode: game.gameCode,
          name: game.name,
        },
        unopenedBooks: unopened,
        counterTickets: counter,
        soldTickets: sold,
      };
    }),
  );
};

/** 三個原因類別的選項(欄位管理的種子形狀)。 */
export const sampleReasonOptions: Record<
  string,
  { value: string; label: string }[]
> = {
  [LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason]: [
    { value: "mark-error", label: "標註錯誤" },
    { value: "other", label: "其他" },
  ],
  [LOTTERY_FIELD_CATEGORY_KEYS.recoverReason]: [
    { value: "found-in-store", label: "店內找到" },
    { value: "other", label: "其他" },
  ],
  [LOTTERY_FIELD_CATEGORY_KEYS.scrapReason]: [
    { value: "damaged", label: "破損" },
    { value: "damp", label: "受潮" },
    { value: "other", label: "其他" },
  ],
  // 店面管理的出庫(規格 6.7)
  [LOTTERY_FIELD_CATEGORY_KEYS.withdrawReason]: [
    { value: "opening-float", label: "開班零用金" },
    { value: "change-refill", label: "補零錢" },
    { value: "other", label: "其他" },
  ],
  // 店面管理的手動標記售出(規格 6.3)
  [LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason]: [
    { value: "scan-failed", label: "刷不到條碼" },
    { value: "system-backfill", label: "系統異常補登" },
    { value: "other", label: "其他" },
  ],
  // 店面管理的撤銷兌獎(規格 6.5)
  [LOTTERY_FIELD_CATEGORY_KEYS.redemptionRevokeReason]: [
    { value: "entry-error", label: "登記錯誤" },
    { value: "wrong-amount", label: "金額錯誤" },
    { value: "other", label: "其他" },
  ],
  // 店面管理的撤銷售出申請(規格 8.5;客人退貨帶入「退款給客人 = 是」)
  [LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason]: [
    { value: "customer-return", label: "客人退貨" },
    { value: "wrong-ticket", label: "刷錯刮刮樂" },
    { value: "stocktake-error", label: "盤點錯誤" },
    { value: "other", label: "其他" },
  ],
};

/** Figma IN-05 的三列。 */
export const sampleInvestigations =
  (): LotteryInvestigationRowFieldsFragment[] => {
    const row = (
      bookId: string,
      bookNo: string,
      game: GameFixture,
      status: string,
      responsibleOrg: { id: string; name: string },
      refSerialNo: string,
      at: string,
      cost: number,
      count: number,
    ): LotteryInvestigationRowFieldsFragment => ({
      __typename: "LotteryInvestigationRow",
      bookId,
      bookNo,
      gameCode: game.gameCode,
      gameName: game.name,
      unitPrice: game.unitPrice,
      status,
      responsibleOrg: { __typename: "LotteryInventoryRef", ...responsibleOrg },
      refType: null,
      refSerialNo,
      at,
      cost,
      tickets: Array.from({ length: count }, (_, index) =>
        inventoryTicket(formatTicketNo(index + 1), status, {
          id: `${bookId}-t-${String(index + 1)}`,
        }),
      ),
    });
    return [
      row(
        "b-056420",
        "0056420",
        inventoryGames[0],
        "investigating",
        inventoryOrgs.storeB,
        "T-0007",
        "2026-10-12T02:00:00.000Z",
        1840,
        10,
      ),
      row(
        "b-088103",
        "0088103",
        inventoryGames[2],
        "investigating",
        inventoryOrgs.storeA,
        "S-0032",
        "2026-10-16T02:00:00.000Z",
        9200,
        100,
      ),
      row(
        "b-060090",
        "0060090",
        inventoryGames[1],
        "lost",
        inventoryOrgs.storeA,
        "P-0010",
        "2026-10-05T02:00:00.000Z",
        18_400,
        100,
      ),
    ];
  };
