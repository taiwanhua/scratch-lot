import type {
  LotteryPeriodCloseCheckQuery,
  LotteryPeriodCloseQuery,
  LotteryPeriodClosesQuery,
  LotteryPeriodSnapshotFieldsFragment,
} from "@repo/graphql";

/**
 * 關帳的假資料(Figma AC-06 93:1417、AC-07 93:1664;規格 10.4):
 * 10 月進行中、9 月未關帳(可以關)、8 月已關帳(王總 9/3 10:12);9 月的檢查清單都通過、新竹店有 2 班沒被日結涵蓋。
 */
export type PeriodRowFixture =
  LotteryPeriodClosesQuery["lotteryPeriodCloses"]["items"][number];
export type PeriodCheckFixture =
  LotteryPeriodCloseCheckQuery["lotteryPeriodCloseCheck"];
export type PeriodCloseFixture = LotteryPeriodCloseQuery["lotteryPeriodClose"];

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

export const periodRow = (
  month: string,
  status: "current" | "open" | "closed",
  overrides: Partial<PeriodRowFixture> = {},
): PeriodRowFixture => ({
  __typename: "LotteryPeriodRow",
  month,
  status,
  closedAt: null,
  closedBy: null,
  canClose: false,
  ...overrides,
});

export const samplePeriodRows = (): PeriodRowFixture[] => [
  periodRow("2026-10", "current"),
  periodRow("2026-09", "open", { canClose: true }),
  periodRow("2026-08", "closed", {
    closedAt: "2026-09-03T02:12:00.000Z",
    closedBy: ref("user-boss", "王總"),
  }),
];

export const samplePeriodSnapshot =
  (): LotteryPeriodSnapshotFieldsFragment => ({
    __typename: "LotteryPeriodSnapshot",
    bankAccounts: [
      {
        __typename: "LotteryPeriodBankAccountSnapshot",
        accountId: "acc-1",
        label: "台灣銀行 末 34521",
        balance: 1_102_800,
      },
      {
        __typename: "LotteryPeriodBankAccountSnapshot",
        accountId: "acc-2",
        label: "土地銀行 末 88012",
        balance: 86_400,
      },
    ],
    stores: [
      {
        __typename: "LotteryPeriodStoreSnapshot",
        orgId: "org-store-a",
        name: "中山店",
        vault: 52_000,
        drawerTotal: 0,
        drawers: [
          {
            __typename: "LotteryPeriodDrawerSnapshot",
            cashPointId: "cp-1",
            name: "店內櫃台",
            amount: 0,
            spanningShiftLabel: null,
          },
        ],
        uncoveredShifts: [],
      },
      {
        __typename: "LotteryPeriodStoreSnapshot",
        orgId: "org-store-b",
        name: "新竹店",
        vault: 31_500,
        drawerTotal: 2000,
        drawers: [
          {
            __typename: "LotteryPeriodDrawerSnapshot",
            cashPointId: "cp-2",
            name: "店內櫃台",
            amount: 2000,
            spanningShiftLabel: null,
          },
        ],
        uncoveredShifts: [
          {
            __typename: "LotteryPeriodShiftSnapshot",
            shiftId: "shift-1",
            label: "店內櫃台 · 李小華 09/29 13:00",
          },
          {
            __typename: "LotteryPeriodShiftSnapshot",
            shiftId: "shift-2",
            label: "店內櫃台 · 李小華 09/30 13:00",
          },
        ],
      },
    ],
  });

export const samplePeriodCheck = (
  month: string,
  overrides: Partial<PeriodCheckFixture> = {},
): PeriodCheckFixture => ({
  __typename: "LotteryPeriodCloseCheck",
  month,
  openShifts: [],
  pendingDocuments: [],
  snapshot: samplePeriodSnapshot(),
  canClose: true,
  ...overrides,
});

/** 有擋下項目的檢查清單(還有沒結帳的班、審核中的撤銷售出申請)。 */
export const blockedPeriodCheck = (month: string): PeriodCheckFixture =>
  samplePeriodCheck(month, {
    canClose: false,
    openShifts: [
      {
        __typename: "LotteryPeriodOpenShift",
        shiftId: "shift-open",
        orgName: "中山店",
        label: "店外攤位 · 王小明 09/30 21:00",
      },
    ],
    pendingDocuments: [
      {
        __typename: "LotteryPeriodPendingDocument",
        kind: "sale_reversal",
        submissionId: "sub-r012",
        serialNo: "R-012",
        orgName: "中山店",
        shiftLabel: "店內櫃台 · 王小明 09/30 17:00",
        at: "2026-09-30T09:00:00.000Z",
      },
    ],
  });

export const samplePeriodClose = (month: string): PeriodCloseFixture => ({
  __typename: "LotteryPeriodClose",
  id: `close-${month}`,
  month,
  closedAt: "2026-09-03T02:12:00.000Z",
  closedBy: ref("user-boss", "王總"),
  note: null,
  snapshot: samplePeriodSnapshot(),
});
