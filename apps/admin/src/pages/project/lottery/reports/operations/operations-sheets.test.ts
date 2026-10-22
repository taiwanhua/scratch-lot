import { describe, expect, it } from "@jest/globals";

import type { LotteryOperationsReportQuery } from "@repo/graphql";

import { operationsStore } from "@/test/msw/project/lottery/reports-handlers";

import { buildOperationsSheets } from "./operations-sheets";
import { totalStoreOf } from "./operations-total";

/** 翻譯換成「key + 參數」,斷言看得出用了哪個訊息。 */
const t = (key: string, values?: Record<string, string | number>) =>
  values === undefined ? key : `${key}${JSON.stringify(values)}`;

const DAY = {
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
};

const orgs = [
  { id: "org-zhongshan", name: "中山店" },
  { id: "org-hsinchu", name: "新竹店" },
];

const dataOf = (
  stores: LotteryOperationsReportQuery["lotteryOperationsReport"]["stores"],
): LotteryOperationsReportQuery => ({
  lotteryOperationsReport: {
    closedThrough: "2026-09",
    canShowCost: true,
    stores,
  },
});

const context = (periodKind: "day" | "month" = "day") => ({
  t,
  timezone: "Asia/Taipei",
  input: { periodKind, ...DAY, orgIds: orgs.map((org) => org.id) },
  orgs,
  canShowCost: true,
});

const itemsOf = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) => row.item);

describe("營運報表的工作表(Excel 與預覽共用)", () => {
  it("每家店一張 + 合計;合計 = 各店加總,同一個銀行帳戶的期末餘額只算一次", () => {
    const stores = [
      operationsStore("org-zhongshan", 0, DAY),
      operationsStore("org-hsinchu", 1, DAY),
    ];
    const total = totalStoreOf(stores);
    expect(total.sales.net).toEqual({
      count: 211 + 106,
      amount: 42_200 + 21_100,
    });
    expect(total.sales.cost).toBe(38_824 + 19_412);
    expect(total.notes.uncoveredShifts).toBe(3);
    expect(total.notes.openMonths).toEqual(["2026-10"]);
    expect(total.bankAccounts).toHaveLength(1);
    expect(total.bankAccounts[0]?.endingBalance).toBe(1_204_300);
    expect(total.bankAccounts[0]?.types).toEqual([
      expect.objectContaining({ type: "deposit", amount: 20_000 + 10_000 }),
      expect.objectContaining({
        type: "purchase_expense",
        amount: 70_200 + 35_100,
      }),
    ]);

    const sheets = buildOperationsSheets(dataOf(stores), context());
    expect(sheets.branches.map((sheet) => sheet.orgId)).toEqual([
      "org-zhongshan",
      "org-hsinchu",
    ]);
    const netRow = sheets.total.rows.find(
      (row) => row.item === "lotteryReports.operations.items.net",
    );
    expect(netRow).toMatchObject({ count: 317, amount: 63_300 });
    // 毛利 = 淨銷售 − 已售成本
    expect(
      sheets.branches[0]?.rows.find(
        (row) => row.item === "lotteryReports.operations.items.grossProfit",
      ),
    ).toMatchObject({ amount: 42_200 - 38_824 });
    // 撤銷列成負數
    expect(
      sheets.branches[0]?.rows.find(
        (row) => row.item === "lotteryReports.operations.items.undo",
      ),
    ).toMatchObject({ count: -2, amount: -300 });
  });

  it("沒有 show-cost(api 回 null):不放已售成本、毛利、調貨損益;其他成本欄留空", () => {
    const store = operationsStore("org-zhongshan", 0, DAY, { withCost: false });
    const sheets = buildOperationsSheets(dataOf([store]), context());
    const items = itemsOf(sheets.branches[0]?.rows ?? []);
    expect(items).not.toContain("lotteryReports.operations.items.soldCost");
    expect(items).not.toContain("lotteryReports.operations.items.grossProfit");
    expect(items).not.toContain("lotteryReports.operations.items.transferGain");
    expect(
      sheets.branches[0]?.rows.find(
        (row) => row.item === "lotteryReports.operations.items.ending",
      ),
    ).toMatchObject({ count: 1120, amount: null });
  });

  it("對齊日結:有日結的店表頭寫實際期間;沒日結的店與合計表頭標示「未日結,期間改用整天」", () => {
    const stores = [
      operationsStore(
        "org-zhongshan",
        0,
        { from: "2026-10-15T14:05:00.000Z", to: "2026-10-16T14:30:00.000Z" },
        { alignment: "dailyClose" },
      ),
      operationsStore("org-hsinchu", 1, DAY, { alignment: "fullDay" }),
    ];
    const sheets = buildOperationsSheets(dataOf(stores), context());
    expect(sheets.branches[0]?.notes).toEqual([
      `lotteryReports.operations.items.alignedPeriod${JSON.stringify({
        from: "10/15 22:05",
        to: "10/16 22:30",
      })}`,
    ]);
    expect(sheets.branches[1]?.notes).toEqual([
      `lotteryReports.operations.items.fullDayNote${JSON.stringify({
        store: "lotteryReports.operations.items.thisStore",
        date: "10/16",
      })}`,
    ]);
    expect(sheets.total.notes).toEqual([
      `lotteryReports.operations.items.fullDayNote${JSON.stringify({
        store: "新竹店",
        date: "10/16",
      })}`,
    ]);
  });

  it("月報表頭:期間內還有尚未關帳的月份 → 「尚未關帳」", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context("month"),
    );
    expect(sheets.total.notes).toEqual([
      "lotteryReports.operations.items.monthOpen",
    ]);
  });

  it("依遊戲展開與區塊順序:銷售在前、依遊戲展開在最後(預覽卡片佔整列)", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context(),
    );
    const rows = sheets.branches[0]?.rows ?? [];
    expect(rows[0]?.block).toBe("lotteryReports.operations.blocks.sales");
    const games = rows.filter((row) => row.wide === 1);
    expect(games.map((row) => [row.count, row.amount])).toEqual([
      [120, 23_800],
      [60, 5900],
    ]);
    expect(rows.at(-1)?.block).toBe("lotteryReports.operations.blocks.games");
  });
});
