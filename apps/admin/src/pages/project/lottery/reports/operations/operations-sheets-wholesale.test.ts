import { describe, expect, it } from "@jest/globals";

import type { LotteryOperationsReportQuery } from "@repo/graphql";

import {
  SHEET_ROW_KEYS,
  type SheetData,
  type SheetSection,
} from "@/lib/base/reports/excel";
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
    [row.item, row.game, row.type, row.customer].includes(label),
  );
  if (found === undefined) throw new Error(`missing row ${label}`);
  return found;
};

/** 營運報表的工作表:2b 批售與各區塊加的列(專案規格 21.7;數字同 21.9 驗算 #8)。 */
describe("營運報表的工作表:批售", () => {
  it("2b 批售(驗算 #8 的數字):依客戶(獲利 800、獲利率 2.2%)、逐單、期末已收未出貨;區塊 4 期末批售中;合計與分店比較", () => {
    const stores = [
      operationsStore("org-zhongshan", 0, DAY),
      operationsStore("org-hsinchu", 1, DAY),
    ];
    const sheets = buildOperationsSheets(dataOf(stores), context());
    const customers = sectionOf(sheets.branches[0], "wholesale");
    expect(customers.columns.map((column) => column.key)).toEqual([
      "customer",
      "documents",
      "books",
      "tickets",
      "amount",
      "cost",
      "profit",
      "rate",
    ]);
    expect(rowOf(customers, item("total"))).toMatchObject({
      documents: 1,
      books: 2,
      tickets: 200,
      amount: 37_200,
      cost: 36_400,
      profit: 800,
      [SHEET_ROW_KEYS.emphasis]: "total",
    });
    expect(Number(rowOf(customers, item("total")).rate)).toBeCloseTo(
      800 / 37_200,
    );
    const documents = sectionOf(sheets.branches[0], "wholesaleDocuments");
    expect(documents.rows).toEqual([
      expect.objectContaining({
        serialNo: "W-0001",
        at: "10/16 10:45",
        customer: "好運彩券行",
        books: 2,
        amount: 37_200,
        cost: 36_400,
        profit: 800,
        paymentMode: "lotteryPurchasing.wholesale.paymentModes.collect_first",
        received: 37_200,
        toReceive: 0,
      }),
    ]);
    const info = sectionOf(sheets.branches[0], "wholesaleInfo");
    expect(rowOf(info, item("receivedUnshipped"))).toMatchObject({
      count: 1,
      amount: 20_000,
      note: "W-0002",
    });
    const inventoryInfo = sectionOf(sheets.branches[0], "inventoryInfo");
    expect(rowOf(inventoryInfo, item("pendingAtEnd"))).toMatchObject({
      tickets: 100,
      amount: 18_600,
      note: `${item("pendingAtEndNote")}${JSON.stringify({ books: 1, list: "W-0003" })}`,
    });

    // 沒有批售的店:只印「本期沒有批售」一列、沒有逐單;期末已收未出貨照樣印 0
    const none = sectionOf(sheets.branches[1], "wholesale");
    expect(none.rows).toEqual([
      expect.objectContaining({ customer: item("wholesaleNone") }),
    ]);
    expect(
      sheets.branches[1]?.sections?.map((section) => section.title),
    ).not.toContain(block("wholesaleDocuments"));
    expect(
      rowOf(
        sectionOf(sheets.branches[1], "wholesaleInfo"),
        item("receivedUnshipped"),
      ),
    ).toMatchObject({ count: 0, amount: 0, note: null });

    // 合計:各店相加、依客戶合併;分店比較加批售金額、批售獲利
    expect(
      rowOf(sectionOf(sheets.total, "wholesale"), "好運彩券行"),
    ).toMatchObject({ documents: 1, amount: 37_200, profit: 800 });
    const compare = sectionOf(sheets.extras?.[0], "compare");
    expect(
      rowOf(compare, "lotteryReports.operations.compare.wholesaleAmount"),
    ).toMatchObject({ store0: 37_200, store1: 0, total: 37_200 });
    expect(
      rowOf(compare, "lotteryReports.operations.compare.wholesaleProfit"),
    ).toMatchObject({ store0: 800, store1: 0, total: 800 });
  });

  it("分店比較的待收 / 待付含待收批售款與批售待退", () => {
    const withWholesale = (
      store: ReturnType<typeof operationsStore>,
      amounts: Partial<Record<string, number>>,
    ) => ({
      ...store,
      outstanding: {
        ...store.outstanding,
        items: store.outstanding.items.map((entry) => {
          const amount = amounts[entry.kind];
          return amount === undefined ? entry : { ...entry, count: 1, amount };
        }),
      },
    });
    const zhongshan = operationsStore("org-zhongshan", 0, DAY);
    const sheets = buildOperationsSheets(
      dataOf([
        withWholesale(zhongshan, {
          wholesaleToReceive: 19_000,
          wholesaleToRefund: 500,
        }),
        operationsStore("org-hsinchu", 1, DAY),
      ]),
      context(),
    );
    const compare = sectionOf(sheets.extras?.[0], "compare");
    const transferToReceive =
      zhongshan.outstanding.items.find(
        (entry) => entry.kind === "transferToReceive",
      )?.amount ?? 0;
    expect(
      rowOf(compare, "lotteryReports.operations.compare.toReceive"),
    ).toMatchObject({ store0: transferToReceive + 19_000 });
    expect(
      rowOf(compare, "lotteryReports.operations.compare.toPay"),
    ).toMatchObject({ store0: 500 });
  });

  it("2b 沒有 show-cost:沒有原成本 / 獲利 / 獲利率欄,批售金額照常;期末批售中的批售金額寫在說明", () => {
    const store = operationsStore("org-zhongshan", 0, DAY, { withCost: false });
    const sheets = buildOperationsSheets(dataOf([store]), context());
    const customers = sectionOf(sheets.branches[0], "wholesale");
    expect(customers.columns.map((column) => column.key)).toEqual([
      "customer",
      "documents",
      "books",
      "tickets",
      "amount",
    ]);
    expect(rowOf(customers, "好運彩券行")).toMatchObject({ amount: 37_200 });
    const documents = sectionOf(sheets.branches[0], "wholesaleDocuments");
    expect(documents.columns.map((column) => column.key)).not.toContain("cost");
    const inventoryInfo = sectionOf(sheets.branches[0], "inventoryInfo");
    expect(rowOf(inventoryInfo, item("pendingAtEnd"))).toMatchObject({
      tickets: 100,
      note: `${item("pendingAtEndNoteNoCost")}${JSON.stringify({ books: 1, amount: "18,600", list: "W-0003" })}`,
    });
  });

  it("2b 作廢列:單號標「(作廢)」、數字是負數", () => {
    const store = operationsStore("org-zhongshan", 0, DAY);
    const document = store.wholesale.documents.at(0);
    if (document === undefined) throw new Error("fixture has no document");
    const voided = {
      ...store,
      wholesale: {
        ...store.wholesale,
        documents: [
          {
            ...document,
            voided: true,
            books: -2,
            tickets: -200,
            amount: -37_200,
            cost: -36_400,
            receivedAtEnd: 0,
          },
        ],
      },
    };
    const sheets = buildOperationsSheets(dataOf([voided]), context());
    expect(
      sectionOf(sheets.branches[0], "wholesaleDocuments").rows[0],
    ).toMatchObject({
      serialNo: `${item("wholesaleVoided")}${JSON.stringify({ serialNo: "W-0001" })}`,
      amount: -37_200,
      profit: -800,
    });
  });
});
