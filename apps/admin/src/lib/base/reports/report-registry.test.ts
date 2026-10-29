import { describe, expect, it } from "@jest/globals";

import { buildWorkbook } from "./excel";
import {
  type ReportDefinition,
  composeReports,
  extraConditionsFor,
  registerReport,
  reportSheetsOf,
} from "./report-registry";

const resolveFixture = () => Promise.resolve({ total: 1 });
const fetchFixture = () => resolveFixture;

const base: ReportDefinition<{ total: number }> = {
  key: "summary",
  name: "userManager.tableLabel",
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [
      {
        key: "onlyOverdue",
        type: "boolean",
        label: "x",
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
    ["key 不是 kebab-case", { ...base, key: "Summary" }],
    ["沒有期間", { ...base, conditions: { ...base.conditions, period: [] } }],
    [
      "期間重複",
      {
        ...base,
        conditions: { ...base.conditions, period: ["day", "day"] as const },
      },
    ],
    [
      "組織上限不是正整數",
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
            { key: "category", type: "select", label: "x", options: [] },
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
    ).toEqual(["onlyOverdue"]);
    expect(extraConditionsFor(base.conditions, "week")).toEqual([]);
  });
});

describe("reportSheetsOf → Excel", () => {
  it("2 個組織 → 3 個工作表:合計在前,各組織照選擇器順序、用組織名", async () => {
    const body = {
      columns: [{ key: "item", header: "項目" }],
      rows: [{ item: "示範項目" }],
    };
    const sheets = reportSheetsOf(
      {
        total: body,
        branches: [
          { ...body, orgId: "org-south" },
          { ...body, orgId: "org-north" },
        ],
      },
      [
        { id: "org-north", name: "北區" },
        { id: "org-south", name: "南區" },
      ],
      "全部組織合計",
    );
    const workbook = await buildWorkbook({ sheets });
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "全部組織合計",
      "北區",
      "南區",
    ]);
  });
});

describe("composeReports(底座 + 專案的登記清單)", () => {
  const other = { ...base, key: "detail" };

  it("底座在前、專案在後,順序即選單順序", () => {
    expect(composeReports([base], [other]).map((report) => report.key)).toEqual(
      ["summary", "detail"],
    );
    expect(composeReports([], [])).toEqual([]);
  });

  it.each([
    ["兩方登記同一個 key", [base], [base]],
    ["同一方登記兩次", [], [other, other]],
  ] as const)("%s:載入就丟錯", (_label, baseReports, projectReports) => {
    expect(() => composeReports(baseReports, projectReports)).toThrow(
      /registered twice/,
    );
  });
});
