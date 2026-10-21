import { describe, expect, it } from "@jest/globals";

import { buildWorkbook } from "./excel";
import {
  type ReportDefinition,
  extraConditionsFor,
  registerReport,
  reportSheetsOf,
} from "./report-registry";

const resolveFixture = () => Promise.resolve({ total: 1 });
const fetchFixture = () => resolveFixture;

const base: ReportDefinition<{ total: number }> = {
  key: "operations",
  name: "lotteryReports.reports.operations",
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [
      {
        key: "alignDailyClose",
        type: "boolean",
        label: "lotteryReports.extra.alignDailyClose",
        only: "day",
      },
    ],
  },
  query: {
    getKey: (variables) => ["Fixture", variables],
    fetcher: fetchFixture,
  },
  sheets: () => ({ total: { columns: [], rows: [] }, branches: [] }),
};

describe("registerReport", () => {
  it("宣告合格:原樣回傳", () => {
    expect(registerReport(base)).toBe(base);
  });

  it.each([
    ["key 不是 kebab-case", { ...base, key: "Operations" }],
    ["沒有期間", { ...base, conditions: { ...base.conditions, period: [] } }],
    [
      "期間重複",
      {
        ...base,
        conditions: { ...base.conditions, period: ["day", "day"] as const },
      },
    ],
    [
      "分店上限不是正整數",
      { ...base, conditions: { ...base.conditions, orgs: { max: 0 } } },
    ],
    [
      "其他條件撞到查詢欄位",
      {
        ...base,
        conditions: {
          ...base.conditions,
          extra: [{ key: "orgIds", type: "boolean", label: "x" }] as const,
        },
      },
    ],
    [
      "only 指到這張報表沒有的期間",
      {
        ...base,
        conditions: {
          ...base.conditions,
          period: ["week"] as const,
        },
      },
    ],
    [
      "下拉沒有選項",
      {
        ...base,
        conditions: {
          ...base.conditions,
          extra: [
            { key: "cashPoint", type: "select", label: "x", options: [] },
          ] as const,
        },
      },
    ],
  ])("宣告寫錯在登記時就丟錯:%s", (_label, def) => {
    expect(() => registerReport(def)).toThrow(/registerReport/);
  });

  it("extraConditionsFor:`only` 的條件只在那種期間出現", () => {
    expect(
      extraConditionsFor(base.conditions, "day").map(({ key }) => key),
    ).toEqual(["alignDailyClose"]);
    expect(extraConditionsFor(base.conditions, "week")).toEqual([]);
  });
});

describe("reportSheetsOf → Excel", () => {
  it("2 家分店 → 3 個工作表:合計在前,分店照選擇器順序、用分店名", async () => {
    const body = {
      columns: [{ key: "item", header: "項目" }],
      rows: [{ item: "淨銷售" }],
    };
    const sheets = reportSheetsOf(
      {
        total: body,
        branches: [
          { ...body, orgId: "org-hsinchu" },
          { ...body, orgId: "org-zhongshan" },
        ],
      },
      [
        { id: "org-zhongshan", name: "中山店" },
        { id: "org-hsinchu", name: "新竹店" },
      ],
      "全部分店合計",
    );
    const workbook = await buildWorkbook({ sheets });
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "全部分店合計",
      "中山店",
      "新竹店",
    ]);
  });
});
