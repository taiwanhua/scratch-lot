import { describe, expect, it } from "@jest/globals";

import type { LotteryOperationsReportQuery } from "@repo/graphql";

import { type SheetData, type SheetSection } from "@/lib/base/reports/excel";
import type { ReportSheetBody } from "@/lib/base/reports/report-registry";
import { operationsStore } from "@/test/msw/project/lottery/reports-handlers";

import { buildOperationsSheets } from "./operations-sheets";

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

const countStore = () =>
  operationsStore("org-zhongshan", 0, DAY, { countStore: true });
const numberedStore = () => operationsStore("org-hsinchu", 1, DAY);
const has = (section: SheetSection, label: string) =>
  section.rows.some((row) => row.item === label);

/** 營運報表的工作表:張數店(張數店規格 11.4、13.2;Figma CS-40a / CS-40b;Excel 與預覽同一份)。 */
describe("營運報表的工作表:張數店", () => {
  it("張數店工作表:1 銷售多「依張數標記售出」、2 毛利(估算)與說明、4 撤銷報廢與對號成本調整(張數留空)、期末待查寫系統預設帶入;表頭加「含估算」", () => {
    const sheets = buildOperationsSheets(dataOf([countStore()]), context());
    const sheet = sheets.branches[0];
    expect(rowOf(sectionOf(sheet, "sales"), item("countSale"))).toMatchObject({
      tickets: 5,
      amount: 900,
    });
    const profit = sheet.sections?.find(
      (section) => section.title === block("profitEstimated"),
    );
    expect(profit?.description).toBe(
      "lotteryReports.operations.descriptions.estimatedlotteryReports.operations.descriptions.profit",
    );
    const games = sectionOf(sheet, "games");
    expect(games.description).toBe(
      "lotteryReports.operations.descriptions.gamesCount",
    );
    const inventory = sectionOf(sheet, "inventory");
    expect(rowOf(inventory, item("scrapUndo"))).toMatchObject({
      tickets: 1,
      cost: 184,
    });
    const match = rowOf(inventory, item("matchCostAdjust"));
    expect(match.cost).toBe(-16);
    // 張數留空
    expect(match.tickets ?? null).toBeNull();
    expect(
      rowOf(sectionOf(sheet, "inventoryInfo"), item("investigating")).note,
    ).toBe(
      `${item("investigatingUnmatched")}${JSON.stringify({ count: 2, unmatched: 1 })}`,
    );
    expect(sheet.notes?.[1]?.split(" · ").at(-1)).toBe(item("estimated"));
  });

  it("區塊 8:盤點制度(從什麼時候起)、補點編號次數與日期、距上次補點編號;月底未補點編號日報寫「月報才判斷」、月報列月份", () => {
    const day = sectionOf(
      buildOperationsSheets(dataOf([countStore()]), context()).branches[0],
      "notes",
    );
    expect(rowOf(day, item("countMode")).note).toBe(
      `${item("countModeSince")}${JSON.stringify({
        mode: "lotteryReports.operations.countModes.count",
        date: "10/1",
      })}`,
    );
    expect(rowOf(day, item("renumberCount"))).toMatchObject({
      quantity: 1,
      note: "10/5",
    });
    expect(rowOf(day, item("daysSinceRenumber"))).toMatchObject({
      quantity: 11,
    });
    expect(rowOf(day, item("monthEndUnrenumbered"))).toMatchObject({
      quantity: null,
      note: item("monthEndRenumberMonthOnly"),
    });

    const store = countStore();
    if (store.notes.countMode == null) {
      throw new Error("count store fixture has no countMode");
    }
    store.notes.countMode = {
      ...store.notes.countMode,
      changes: [
        {
          __typename: "LotteryOperationsCountModeChange",
          at: "2026-10-15T02:00:00.000Z",
          from: "count",
          to: "converting",
        },
      ],
      monthEndUnrenumbered: ["2026-10"],
    };
    const month = sectionOf(
      buildOperationsSheets(dataOf([store]), context("month")).branches[0],
      "notes",
    );
    expect(rowOf(month, item("countMode")).note).toBe(
      `${item("countModeChange")}${JSON.stringify({
        date: "10/15",
        from: "lotteryReports.operations.countModeShort.count",
        to: "lotteryReports.operations.countModeShort.converting",
      })}`,
    );
    expect(rowOf(month, item("monthEndUnrenumbered"))).toMatchObject({
      quantity: 1,
      note: "2026-10",
    });
  });

  it("分店比較:張數店名「(張數)· 估算」、編號店名不變;合計含估算、依張數標記售出照加", () => {
    const sheets = buildOperationsSheets(
      dataOf([countStore(), numberedStore()]),
      context(),
    );
    const compare = sectionOf(sheets.extras?.[0], "compare");
    expect(compare.columns.map((column) => column.header)).toEqual([
      "lotteryReports.operations.columns.item",
      `lotteryReports.operations.compare.countEstimatedName${JSON.stringify({ name: "中山店" })}`,
      "新竹店",
      "lotteryReports.operations.columns.total",
    ]);
    expect(sheets.total.notes?.[1]).toContain(item("estimated"));
    expect(
      rowOf(sectionOf(sheets.total, "sales"), item("countSale")),
    ).toMatchObject({ tickets: 5, amount: 900 });
    // 盤點制度是一家店的事:合計不列
    expect(has(sectionOf(sheets.total, "notes"), item("countMode"))).toBe(
      false,
    );
  });

  it("編號店工作表不變:沒有依張數標記售出、撤銷報廢、對號成本調整、盤點制度列,毛利標題不加估算,表頭不加含估算", () => {
    const sheet = buildOperationsSheets(dataOf([numberedStore()]), context())
      .branches[0];
    expect(has(sectionOf(sheet, "sales"), item("countSale"))).toBe(false);
    expect(has(sectionOf(sheet, "inventory"), item("scrapUndo"))).toBe(false);
    expect(has(sectionOf(sheet, "inventory"), item("matchCostAdjust"))).toBe(
      false,
    );
    expect(has(sectionOf(sheet, "notes"), item("countMode"))).toBe(false);
    expect(sectionOf(sheet, "profit").title).toBe(block("profit"));
    expect(sheet.notes?.[1]).not.toContain(item("estimated"));
  });
});
