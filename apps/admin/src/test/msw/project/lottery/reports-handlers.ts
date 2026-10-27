import { HttpResponse } from "msw";

import type {
  LotteryOperationsReportPeriodsQueryVariables,
  LotteryOperationsReportQuery,
  LotteryOperationsReportQueryVariables,
  LotteryShiftCheckoutsReportCashPointsQueryVariables,
  LotteryShiftCheckoutsReportQuery,
  LotteryShiftCheckoutsReportQueryVariables,
} from "@repo/graphql";

import { api, type server } from "../../server";
import {
  inventoryOf,
  movement,
  outstandingItem,
} from "./operations-report-fixtures";

type OperationsStore =
  LotteryOperationsReportQuery["lotteryOperationsReport"]["stores"][number];
type ShiftCheckoutRow =
  LotteryShiftCheckoutsReportQuery["lotteryShiftCheckoutsReport"]["rows"][number];

const qty = (count: number, amount: number) => ({
  __typename: "LotteryReportQty" as const,
  count,
  amount,
});

/**
 * 營運報表一家店的示範數字(Figma RE-04 `129:1186` 中山店的那一份):第二家店起把數字縮小一點,合計看得出加總。
 * `withCost = false`(沒有 `reports.show-cost`)時成本欄是 null,與 api 一致。
 */
export const operationsStore = (
  orgId: string,
  index: number,
  input: { from: string; to: string },
  options: { withCost?: boolean; alignment?: string } = {},
): OperationsStore => {
  const scale = index === 0 ? 1 : 0.5;
  const n = (value: number) => Math.round(value * scale);
  const cost = (value: number) =>
    options.withCost === false ? null : n(value);
  return {
    __typename: "LotteryOperationsStore",
    orgId,
    period: {
      __typename: "LotteryReportStorePeriod",
      orgId,
      from: input.from,
      to: input.to,
      alignment: options.alignment ?? "period",
    },
    sales: {
      __typename: "LotteryOperationsSales",
      scan: qty(n(210), n(42_000)),
      manual: [
        {
          __typename: "LotteryReportReasonQty",
          reasonKey: "scan-failed",
          reason: "刷不到條碼",
          count: n(2),
          amount: n(300),
        },
      ],
      stocktake: qty(1, 200),
      undo: qty(2, 300),
      net: qty(n(211), n(42_200)),
      cost: cost(38_824),
      games: [
        {
          __typename: "LotteryOperationsGameSales",
          gameId: "game-5164",
          gameCode: "5164",
          gameName: "發大財",
          unitPrice: 200,
          sold: n(121),
          undone: 1,
          netAmount: n(23_800),
          cost: cost(22_000),
        },
        {
          __typename: "LotteryOperationsGameSales",
          gameId: "game-5201",
          gameCode: "5201",
          gameName: "金好運",
          unitPrice: 100,
          sold: n(61),
          undone: 1,
          netAmount: n(5900),
          cost: cost(5400),
        },
      ],
    },
    redemption: {
      __typename: "LotteryOperationsRedemption",
      valid: qty(6, n(9500)),
      inStore: qty(2, n(1500)),
      sent: qty(4, n(8000)),
      revoked: qty(1, 500),
    },
    inventory: inventoryOf(n, cost),
    cash: {
      __typename: "LotteryOperationsCash",
      shiftCount: 2,
      pendingShiftCount: index === 0 ? 0 : 1,
      shiftDifference: -100,
      postClose: [
        {
          __typename: "LotteryReportPostClose",
          category: "stocktake",
          count: 1,
          amount: 200,
        },
      ],
      dailyCloseCount: 1,
      vaultDifference: 0,
      movements: [
        movement("deposit", 3, -n(12_000), n(12_000)),
        movement("withdraw", 1, n(5000), -n(5000)),
        movement("bank_deposit", 1, 0, -n(20_000)),
        movement("refund", 1, -200, 0),
        movement("transfer_out", 0, 0, 0),
        movement("transfer_in", 0, 0, 0),
        movement("correction", 1, 100, 0),
      ],
    },
    bankAccounts: [
      {
        __typename: "LotteryOperationsBankAccount",
        accountId: "acct-1",
        label: "台灣銀行 末 12345",
        shared: true,
        types: [
          {
            __typename: "LotteryOperationsBankType",
            type: "deposit",
            inAmount: n(20_000),
            outAmount: 0,
            reversalCount: 0,
          },
          {
            __typename: "LotteryOperationsBankType",
            type: "purchase_expense",
            inAmount: 0,
            outAmount: n(70_200),
            reversalCount: index === 0 ? 0 : 1,
          },
        ],
        endingBalance: 1_204_300 + index,
      },
    ],
    outstanding: {
      __typename: "LotteryOperationsOutstanding",
      items: [
        outstandingItem("purchaseToPay", 0, 0, []),
        outstandingItem("purchaseToRefund", 1, n(9200), ["P-0012"]),
        outstandingItem("transferToReceive", 1, n(19_504), ["T-0003"]),
        outstandingItem("transferToPay", 0, 0, []),
        outstandingItem("transferPayerRefund", 0, 0, []),
        outstandingItem("transferPayeeRefund", 0, 0, []),
      ],
    },
    notes: {
      __typename: "LotteryOperationsNotes",
      skippedStocktakes:
        index === 0
          ? []
          : [
              {
                __typename: "LotteryOperationsSkipReason",
                reason: "人力不足",
                count: 1,
              },
            ],
      uncountedStocktakes: index === 0 ? 0 : 1,
      uncountedBooks: index === 0 ? 0 : 2,
      uncoveredShifts: index === 0 ? 0 : 3,
      uncoveredShiftLabels: index === 0 ? [] : ["10/16 晚班"],
      priorPeriodCount: 0,
      priorPeriodAmount: 0,
      openMonths: ["2026-10"],
    },
  };
};

const shiftRow = (
  orgId: string,
  overrides: Partial<ShiftCheckoutRow>,
): ShiftCheckoutRow => ({
  __typename: "LotteryShiftCheckoutRow",
  checkoutId: `checkout-${orgId}-${overrides.cashPointName ?? ""}`,
  orgId,
  cashPointId: "cp-counter",
  cashPointName: "店內櫃台",
  openedAt: "2026-10-16T08:00:00.000Z",
  submittedAt: "2026-10-16T14:10:00.000Z",
  leader: "李大華",
  helpers: [],
  taskRole: "leader",
  taskPosition: "店內櫃台",
  taskName: "店內事務與帳目負責",
  expected: 6500,
  counted: 6400,
  difference: -100,
  diffReason: "找錯錢",
  postClose: 0,
  postCloseEntries: [],
  stocktakeMode: "new",
  skipReason: null,
  uncountedBooks: 0,
  status: "pending",
  ...overrides,
});

/** 各店實際期間:勾「對齊日結」時第一家有日結(前一天 22:05 ~ 當天 22:30)、其他家整天。 */
const periodsOf = (
  input: LotteryOperationsReportPeriodsQueryVariables["input"],
) =>
  input.orgIds.map((orgId, index) => {
    const aligned = input.alignDailyClose === true;
    if (aligned && index === 0) {
      return {
        orgId,
        from: new Date(Date.parse(input.from) - 115 * 60_000).toISOString(),
        to: new Date(
          Date.parse(input.from) + (22 * 60 + 30) * 60_000,
        ).toISOString(),
        alignment: "dailyClose",
      };
    }
    return {
      orgId,
      from: input.from,
      to: input.to,
      alignment: aligned ? "fullDay" : "period",
    };
  });

export interface ReportsWorldOptions {
  /** 沒有 `reports.show-cost`:成本欄回 null */
  withCost?: boolean;
  /** 最後一個已關帳月份 */
  closedThrough?: string | null;
}

/**
 * 輸出報表兩張報表的假 api(元件測試與 mock 模式共用):營運報表每家選的分店回一份示範數字(第一家有日結、
 * 其他家勾「對齊日結」時當天沒日結 → 整天)、條件畫面的逐店期間、班次結帳歷史(Figma RE-05 的兩列)、收銀點下拉。
 */
export const reportsWorld = (options: ReportsWorldOptions = {}) => {
  const operationsInputs: LotteryOperationsReportQueryVariables["input"][] = [];
  const shiftInputs: LotteryShiftCheckoutsReportQueryVariables["input"][] = [];
  const handlers: Parameters<typeof server.use> = [
    api.query<
      LotteryOperationsReportQuery,
      LotteryOperationsReportQueryVariables
    >("LotteryOperationsReport", ({ variables }) => {
      operationsInputs.push(variables.input);
      const periods = periodsOf(variables.input);
      return HttpResponse.json({
        data: {
          lotteryOperationsReport: {
            __typename: "LotteryOperationsReport",
            closedThrough: options.closedThrough ?? "2026-09",
            canShowCost: options.withCost !== false,
            stores: periods.map((period, index) =>
              operationsStore(period.orgId, index, period, {
                withCost: options.withCost,
                alignment: period.alignment,
              }),
            ),
          },
        },
      });
    }),
    api.query("LotteryOperationsReportPeriods", ({ variables }) => {
      const input = (variables as LotteryOperationsReportPeriodsQueryVariables)
        .input;
      return HttpResponse.json({
        data: {
          lotteryOperationsReportPeriods: {
            __typename: "LotteryReportPeriods",
            closedThrough: options.closedThrough ?? "2026-09",
            stores: periodsOf(input).map((period) => ({
              __typename: "LotteryReportStorePeriod",
              ...period,
            })),
          },
        },
      });
    }),
    api.query<
      LotteryShiftCheckoutsReportQuery,
      LotteryShiftCheckoutsReportQueryVariables
    >("LotteryShiftCheckoutsReport", ({ variables }) => {
      shiftInputs.push(variables.input);
      const rows = variables.input.orgIds.flatMap((orgId) => [
        shiftRow(orgId, {}),
        shiftRow(orgId, {
          cashPointId: "cp-outside",
          cashPointName: "店外攤位",
          leader: "王小明",
          helpers: ["陳小美"],
          taskRole: "helper",
          openedAt: "2026-10-15T05:00:00.000Z",
          submittedAt: "2026-10-15T13:00:00.000Z",
          expected: 7000,
          counted: 7200,
          difference: 200,
          diffReason: "審核中的單據",
          postClose: 200,
          postCloseEntries: [
            {
              __typename: "LotteryShiftPostCloseEntry",
              category: "cashCorrection",
              amount: 200,
              recordedAt: "2026-10-16T03:00:00.000Z",
              priorPeriod: false,
            },
          ],
          stocktakeMode: "skip",
          skipReason: "人力不足",
          uncountedBooks: 0,
          status: "confirmed",
        }),
      ]);
      const filtered = rows.filter(
        (row) =>
          (variables.input.cashPointId == null ||
            variables.input.cashPointId === "" ||
            row.cashPointId === variables.input.cashPointId) &&
          (variables.input.onlyWithDifference !== true || row.difference !== 0),
      );
      return HttpResponse.json({
        data: {
          lotteryShiftCheckoutsReport: {
            __typename: "LotteryShiftCheckoutsReport",
            rows: filtered,
          },
        },
      });
    }),
    api.query("LotteryShiftCheckoutsReportCashPoints", ({ variables }) => {
      const input = (
        variables as LotteryShiftCheckoutsReportCashPointsQueryVariables
      ).input;
      return HttpResponse.json({
        data: {
          lotteryShiftCheckoutsReportCashPoints: input.orgIds.flatMap(
            (orgId) => [
              {
                __typename: "LotteryReportCashPoint",
                id: "cp-counter",
                orgId,
                name: "店內櫃台",
              },
              {
                __typename: "LotteryReportCashPoint",
                id: "cp-outside",
                orgId,
                name: "店外攤位",
              },
            ],
          ),
        },
      });
    }),
  ];
  return { handlers, operationsInputs, shiftInputs };
};
