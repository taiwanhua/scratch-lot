import type {
  LotteryCheckoutQuery,
  LotteryCheckoutWizardQuery,
  LotteryCheckoutsQuery,
} from "@repo/graphql";

import { redemptionRow } from "./redemption-fixtures";
import { STOCKTAKE_REVIEWING_ID } from "./stocktake-fixtures";
import { STORE_CLERK } from "./store-fixtures";

export type CheckoutWizardFixture =
  LotteryCheckoutWizardQuery["lotteryCheckoutWizard"];
export type CheckoutListRow =
  LotteryCheckoutsQuery["lotteryCheckouts"]["items"][number];
export type CheckoutDetailFixture = LotteryCheckoutQuery["lotteryCheckout"];
type CashItem = CheckoutWizardFixture["expectedItems"][number];

/** Figma ST-28a 的那一張結帳確認申請(審核中,沒有接班人 → 店長審核)。 */
export const CHECKOUT_REVIEWING_ID = "sub-checkout-42";

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

/** 交班精靈可以選的接班人(中山店的人,不含自己)。 */
export const SUCCESSORS = [
  ref("user-li", "李小華"),
  ref("user-chen", "陳美玲"),
];

const entry = (
  refType: "redemption" | "movement",
  refId: string,
  label: string,
  occurredAt: string,
  amount: number,
) => ({
  __typename: "LotteryCheckoutCashEntry" as const,
  refType,
  refId,
  label,
  occurredAt,
  amount,
});

const item = (
  kind: string,
  count: number,
  amount: number,
  entries: CashItem["entries"] = [],
): CashItem => ({
  __typename: "LotteryCheckoutCashItem",
  kind,
  count,
  amount,
  entries,
});

/** 看板上兩班(店內櫃台 08:02、店外攤位 13:00)的頁首資料。 */
const SHIFTS = new Map<string, CheckoutWizardFixture["shift"]>([
  [
    "shift-counter",
    {
      __typename: "LotteryCheckoutShift",
      id: "shift-counter",
      orgId: "org-store-a",
      cashPoint: ref("cp-counter", "店內櫃台"),
      openedBy: ref(STORE_CLERK.id, STORE_CLERK.name),
      openedAt: "2026-10-16T00:02:00.000Z",
      closed: false,
    },
  ],
  [
    "shift-outdoor",
    {
      __typename: "LotteryCheckoutShift",
      id: "shift-outdoor",
      orgId: "org-store-a",
      cashPoint: ref("cp-outdoor", "店外攤位"),
      openedBy: ref(STORE_CLERK.id, STORE_CLERK.name),
      openedAt: "2026-10-16T05:00:00.000Z",
      closed: false,
    },
  ],
]);

/** Figma ST-17a / 17b / 18 的交班精靈資料(店內櫃台 王小明 08:02 開班,應有 12,350)。 */
export const sampleCheckoutWizard = (
  shiftId: string,
): CheckoutWizardFixture | null => {
  const shift = SHIFTS.get(shiftId);
  if (shift === undefined) {
    return null;
  }
  const redemptions = [
    redemptionRow({
      id: "rd-031",
      gameCode: "5164",
      bookNo: "0056527",
      ticketNo: "031",
      prizeAmount: 200,
      redeemedAt: "2026-10-16T01:15:00.000Z",
    }),
    redemptionRow({
      id: "rd-077",
      gameCode: "5201",
      bookNo: "0001233",
      ticketNo: "077",
      prizeAmount: 500,
      redeemedAt: "2026-10-16T03:40:00.000Z",
    }),
    redemptionRow({
      id: "rd-012",
      gameCode: "5150",
      bookNo: "0000981",
      ticketNo: "012",
      prizeAmount: 500,
      redeemedAt: "2026-10-16T06:02:00.000Z",
    }),
  ];
  return {
    __typename: "LotteryCheckoutWizard",
    shift,
    canSubmit: true,
    canSkipStocktake: true,
    reusableStocktake: {
      __typename: "LotteryCheckoutReusableStocktake",
      submissionId: STOCKTAKE_REVIEWING_ID,
      serialNo: "S-0032",
      startedAt: "2026-10-16T02:32:00.000Z",
      scopeName: "店內櫃台",
      diffCount: 0,
    },
    redemptions,
    redemptionTotal: 1200,
    expectedItems: [
      item("opening", 0, 3000),
      item("sales", 142, 14_550),
      item(
        "redemptions",
        3,
        -1200,
        redemptions.map((row) =>
          entry(
            "redemption",
            row.id,
            row.ticketLabel,
            row.redeemedAt,
            -row.prizeAmount,
          ),
        ),
      ),
      item("deposits", 2, -4000, [
        entry("movement", "mv-17", "D-0017", "2026-10-16T02:30:00.000Z", -2000),
        entry("movement", "mv-18", "D-0018", "2026-10-16T05:10:00.000Z", -2000),
      ]),
      item("withdrawals", 0, 0),
      item("transfer_out", 0, 0),
      item("transfer_in", 0, 0),
      item("refunds", 0, 0),
      item("corrections", 0, 0),
    ],
    expected: 12_350,
    pendingImpacts: [
      {
        __typename: "LotteryCheckoutPendingImpact",
        submissionId: "sub-correction-12",
        formKey: "cash_correction",
        serialNo: "C-012",
        amount: 500,
      },
      {
        __typename: "LotteryCheckoutPendingImpact",
        submissionId: "sub-reversal-8",
        formKey: "sale_reversal",
        serialNo: "R-008",
        amount: -500,
      },
    ],
    successorOptions: SUCCESSORS,
    serverNow: "2026-10-16T13:40:00.000Z",
  };
};

const listRow = (
  id: string,
  serialNo: string,
  type: string,
  submissionStatus: string,
  cashPoint: ReturnType<typeof ref> | null,
  submittedBy: ReturnType<typeof ref>,
  expected: number,
  counted: number,
  submittedAt: string,
): CheckoutListRow => ({
  __typename: "LotteryCheckoutListItem",
  id: `co-${id}`,
  submissionId: id === "42" ? CHECKOUT_REVIEWING_ID : `sub-checkout-${id}`,
  serialNo,
  type,
  status: submissionStatus === "completed" ? "confirmed" : "pending",
  submissionStatus,
  cashPoint,
  submittedBy,
  expected,
  counted,
  difference: counted - expected,
  submittedAt,
});

/** Figma ST-27 的四列(新到舊)。 */
export const sampleCheckoutList = (): CheckoutListRow[] => [
  listRow(
    "42",
    "C-0042",
    "shift",
    "reviewing",
    ref("cp-counter", "店內櫃台"),
    ref("user-li", "李小華"),
    6500,
    6400,
    "2026-10-16T14:10:00.000Z",
  ),
  listRow(
    "41",
    "C-0041",
    "shift",
    "completed",
    ref("cp-counter", "店內櫃台"),
    ref(STORE_CLERK.id, STORE_CLERK.name),
    8200,
    8200,
    "2026-10-15T14:05:00.000Z",
  ),
  listRow(
    "40",
    "C-0040",
    "daily",
    "completed",
    null,
    ref(STORE_CLERK.id, STORE_CLERK.name),
    48_200,
    48_200,
    "2026-10-15T14:30:00.000Z",
  ),
  listRow(
    "39",
    "C-0039",
    "shift",
    "returned",
    ref("cp-outdoor", "店外攤位"),
    ref("user-chen", "陳美玲"),
    3000,
    3000,
    "2026-10-14T13:00:00.000Z",
  ),
];

/** Figma ST-28a 的結帳單(C-0042:沿用全店盤點 S-0032、差額 −100 找錯錢、沒有接班人)。 */
export const sampleCheckoutDetail = (): CheckoutDetailFixture => {
  const rows: [number, number][] = [
    [1000, 5],
    [500, 2],
    [100, 3],
    [50, 1],
    [10, 4],
    [5, 2],
  ];
  const denominations = rows.map(([value, count]) => ({
    __typename: "LotteryCheckoutDenomination" as const,
    value,
    count,
  }));
  return {
    __typename: "LotteryCheckoutDetail",
    id: "co-42",
    submissionId: CHECKOUT_REVIEWING_ID,
    type: "shift",
    status: "pending",
    orgId: "org-store-a",
    orgName: "中山店",
    cashPoint: ref("cp-counter", "店內櫃台"),
    shiftId: "shift-counter",
    cashPointPrinterId: null,
    shiftOpenedAt: "2026-10-16T00:02:00.000Z",
    shiftClosedAt: "2026-10-16T07:10:00.000Z",
    stocktakeMode: "reuse",
    stocktake: {
      __typename: "LotteryCheckoutReusableStocktake",
      submissionId: STOCKTAKE_REVIEWING_ID,
      serialNo: "S-0032",
      startedAt: "2026-10-16T13:40:00.000Z",
      scopeName: null,
      diffCount: 3,
    },
    skipReason: null,
    skipReasonNote: null,
    expectedItems: [
      item("opening", 0, 3000),
      item("sales", 42, 6900),
      item("redemptions", 3, -400, [
        entry(
          "redemption",
          "rd-031",
          "5164-056527-031",
          "2026-10-16T09:15:00.000Z",
          -200,
        ),
        entry(
          "redemption",
          "rd-017",
          "5198-088102-017",
          "2026-10-16T11:05:00.000Z",
          -100,
        ),
        entry(
          "redemption",
          "rd-083",
          "5150-042210-083",
          "2026-10-16T12:40:00.000Z",
          -100,
        ),
      ]),
      item("deposits", 1, -3000, [
        entry("movement", "mv-18", "D-0018", "2026-10-16T12:00:00.000Z", -3000),
      ]),
      item("withdrawals", 0, 0),
      item("transfer_out", 0, 0),
      item("transfer_in", 0, 0),
      item("refunds", 0, 0),
      item("corrections", 0, 0),
    ],
    expected: 6500,
    denominations,
    counted: 6400,
    difference: -100,
    diffReason: "找錯錢",
    diffReasonNote: null,
    pendingImpacts: [],
    leftForNext: 0,
    successor: null,
    submittedBy: ref("user-li", "李小華"),
    submittedAt: "2026-10-16T14:10:00.000Z",
    confirmedAt: null,
    coveredFrom: null,
    coveredTo: null,
    coveredShifts: [],
    bankDepositAmount: 0,
    bankAccount: null,
    draft: JSON.stringify({
      version: 1,
      type: "shift",
      orgId: "org-store-a",
      shiftId: "shift-counter",
      cashPointId: "cp-counter",
      stocktake: { mode: "reuse", submissionId: STOCKTAKE_REVIEWING_ID },
      denominations: denominations.map(({ value, count }) => ({
        value,
        count,
      })),
      diffReasonKey: "wrong-change",
      diffReasonNote: null,
      leftForNext: 0,
      successorId: null,
    }),
  };
};
