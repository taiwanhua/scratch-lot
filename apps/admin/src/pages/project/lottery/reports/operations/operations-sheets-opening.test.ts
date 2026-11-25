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

const numberedStore = () => operationsStore("org-hsinchu", 1, DAY);

const has = (section: SheetSection, label: string) =>
  section.rows.some((row) => row.item === label);

/** 這一期建了 2 本(在手上 160 張)、更正 3 張、作廢 1 本;10/1 開始建檔。 */
const openingStore = (closedAt: string | null) => {
  const store = operationsStore("org-zhongshan", 0, DAY);
  return {
    ...store,
    inventory: {
      ...store.inventory,
      openingEntryBooks: 2,
      openingEntryVoidBooks: 1,
      openingEntryFixTickets: 3,
      openingEntryTickets: 160,
      openingEntryCost: 29_440,
    },
    notes: {
      ...store.notes,
      openingEntry: {
        __typename: "LotteryOperationsOpeningEntry" as const,
        startedAt: "2026-10-01T02:00:00.000Z",
        closedAt,
      },
    },
  };
};

/** 營運報表的工作表:期初建檔(期初建檔規格 5.1;Excel 與預覽同一份)。 */
describe("營運報表的工作表:期初建檔", () => {
  it("區塊 4:「期初建檔」列放在「進貨」之前,說明「N 本、含更正 N 張、作廢 N 本」;區塊 8 寫建檔期間", () => {
    const sheet = buildOperationsSheets(
      dataOf([openingStore("2026-10-05T10:00:00.000Z")]),
      context(),
    ).branches[0];
    const inventory = sectionOf(sheet, "inventory");
    const labels = inventory.rows.map((row) => row.item);
    expect(labels.indexOf(item("openingEntry"))).toBe(
      labels.indexOf(item("purchase")) - 1,
    );
    expect(rowOf(inventory, item("openingEntry"))).toMatchObject({
      tickets: 160,
      cost: 29_440,
      note: `${item("openingEntryNote")}${JSON.stringify({ books: 2, fix: 3, voided: 1 })}`,
    });
    expect(
      rowOf(sectionOf(sheet, "notes"), item("openingEntryPeriod")).note,
    ).toBe(
      `${item("openingEntryClosed")}${JSON.stringify({ start: "10/1", end: "10/5" })}`,
    );
  });

  it("還沒結束寫「進行中」;沒有建檔、作廢、更正的一期與沒建過的店不放", () => {
    const ongoing = buildOperationsSheets(
      dataOf([openingStore(null)]),
      context(),
    ).branches[0];
    expect(
      rowOf(sectionOf(ongoing, "notes"), item("openingEntryPeriod")).note,
    ).toBe(
      `${item("openingEntryOngoing")}${JSON.stringify({ start: "10/1" })}`,
    );
    const plain = buildOperationsSheets(dataOf([numberedStore()]), context())
      .branches[0];
    expect(has(sectionOf(plain, "inventory"), item("openingEntry"))).toBe(
      false,
    );
    expect(has(sectionOf(plain, "notes"), item("openingEntryPeriod"))).toBe(
      false,
    );
  });
});
