import {
  type StocktakeDetailFixture,
  type StocktakeSheetFixture,
  sampleStocktakeDetail,
  sampleStocktakeSheet,
} from "./stocktake-fixtures";

const FA_DA_CAI: [string, string, number] = ["5164", "發大財", 200];
const JIN_HAO_YUN: [string, string, number] = ["5201", "金好運", 200];
const ZHAO_CAI_MAO: [string, string, number] = ["5133", "招財貓", 1000];

const countGroup = (
  cashPointId: string,
  game: [string, string, number],
  unsoldCount: number,
  bookNos: string[],
): StocktakeSheetFixture["countGroups"][number] => ({
  __typename: "LotteryStocktakeCountGroup",
  cashPointId,
  gameId: `g-${game[0]}`,
  gameCode: game[0],
  gameName: game[1],
  unitPrice: game[2],
  unsoldCount,
  bookNos,
});

/**
 * 張數店的盤點頁(張數店規格 8.1;Figma CS-09a):檯面是「收銀點 × 遊戲」的組(數之前不顯示系統數字);
 * 沒有拆過在庫存的本;待查清單多一組待查·未對號(5164 · 2 張 · 系統預設帶入,10/16 交班盤點 · 店內櫃台)。
 */
export const sampleCountStocktakeSheet = (
  orgId = "org-store-a",
): StocktakeSheetFixture => {
  const sheet = sampleStocktakeSheet(orgId);
  return {
    ...sheet,
    countMode: "count",
    books: [],
    countGroups: [
      countGroup("cp-counter", FA_DA_CAI, 12, ["0056527", "0056531"]),
      countGroup("cp-counter", JIN_HAO_YUN, 35, ["0060112"]),
      countGroup("cp-outdoor", ZHAO_CAI_MAO, 10, ["0071204"]),
    ],
    lostTickets: [
      ...sheet.lostTickets,
      ...["038", "039"].map((ticketNo) => ({
        __typename: "LotteryStocktakeLostTicket" as const,
        ticketId: `b-u-${ticketNo}`,
        bookId: "b-1",
        gameCode: "5164",
        bookNo: "0056527",
        ticketNo,
        bookTicketCount: 100,
        since: "2026-10-16T02:00:00.000Z",
        source: "stocktake",
        gameId: "g-5164",
        gameName: "發大財",
        unmatched: true,
        sourceId: "st-shift-16",
        sourceType: "shift",
        sourceCashPointName: "店內櫃台",
      })),
    ],
  };
};

/** 張數盤點的盤點確認申請(檢視頁):店內櫃台 5164 第一次數 11、改成 10,算售出 1、待查 1;5201 多 1 標記異常;店外攤位 5133 還沒數。 */
export const sampleCountStocktakeDetail = (): StocktakeDetailFixture => ({
  ...sampleStocktakeDetail(),
  lines: [],
  unopened: [],
  lostReview: [],
  uncountedBooks: [],
  countMode: "count",
  countLines: [
    {
      __typename: "LotteryStocktakeDetailCountLine",
      cashPointId: "cp-counter",
      cashPointName: "店內櫃台",
      gameCode: "5164",
      gameName: "發大財",
      countedAt: "2026-10-16T02:06:00.000Z",
      systemCount: 12,
      presentCount: 10,
      recounts: [11],
      saleCount: 1,
      saleAmount: 200,
      investigateCount: 1,
      flaggedCount: 0,
    },
    {
      __typename: "LotteryStocktakeDetailCountLine",
      cashPointId: "cp-counter",
      cashPointName: "店內櫃台",
      gameCode: "5201",
      gameName: "金好運",
      countedAt: "2026-10-16T02:08:00.000Z",
      systemCount: 35,
      presentCount: 36,
      recounts: [],
      saleCount: 0,
      saleAmount: 0,
      investigateCount: 0,
      flaggedCount: 1,
    },
  ],
  uncountedGroups: [
    {
      __typename: "LotteryStocktakeDetailUncountedGroup",
      cashPointId: "cp-outdoor",
      cashPointName: "店外攤位",
      gameCode: "5133",
      gameName: "招財貓",
    },
  ],
});
