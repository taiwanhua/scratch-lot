import { describe, expect, it } from "@jest/globals";

import type { LotteryOperationsReportQuery } from "@repo/graphql";

import {
  SHEET_ROW_KEYS,
  type SheetData,
  type SheetSection,
} from "@/lib/project/reports/excel";
import type { ReportSheetBody } from "@/lib/project/reports/report-registry";
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
  generatedAt: new Date("2026-10-17T01:12:00.000Z"),
  generatedBy: "王店長",
});

const block = (key: string) => `lotteryReports.operations.blocks.${key}`;
const item = (key: string) => `lotteryReports.operations.items.${key}`;

const sectionOf = (
  sheet: ReportSheetBody | SheetData | undefined,
  key: string,
): SheetSection => {
  const found = sheet?.sections?.find(
    (section) => section.title === block(key),
  );
  if (found === undefined) throw new Error(`missing section ${key}`);
  return found;
};

const rowOf = (section: SheetSection, label: string) => {
  const found = section.rows.find((row) =>
    [row.item, row.game, row.type].includes(label),
  );
  if (found === undefined) throw new Error(`missing row ${label}`);
  return found;
};

describe("營運報表的工作表(Excel 與預覽共用的分段表格)", () => {
  it("每家店一張 + 合計 + 分店比較;合計 = 各店加總,銀行期末餘額取期末最晚那家店的", () => {
    const stores = [
      operationsStore("org-zhongshan", 0, DAY),
      operationsStore("org-hsinchu", 1, {
        ...DAY,
        to: "2026-10-16T17:00:00.000Z",
      }),
    ];
    const total = totalStoreOf(stores);
    expect(total.sales.net).toEqual({
      count: 211 + 106,
      amount: 42_200 + 21_100,
    });
    expect(total.bankAccounts).toHaveLength(1);
    // 新竹店的期末較晚 → 取新竹店算的期末餘額
    expect(total.bankAccounts[0]?.endingBalance).toBe(1_204_301);
    expect(total.bankAccounts[0]?.types).toEqual([
      expect.objectContaining({ type: "deposit", inAmount: 30_000 }),
      expect.objectContaining({
        type: "purchase_expense",
        outAmount: 70_200 + 35_100,
        reversalCount: 1,
      }),
    ]);
    // 待查的本依本去重複(兩家店都是 book-1、book-2),張數照加
    expect(total.inventory.investigatingBooks).toBe(2);
    expect(total.inventory.investigatingTickets).toBe(6);

    const sheets = buildOperationsSheets(dataOf(stores), context());
    expect(sheets.branches.map((sheet) => sheet.orgId)).toEqual([
      "org-zhongshan",
      "org-hsinchu",
    ]);
    expect(rowOf(sectionOf(sheets.total, "sales"), item("net"))).toMatchObject({
      tickets: 317,
      amount: 63_300,
    });
    // 分店比較:項目 × 分店 + 合計
    const compare = sectionOf(sheets.extras?.[0], "compare");
    expect(compare.columns.map((column) => column.header)).toEqual([
      "lotteryReports.operations.columns.item",
      "中山店",
      "新竹店",
      "lotteryReports.operations.columns.total",
    ]);
    expect(
      rowOf(compare, "lotteryReports.operations.compare.netSales"),
    ).toMatchObject({ store0: 42_200, store1: 21_100, total: 63_300 });
  });

  it("工作表前三列:報表名稱 · 分店、期間 · 日報 · 關帳狀態、產出時間與產出人", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context(),
    );
    expect(sheets.branches[0]?.notes).toEqual([
      `lotteryReports.operations.sheet.title${JSON.stringify({ store: "中山店" })}`,
      [
        `lotteryReports.operations.sheet.period${JSON.stringify({
          from: "2026-10-16 00:00",
          to: "2026-10-17 00:00",
        })}`,
        "lotteryReports.operations.sheet.kinds.day",
        item("monthOpen"),
      ].join(" · "),
      `lotteryReports.operations.sheet.generated${JSON.stringify({
        at: "2026-10-17 09:12",
        by: "王店長",
      })}`,
    ]);
    // 只有一家店 → 沒有分店比較
    expect(sheets.extras).toEqual([]);
  });

  it("區塊順序:1 銷售 → 依遊戲 → 2 毛利 → 3 → 4(+ 另外列的)→ 5a → 5b → 6 → 7 → 8", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context(),
    );
    expect(
      sheets.branches[0]?.sections?.map((section) => section.title),
    ).toEqual(
      [
        "sales",
        "games",
        "profit",
        "redemption",
        "inventory",
        "inventoryInfo",
        "cashDifference",
        "cashMovement",
        "bank",
        "outstanding",
        "notes",
      ].map((key) => block(key)),
    );
  });

  it("4 庫存異動:期初加減到期末、− 的列是負數,核對 0 = 對得上;調出說明寫調貨金額", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context(),
    );
    const inventory = sectionOf(sheets.branches[0], "inventory");
    expect(inventory.rows.map((row) => row.item)).toEqual(
      [
        "opening",
        "purchase",
        "transferIn",
        "transferOut",
        "sales",
        "scrap",
        "newInvestigating",
        "investigateRecovered",
        "lostRecovered",
        "pendingAdjust",
        "ending",
        "check",
      ].map((key) => item(key)),
    );
    expect(rowOf(inventory, item("transferOut"))).toMatchObject({
      tickets: -100,
      cost: -18_400,
      note: `${item("transferAmount")}${JSON.stringify({ amount: "19,000" })}`,
    });
    expect(rowOf(inventory, item("ending"))).toMatchObject({
      tickets: 1485,
      cost: 273_240,
      [SHEET_ROW_KEYS.emphasis]: "total",
    });
    expect(rowOf(inventory, item("check"))).toMatchObject({
      tickets: 0,
      cost: 0,
      note: item("checkOk"),
    });
  });

  it("2 毛利:毛利 = 淨銷售 − 已售成本、毛利率 = 毛利 ÷ 淨銷售(比率列);依遊戲也有毛利率欄", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context(),
    );
    const profit = sectionOf(sheets.branches[0], "profit");
    expect(rowOf(profit, item("grossProfit"))).toMatchObject({
      amount: 42_200 - 38_824,
    });
    const margin = rowOf(profit, item("margin"));
    expect(margin[SHEET_ROW_KEYS.format]).toBe("percent");
    expect(margin.amount).toBeCloseTo((42_200 - 38_824) / 42_200);
    const games = sectionOf(sheets.branches[0], "games");
    const game = rowOf(
      games,
      `${item("game")}${JSON.stringify({ code: "5164", name: "發大財" })}`,
    );
    expect(game).toMatchObject({
      sold: 121,
      undone: -1,
      netTickets: 120,
      netAmount: 23_800,
      soldCost: 22_000,
      grossProfit: 1800,
    });
    expect(game.margin).toBeCloseTo(1800 / 23_800);
    expect(rowOf(games, item("total"))).toMatchObject({
      sold: 182,
      netAmount: 29_700,
      [SHEET_ROW_KEYS.emphasis]: "total",
    });
  });

  it("沒有 show-cost(api 回 null):沒有毛利區塊、沒有成本欄 / 毛利欄 / 調貨損益,張數照列", () => {
    const store = operationsStore("org-zhongshan", 0, DAY, { withCost: false });
    const sheets = buildOperationsSheets(dataOf([store]), context());
    const titles = sheets.branches[0]?.sections?.map(
      (section) => section.title,
    );
    expect(titles).not.toContain(block("profit"));
    const inventory = sectionOf(sheets.branches[0], "inventory");
    expect(inventory.columns.map((column) => column.key)).toEqual([
      "item",
      "tickets",
      "note",
    ]);
    expect(rowOf(inventory, item("transferOut"))).toMatchObject({
      tickets: -100,
      note: null,
    });
    const info = sectionOf(sheets.branches[0], "inventoryInfo");
    expect(info.rows.map((row) => row.item)).not.toContain(
      item("transferGain"),
    );
    const games = sectionOf(sheets.branches[0], "games");
    expect(games.columns.map((column) => column.key)).not.toContain("soldCost");
  });

  it("5b 現金移動:抽屜 / 小金庫兩欄 + 合計;6 銀行同類型一列(收、支、淨額,含沖正);7 未結清列單號", () => {
    const sheets = buildOperationsSheets(
      dataOf([
        operationsStore("org-zhongshan", 0, DAY),
        operationsStore("org-hsinchu", 1, DAY),
      ]),
      context(),
    );
    const movement = sectionOf(sheets.branches[0], "cashMovement");
    expect(
      rowOf(movement, "lotteryReports.operations.movements.deposit"),
    ).toMatchObject({ count: 3, drawer: -12_000, vault: 12_000 });
    expect(rowOf(movement, item("movementTotal"))).toMatchObject({
      count: 7,
      drawer: -12_000 + 5000 - 200 + 100,
      vault: 12_000 - 5000 - 20_000,
    });
    const bank = sectionOf(sheets.branches[1], "bank");
    expect(
      rowOf(bank, "lotteryReports.operations.bankTypes.purchase_expense"),
    ).toMatchObject({
      in: null,
      out: -35_100,
      net: -35_100,
      note: `${item("reversals")}${JSON.stringify({ count: 1 })}`,
    });
    const outstanding = sectionOf(sheets.branches[0], "outstanding");
    expect(
      rowOf(
        outstanding,
        "lotteryReports.operations.outstanding.transferToReceive",
      ),
    ).toMatchObject({ count: 1, amount: 19_504, note: "T-0003" });
    expect(outstanding.rows).toHaveLength(6);
  });

  it("對齊日結:有日結的店第二列寫實際期間;沒日結的店與合計標示「未日結,期間改用整天」", () => {
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
    expect(sheets.branches[0]?.notes?.[1]).toContain(
      `${item("alignedPeriod")}${JSON.stringify({
        from: "10/15 22:05",
        to: "10/16 22:30",
      })}`,
    );
    expect(sheets.branches[1]?.notes?.[1]).toContain(
      `${item("fullDayNote")}${JSON.stringify({
        store: item("thisStore"),
        date: "10/16",
      })}`,
    );
    expect(sheets.total.notes?.[1]).toContain(
      `${item("fullDayNote")}${JSON.stringify({
        store: "新竹店",
        date: "10/16",
      })}`,
    );
  });

  it("月報:期間內還有尚未關帳的月份 → 第二列寫「尚未關帳」", () => {
    const sheets = buildOperationsSheets(
      dataOf([operationsStore("org-zhongshan", 0, DAY)]),
      context("month"),
    );
    expect(sheets.total.notes?.[1]).toContain(
      "lotteryReports.operations.sheet.kinds.month",
    );
    expect(sheets.total.notes?.[1]).toContain(item("monthOpen"));
  });
});
