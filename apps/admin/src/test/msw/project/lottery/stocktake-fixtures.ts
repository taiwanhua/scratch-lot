import {
  type LotteryStocktakeQuery,
  type LotteryStocktakeSheetQuery,
  type LotteryStocktakesQuery,
} from "@repo/graphql";

export type StocktakeSheetFixture =
  LotteryStocktakeSheetQuery["lotteryStocktakeSheet"];
export type StocktakeDetailFixture = LotteryStocktakeQuery["lotteryStocktake"];
export type StocktakeListRow =
  LotteryStocktakesQuery["lotteryStocktakes"]["items"][number];

const ticketNos = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    String(index + 1).padStart(3, "0"),
  );

/** 一本 × 收銀點:`soldUpTo` 之前(含)的張已售。 */
const book = (
  bookId: string,
  cashPointId: string,
  game: [string, string, number],
  bookNo: string,
  total: number,
  soldUpTo: number,
): StocktakeSheetFixture["books"][number] => ({
  __typename: "LotteryStocktakeBook",
  bookId,
  cashPointId,
  gameCode: game[0],
  gameName: game[1],
  unitPrice: game[2],
  bookNo,
  tickets: ticketNos(total).map((ticketNo, index) => ({
    __typename: "LotteryStocktakeTicket",
    ticketId: `${bookId}-${ticketNo}`,
    ticketNo,
    version: 1,
    status: index < soldUpTo ? "sold" : "unsold",
    pendingReversal: false,
  })),
});

const shift = (
  id: string,
  openedAt: string,
  closed: boolean,
  expectedCash: number | null,
) => ({
  __typename: "LotteryStocktakeShift" as const,
  id,
  ownerName: "王小明",
  openedAt,
  closed,
  expectedCash,
});

const FA_DA_CAI: [string, string, number] = ["5164", "發大財", 200];
const JIN_HAO_YUN: [string, string, number] = ["5201", "金好運", 200];
const SHU_LAI_BAO: [string, string, number] = ["5198", "鼠來寶", 100];
const HAO_YUN: [string, string, number] = ["5150", "好運旺旺", 500];
const ZHAO_CAI_MAO: [string, string, number] = ["5133", "招財貓", 1000];

/**
 * 盤點頁的示範資料(Figma ST-13):中山店的店內櫃台(王小明 08:02 開班,應有 12,350)與店外攤位
 * (13:00 的班已結帳);檯面上的本、未拆的本兩本、待查清單兩組(一整本調貨在途刪除、一張盤點時不在)。
 */
export const sampleStocktakeSheet = (
  orgId = "org-store-a",
): StocktakeSheetFixture => ({
  __typename: "LotteryStocktakeSheet",
  orgId,
  orgName: "中山店",
  serverNow: "2026-10-16T13:40:00.000Z",
  cashPoints: [
    {
      __typename: "LotteryStocktakeCashPoint",
      id: "cp-counter",
      name: "店內櫃台",
      shift: shift("shift-counter", "2026-10-16T00:02:00.000Z", false, 12_350),
      lastShift: shift(
        "shift-counter",
        "2026-10-16T00:02:00.000Z",
        false,
        12_350,
      ),
    },
    {
      __typename: "LotteryStocktakeCashPoint",
      id: "cp-outdoor",
      name: "店外攤位",
      shift: null,
      lastShift: shift("shift-outdoor", "2026-10-16T05:00:00.000Z", true, null),
    },
  ],
  books: [
    book("b-1", "cp-counter", FA_DA_CAI, "0056527", 100, 65),
    book("b-2", "cp-counter", JIN_HAO_YUN, "0060112", 100, 65),
    book("b-3", "cp-counter", SHU_LAI_BAO, "0088102", 100, 65),
    book("b-4", "cp-counter", HAO_YUN, "0042210", 50, 32),
    book("b-5", "cp-outdoor", FA_DA_CAI, "0056528", 100, 65),
    book("b-6", "cp-outdoor", ZHAO_CAI_MAO, "0071204", 25, 15),
  ],
  unopenedBooks: [
    {
      __typename: "LotteryStocktakeUnopenedBook",
      bookId: "b-u1",
      gameCode: "5133",
      gameName: "招財貓",
      bookNo: "0071205",
      ticketCount: 25,
    },
    {
      __typename: "LotteryStocktakeUnopenedBook",
      bookId: "b-u2",
      gameCode: "5198",
      gameName: "鼠來寶",
      bookNo: "0088103",
      ticketCount: 100,
    },
  ],
  lostTickets: [
    ...["001", "002", "003"].map((ticketNo) => ({
      __typename: "LotteryStocktakeLostTicket" as const,
      ticketId: `b-l1-${ticketNo}`,
      bookId: "b-l1",
      gameCode: "5164",
      bookNo: "0056420",
      ticketNo,
      bookTicketCount: 3,
      since: "2026-10-12T02:00:00.000Z",
      source: "transfer",
    })),
    ...["023", "024"].map((ticketNo) => ({
      __typename: "LotteryStocktakeLostTicket" as const,
      ticketId: `b-l2-${ticketNo}`,
      bookId: "b-l2",
      gameCode: "5201",
      bookNo: "0060090",
      ticketNo,
      bookTicketCount: 100,
      since: "2026-10-05T02:00:00.000Z",
      source: "stocktake",
    })),
  ],
});

/** Figma ST-30 的那一張盤點確認申請(審核中)。 */
export const STOCKTAKE_REVIEWING_ID = "sub-stocktake-32";

const summary = (
  overrides: Partial<StocktakeListRow["summary"]> = {},
): StocktakeListRow["summary"] => ({
  __typename: "LotteryStocktakeSummary",
  books: 18,
  backfillCount: 0,
  backfillAmount: 0,
  newInvestigate: 0,
  flagged: 0,
  confirmLost: 0,
  confirmLostCost: 0,
  uncountedCount: 0,
  ...overrides,
});

/** 盤點紀錄(Figma ST-29):臨時(待核准)、日結、交班(已確認)。 */
export const sampleStocktakeList = (): StocktakeListRow[] => [
  {
    __typename: "LotteryStocktakeListItem",
    id: "st-32",
    submissionId: STOCKTAKE_REVIEWING_ID,
    serialNo: "ST-0032",
    type: "adhoc",
    status: "pending",
    startedAt: "2026-10-16T13:40:00.000Z",
    submittedAt: "2026-10-16T14:02:00.000Z",
    summary: summary({
      books: 3,
      backfillCount: 2,
      backfillAmount: 300,
      newInvestigate: 1,
      confirmLost: 1,
      confirmLostCost: 184,
      uncountedCount: 3,
    }),
  },
  {
    __typename: "LotteryStocktakeListItem",
    id: "st-31",
    submissionId: "sub-checkout-31",
    serialNo: "ST-0031",
    type: "daily",
    status: "confirmed",
    startedAt: "2026-10-13T14:05:00.000Z",
    submittedAt: "2026-10-13T14:20:00.000Z",
    summary: summary(),
  },
  {
    __typename: "LotteryStocktakeListItem",
    id: "st-30",
    submissionId: "sub-checkout-30",
    serialNo: "ST-0030",
    type: "shift",
    status: "confirmed",
    startedAt: "2026-10-13T06:00:00.000Z",
    submittedAt: "2026-10-13T06:10:00.000Z",
    summary: summary({ backfillCount: 2, backfillAmount: 400 }),
  },
];

const detailLine = (
  bookId: string,
  cashPoint: [string, string],
  game: [string, string, number],
  bookNo: string,
  method: string,
  counts: [number, number],
  diffs: [string, string, string, boolean][],
): StocktakeDetailFixture["lines"][number] => ({
  __typename: "LotteryStocktakeDetailLine",
  bookId,
  cashPointId: cashPoint[0],
  cashPointName: cashPoint[1],
  gameCode: game[0],
  gameName: game[1],
  bookNo,
  method,
  countedAt: "2026-10-16T13:52:00.000Z",
  systemCount: counts[0],
  presentCount: counts[1],
  diffs: diffs.map(([ticketNo, kind, action, postClose]) => ({
    __typename: "LotteryStocktakeDetailDiff",
    ticketNo,
    kind,
    action,
    postClose,
    amount: action === "sale_backfill" ? game[2] : 0,
  })),
});

/** Figma ST-30 的盤點單明細。 */
export const sampleStocktakeDetail = (): StocktakeDetailFixture => ({
  __typename: "LotteryStocktakeDetail",
  id: "st-32",
  submissionId: STOCKTAKE_REVIEWING_ID,
  type: "adhoc",
  status: "pending",
  orgId: "org-store-a",
  orgName: "中山店",
  scopeCashPoint: null,
  startedAt: "2026-10-16T13:40:00.000Z",
  submittedAt: "2026-10-16T14:02:00.000Z",
  submittedBy: {
    __typename: "LotteryAccountsRef",
    id: "user-wang",
    name: "王小明",
  },
  confirmedAt: null,
  lines: [
    detailLine(
      "b-3",
      ["cp-counter", "店內櫃台"],
      SHU_LAI_BAO,
      "0088102",
      "grid",
      [35, 33],
      [
        ["071", "missing", "sale_backfill", false],
        ["088", "missing", "investigate", false],
      ],
    ),
    detailLine(
      "b-5",
      ["cp-outdoor", "店外攤位"],
      FA_DA_CAI,
      "0056528",
      "scan",
      [35, 34],
      [["090", "missing", "sale_backfill", true]],
    ),
    detailLine(
      "b-2",
      ["cp-counter", "店內櫃台"],
      JIN_HAO_YUN,
      "0060112",
      "grid",
      [35, 36],
      [["045", "extra", "flag", false]],
    ),
  ],
  unopened: [
    {
      __typename: "LotteryStocktakeDetailUnopened",
      gameCode: "5198",
      gameName: "鼠來寶",
      bookNo: "0088103",
      ticketCount: 100,
      present: false,
    },
  ],
  lostReview: [
    {
      __typename: "LotteryStocktakeDetailLostReview",
      label: "5201-060090-023",
      action: "lost",
      reasonLabel: "找不到",
      reasonNote: null,
    },
  ],
  // 沒盤完就送出:檯面上 6 本盤了 3 本,其餘 3 本記為未盤(規格 6.8,10/21 定案)
  uncountedBooks: [
    {
      __typename: "LotteryStocktakeDetailUncounted",
      bookId: "b-1",
      cashPointId: "cp-counter",
      cashPointName: "店內櫃台",
      gameCode: FA_DA_CAI[0],
      gameName: FA_DA_CAI[1],
      bookNo: "0056527",
    },
    {
      __typename: "LotteryStocktakeDetailUncounted",
      bookId: "b-4",
      cashPointId: "cp-counter",
      cashPointName: "店內櫃台",
      gameCode: HAO_YUN[0],
      gameName: HAO_YUN[1],
      bookNo: "0042210",
    },
    {
      __typename: "LotteryStocktakeDetailUncounted",
      bookId: "b-6",
      cashPointId: "cp-outdoor",
      cashPointName: "店外攤位",
      gameCode: ZHAO_CAI_MAO[0],
      gameName: ZHAO_CAI_MAO[1],
      bookNo: "0071204",
    },
  ],
  summary: summary({
    books: 3,
    backfillCount: 2,
    backfillAmount: 300,
    newInvestigate: 101,
    flagged: 1,
    confirmLost: 1,
    confirmLostCost: 184,
    uncountedCount: 3,
  }),
  draft: JSON.stringify({
    version: 1,
    orgId: "org-store-a",
    scopeCashPointId: null,
    startedAt: "2026-10-16T13:40:00.000Z",
    lines: [],
    unopened: [],
    lostReview: [],
  }),
});
