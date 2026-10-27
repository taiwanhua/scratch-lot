import { describe, expect, it } from "@jest/globals";

import type { LotteryShiftCheckoutsReportQuery } from "@repo/graphql";

import { fullPathTranslator } from "@/lib/project/reports/report-registry";

import {
  type ShiftCheckoutRow,
  buildShiftCheckoutsSheets,
  stocktakeText,
  taskText,
} from "./shift-checkouts-sheets";

const t = (key: string, values?: Record<string, string | number>) =>
  values === undefined ? key : `${key}${JSON.stringify(values)}`;

/** 直接呼叫的欄位函式吃完整路徑的鍵(工作表建構時由 `fullPathTranslator` 包過)。 */
const tFull = fullPathTranslator(t);

const row = (overrides: Partial<ShiftCheckoutRow>): ShiftCheckoutRow => ({
  checkoutId: "c1",
  orgId: "org-zhongshan",
  cashPointId: "cp-1",
  cashPointName: "店內櫃台",
  openedAt: "2026-10-16T08:00:00.000Z",
  submittedAt: "2026-10-16T14:10:00.000Z",
  leader: "李大華",
  helpers: ["陳小美"],
  taskRole: "leader",
  taskPosition: "店內櫃台",
  taskName: "店內事務與帳目負責",
  expected: 3000,
  counted: 4800,
  difference: 1800,
  diffReason: "其他",
  postClose: 1800,
  postCloseEntries: [
    {
      category: "redemption",
      amount: 2000,
      recordedAt: "2026-10-17T02:00:00.000Z",
      priorPeriod: false,
    },
    {
      category: "redemption",
      amount: -200,
      recordedAt: "2026-10-17T02:00:00.000Z",
      priorPeriod: false,
    },
    {
      category: "cashCorrection",
      amount: 100,
      recordedAt: "2026-11-05T02:00:00.000Z",
      priorPeriod: true,
    },
  ],
  stocktakeMode: "new",
  skipReason: null,
  uncountedBooks: 0,
  status: "confirmed",
  ...overrides,
});

const orgs = [
  { id: "org-zhongshan", name: "中山店" },
  { id: "org-hsinchu", name: "新竹店" },
];

describe("班次結帳歷史報表的工作表", () => {
  it("一班一列:負責人、協同、任務內容、開班 / 結帳、事後更正;合計多一欄分店", () => {
    const data: LotteryShiftCheckoutsReportQuery = {
      lotteryShiftCheckoutsReport: {
        rows: [row({}), row({ checkoutId: "c2", orgId: "org-hsinchu" })],
      },
    };
    const sheets = buildShiftCheckoutsSheets(data, {
      t,
      timezone: "Asia/Taipei",
      input: {
        periodKind: "day",
        from: "",
        to: "",
        orgIds: orgs.map((org) => org.id),
      },
      orgs,
      canShowCost: false,
      generatedAt: new Date("2026-10-17T01:12:00.000Z"),
      generatedBy: "王店長",
    });
    expect(sheets.total.columns[0]?.key).toBe("store");
    expect(sheets.total.rows).toHaveLength(2);
    expect(sheets.total.rows[1]).toMatchObject({ store: "新竹店" });
    expect(sheets.branches.map((sheet) => sheet.rows.length)).toEqual([1, 1]);
    expect(sheets.branches[0]?.columns[0]?.key).toBe("date");
    expect(sheets.branches[0]?.rows[0]).toMatchObject({
      date: "10/16",
      leader: "李大華",
      helpers: "陳小美",
      time: "16:00 / 22:10",
      // 差額照結帳快照;事後更正同一天同類別合併、關帳後的標前期更正
      difference: 1800,
      postClose: `lotteryReports.shiftCheckouts.postCloseEntry${JSON.stringify({
        amount: "+1,800",
        date: "10/17",
        category: "lotteryReports.operations.postClose.redemption",
      })}、lotteryReports.shiftCheckouts.postCloseEntryPrior${JSON.stringify({
        amount: "+100",
        date: "11/5",
        category: "lotteryReports.operations.postClose.cashCorrection",
      })}`,
      status: "lotteryReports.shiftCheckouts.status.confirmed",
    });
  });

  it("盤點欄:跳過盤點永久標示「未盤點(跳過)」,與「N 本未盤」並列", () => {
    expect(
      stocktakeText(
        row({
          stocktakeMode: "skip",
          skipReason: "人力不足",
          uncountedBooks: 0,
        }),
        tFull,
      ),
    ).toBe(
      `lotteryReports.shiftCheckouts.stocktake.skippedWithReason${JSON.stringify(
        { reason: "人力不足" },
      )}`,
    );
    expect(stocktakeText(row({ uncountedBooks: 2 }), tFull)).toBe(
      `lotteryReports.shiftCheckouts.stocktake.uncounted${JSON.stringify({
        count: 2,
      })}`,
    );
    expect(stocktakeText(row({}), tFull)).toBe("");
  });

  it("任務內容:崗位 · 職責 · 執行任務;未對應排班另有文字", () => {
    expect(taskText(row({}), tFull)).toBe(
      "店內櫃台 · lotteryReports.shiftCheckouts.roles.leader · 店內事務與帳目負責",
    );
    expect(taskText(row({ taskRole: null }), tFull)).toBe(
      "lotteryReports.shiftCheckouts.noTask",
    );
  });
});
