import type {
  LotteryPurchaseListQuery,
  LotteryRequisitionCandidateFieldsFragment,
} from "@repo/graphql";

import { masterDataOrgs } from "./master-data-fixtures";

/**
 * 叫貨、採購單的讀取夾具(規格 8.1;Figma PU-02 新增頁的遊戲清單、PU-03 採購清單)。
 * 叫貨單本身(模組、表單、提交)在 `purchasing-fixtures.ts`。
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-20T04:00:00.000Z");

type Candidate = LotteryRequisitionCandidateFieldsFragment;

const candidate = (
  overrides: Partial<Candidate> &
    Pick<Candidate, "gameId" | "gameCode" | "name">,
): Candidate => {
  const unitPrice = overrides.unitPrice ?? 200;
  const ticketsPerBook = unitPrice >= 1000 ? 25 : 100;
  return {
    __typename: "LotteryRequisitionCandidate",
    unitPrice,
    bookPrice: unitPrice * ticketsPerBook,
    defaultRate: 92,
    launchedAt: null,
    isNew: false,
    stockTickets: 0,
    inTransitBooks: 0,
    sold7: 0,
    sold30: 0,
    plannedBooks: null,
    givenBooks: 0,
    ...overrides,
  };
};

/** Figma PU-02 的五款遊戲(已照規格排序:新遊戲在上,其他依近 30 天賣出多到少)。 */
export const requisitionCandidates = (): Candidate[] => [
  candidate({
    gameId: "game-5201",
    gameCode: "5201",
    name: "金好運",
    launchedAt: new Date(NOW - 2 * DAY).toISOString(),
    isNew: true,
    sold7: null,
    sold30: null,
  }),
  candidate({
    gameId: "game-5198",
    gameCode: "5198",
    name: "鼠來寶",
    unitPrice: 100,
    launchedAt: new Date(NOW - 10 * DAY).toISOString(),
    isNew: true,
    inTransitBooks: 1,
    sold7: null,
    sold30: null,
  }),
  candidate({
    gameId: "game-5164",
    gameCode: "5164",
    name: "發大財",
    stockTickets: 35,
    sold7: 42,
    sold30: 180,
  }),
  candidate({
    gameId: "game-5150",
    gameCode: "5150",
    name: "好運旺旺",
    unitPrice: 500,
    stockTickets: 120,
    sold7: 30,
    sold30: 95,
  }),
  candidate({
    gameId: "game-5133",
    gameCode: "5133",
    name: "招財貓",
    unitPrice: 1000,
    stockTickets: 8,
    sold7: 6,
    sold30: 20,
    plannedBooks: 10,
    givenBooks: 9,
  }),
];

const branch = (orgId: string, books: number) => ({
  __typename: "LotteryPurchaseListBranch" as const,
  orgId,
  books,
});

/** Figma PU-03 的採購清單;`stores` 換分店 id(mock 模式用底座組織樹上的分店,名稱才解得出來)。 */
export const purchaseList = (
  stores: { storeA: { id: string }; storeB: { id: string } } = masterDataOrgs,
): LotteryPurchaseListQuery["lotteryPurchaseList"] => {
  const { storeA, storeB } = stores;
  return {
    __typename: "LotteryPurchaseList",
    orgIds: [storeA.id, storeB.id],
    rows: [
      {
        __typename: "LotteryPurchaseListRow",
        gameId: "game-5133",
        gameCode: "5133",
        name: "招財貓",
        unitPrice: 1000,
        branches: [branch(storeB.id, 1)],
        totalBooks: 1,
        estimatedAmount: 23_000,
      },
      {
        __typename: "LotteryPurchaseListRow",
        gameId: "game-5164",
        gameCode: "5164",
        name: "發大財",
        unitPrice: 200,
        branches: [branch(storeA.id, 1), branch(storeB.id, 3)],
        totalBooks: 4,
        estimatedAmount: 73_600,
      },
      {
        __typename: "LotteryPurchaseListRow",
        gameId: "game-5201",
        gameCode: "5201",
        name: "金好運",
        unitPrice: 200,
        branches: [branch(storeA.id, 2), branch(storeB.id, 1)],
        totalBooks: 3,
        estimatedAmount: 55_200,
      },
    ],
    requisitions: [
      {
        __typename: "LotteryPendingRequisition",
        requisitionId: "sub-req-0022",
        serialNo: "R-0022",
        orgId: storeB.id,
        books: 3,
        estimatedAmount: 55_200,
        completedAt: "2026-10-18T02:00:00.000Z",
      },
      {
        __typename: "LotteryPendingRequisition",
        requisitionId: "sub-req-0019",
        serialNo: "R-0019",
        orgId: storeA.id,
        books: 2,
        estimatedAmount: 41_400,
        completedAt: "2026-10-16T02:00:00.000Z",
      },
    ],
  };
};
