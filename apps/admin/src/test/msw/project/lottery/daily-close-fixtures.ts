import type {
  LotteryBankDepositFormQuery,
  LotteryCheckoutQuery,
  LotteryDailyCloseStatusQuery,
  LotteryDailyCloseWizardQuery,
} from "@repo/graphql";

import { CHECKOUT_REVIEWING_ID } from "./checkout-fixtures";
import { STOCKTAKE_REVIEWING_ID } from "./stocktake-fixtures";
import { STORE_CLERK } from "./store-fixtures";

export type DailyCloseWizardFixture =
  LotteryDailyCloseWizardQuery["lotteryDailyCloseWizard"];
export type DailyCloseStatusFixture =
  LotteryDailyCloseStatusQuery["lotteryDailyCloseStatus"];
export type BankDepositFormFixture =
  LotteryBankDepositFormQuery["lotteryBankDepositForm"];
type ShiftRow = DailyCloseWizardFixture["shifts"][number];
type CashItem = DailyCloseWizardFixture["vaultItems"][number];
type CheckoutDetail = LotteryCheckoutQuery["lotteryCheckout"];

/** Figma ST-28b 的那一張日結(C-0043,審核中;店長審核)。 */
export const DAILY_CLOSE_REVIEWING_ID = "sub-checkout-43";

/** 中山店(看板的那家店)。 */
export const DAILY_CLOSE_ORG = { id: "org-store-a", name: "中山店" };

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

/** 台灣銀行 中山分行(使用組織包含中山店)。 */
export const DAILY_CLOSE_ACCOUNT = ref("acc-1", "台灣銀行 中山分行 ****12345");

const movement = (id: string, label: string, at: string, amount: number) => ({
  __typename: "LotteryCheckoutCashEntry" as const,
  refType: "movement",
  refId: id,
  label,
  occurredAt: at,
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

const row = (
  shiftId: string,
  serialNo: string,
  cashPoint: ReturnType<typeof ref>,
  submittedBy: ReturnType<typeof ref>,
  submittedAt: string,
  expected: number,
  counted: number,
  state: string,
  extra: Partial<ShiftRow> = {},
): ShiftRow => ({
  __typename: "LotteryDailyCloseShiftRow",
  shiftId,
  submissionId: `sub-${shiftId}`,
  serialNo,
  instanceId: null,
  cashPoint,
  submittedBy,
  submittedAt,
  expected,
  counted,
  difference: counted - expected,
  state,
  waitingFor: [],
  isMine: false,
  ...extra,
});

const COUNTER = ref("cp-counter", "店內櫃台");
const OUTDOOR = ref("cp-outdoor", "店外攤位");
const LOTTERY_SIDE = ref("cp-lottery", "彩券機旁");

/** Figma ST-21 的四班:已核准、待審核(你)、已退回(待陳美玲更正)、待審核(等王小明)。 */
const sampleRows = (): ShiftRow[] => [
  row(
    "shift-c40",
    "C-0040",
    COUNTER,
    ref(STORE_CLERK.id, STORE_CLERK.name),
    "2026-10-16T06:02:00.000Z",
    8200,
    8200,
    "approved",
  ),
  row(
    "shift-c42",
    "C-0042",
    COUNTER,
    ref("user-li", "李小華"),
    "2026-10-16T14:10:00.000Z",
    6500,
    6400,
    "pending",
    {
      submissionId: CHECKOUT_REVIEWING_ID,
      instanceId: `inst-${CHECKOUT_REVIEWING_ID}`,
      isMine: true,
    },
  ),
  row(
    "shift-c41",
    "C-0041",
    OUTDOOR,
    ref("user-chen", "陳美玲"),
    "2026-10-16T13:55:00.000Z",
    3000,
    3000,
    "returned",
    { waitingFor: ["陳美玲"] },
  ),
  row(
    "shift-c44",
    "C-0044",
    LOTTERY_SIDE,
    ref("user-lin", "林美麗"),
    "2026-10-16T12:30:00.000Z",
    2100,
    2100,
    "pending",
    { waitingFor: [STORE_CLERK.name] },
  ),
];

export interface DailyCloseWizardOptions {
  /** 各班都已核准(可以到下一步);預設 false(Figma ST-21 的樣子) */
  allApproved?: boolean;
}

/** Figma ST-21–25b 的日結精靈資料(中山店;涵蓋計算期間 10/14 09:02 至現在,10/14、10/15 沒有日結)。 */
export const sampleDailyCloseWizard = (
  orgId: string,
  options: DailyCloseWizardOptions = {},
): DailyCloseWizardFixture => {
  const shifts = sampleRows().map((one) =>
    options.allApproved === true
      ? { ...one, state: "approved", waitingFor: [], isMine: false }
      : one,
  );
  return {
    __typename: "LotteryDailyCloseWizard",
    org: ref(orgId, DAILY_CLOSE_ORG.name),
    coveredFrom: "2026-10-14T01:02:00.000Z",
    coveredTo: null,
    gapDates: ["2026-10-14", "2026-10-15"],
    openShifts: [],
    pending: null,
    shifts,
    differenceTotal: shifts.reduce((sum, one) => sum + one.difference, 0),
    canSubmit: true,
    canSkipStocktake: true,
    reusableStocktake: {
      __typename: "LotteryCheckoutReusableStocktake",
      submissionId: STOCKTAKE_REVIEWING_ID,
      serialNo: "S-0032",
      startedAt: "2026-10-16T13:40:00.000Z",
      scopeName: null,
      diffCount: 0,
    },
    vaultItems: [
      item("opening", 0, 20_000),
      item("deposits", 6, 12_000, [
        movement("mv-d1", "投庫", "2026-10-16T02:30:00.000Z", 2000),
      ]),
      item("withdrawals", 3, -3000, [
        movement("mv-w1", "補零錢", "2026-10-16T05:10:00.000Z", -1000),
      ]),
      item("transfers", 0, 0),
      item("corrections", 0, 0),
      item("bank_deposits", 1, -5000, [
        movement("mv-b1", "存銀行", "2026-10-15T04:00:00.000Z", -5000),
      ]),
    ],
    vaultExpected: 24_000,
    vaultBaselineAt: "2026-10-13T13:30:00.000Z",
    bankAccounts: [DAILY_CLOSE_ACCOUNT],
    serverNow: "2026-10-16T14:30:00.000Z",
  };
};

/** 看板頂部「上次日結:10/13(已 3 天)」。 */
export const sampleDailyCloseStatus = (): DailyCloseStatusFixture => ({
  __typename: "LotteryDailyCloseStatus",
  lastClosedAt: "2026-10-13T13:30:00.000Z",
  daysSince: 3,
  pending: null,
});

/** 存銀行視窗(ST-26a):小金庫目前應有 24,000、一個帳戶(自動帶入)。 */
export const sampleBankDepositForm = (
  orgId: string,
  accounts = [DAILY_CLOSE_ACCOUNT],
): BankDepositFormFixture => ({
  __typename: "LotteryBankDepositForm",
  org: ref(orgId, DAILY_CLOSE_ORG.name),
  vaultExpected: 24_000,
  reserved: 0,
  accounts,
});

/** Figma ST-28b 的日結結帳單(C-0043:沿用全店盤點 S-0032、小金庫應有 25,000、存入 20,000)。 */
export const sampleDailyCloseDetail = (): CheckoutDetail => {
  const rows: [number, number][] = [
    [1000, 20],
    [500, 6],
    [100, 18],
    [50, 2],
    [10, 10],
  ];
  const denominations = rows.map(([value, count]) => ({
    __typename: "LotteryCheckoutDenomination" as const,
    value,
    count,
  }));
  return {
    __typename: "LotteryCheckoutDetail",
    id: "co-43",
    submissionId: DAILY_CLOSE_REVIEWING_ID,
    type: "daily",
    status: "pending",
    orgId: DAILY_CLOSE_ORG.id,
    orgName: DAILY_CLOSE_ORG.name,
    cashPoint: null,
    shiftId: null,
    stocktakeMode: "reuse",
    stocktake: {
      __typename: "LotteryCheckoutReusableStocktake",
      submissionId: STOCKTAKE_REVIEWING_ID,
      serialNo: "S-0032",
      startedAt: "2026-10-16T13:40:00.000Z",
      scopeName: null,
      diffCount: 0,
    },
    skipReason: null,
    skipReasonNote: null,
    expectedItems: [
      item("opening", 0, 20_000),
      item("deposits", 3, 8000, [
        movement("mv-d2", "投庫", "2026-10-16T08:00:00.000Z", 8000),
      ]),
      item("withdrawals", 1, -3000, [
        movement("mv-w2", "開班零用金", "2026-10-16T01:00:00.000Z", -3000),
      ]),
      item("transfers", 0, 0),
      item("corrections", 0, 0),
      item("bank_deposits", 0, 0),
    ],
    expected: 25_000,
    denominations,
    counted: 25_000,
    difference: 0,
    diffReason: null,
    diffReasonNote: null,
    pendingImpacts: [],
    leftForNext: 0,
    successor: null,
    submittedBy: ref("user-li", "李小華"),
    submittedAt: "2026-10-16T14:30:00.000Z",
    confirmedAt: null,
    coveredFrom: "2026-10-16T01:02:00.000Z",
    coveredTo: "2026-10-16T14:30:00.000Z",
    coveredShifts: ["C-0040", "C-0041", "C-0042"].map((serialNo) => ({
      __typename: "LotteryCheckoutCoveredShift" as const,
      submissionId: `sub-${serialNo}`,
      serialNo,
      cashPointName: "店內櫃台",
    })),
    bankDepositAmount: 20_000,
    bankAccount: ref("acc-1", "台銀 ·····12345"),
    draft: JSON.stringify({
      version: 1,
      type: "daily",
      orgId: DAILY_CLOSE_ORG.id,
      stocktake: { mode: "reuse", submissionId: STOCKTAKE_REVIEWING_ID },
      denominations: denominations.map(({ value, count }) => ({
        value,
        count,
      })),
      diffReasonKey: null,
      diffReasonNote: null,
      bankDeposit: { amount: 20_000, accountId: "acc-1" },
    }),
  };
};
