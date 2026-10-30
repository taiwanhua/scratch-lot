import type { GraphQLClient } from "@repo/graphql";

import {
  type ReportDefinition,
  type ReportQueryVariables,
  registerReport,
} from "@/lib/base/reports/report-registry";

/**
 * 輸出報表外框的測試夾具:兩張測試報表(底座登記清單由測試檔換成這一份)。查詢走真的 GraphQL client
 * 打 MSW(操作名 `FixtureReport`),錯誤碼的解讀因此與正式報表同一條路。
 * 名稱借用底座既有的訊息 key(測試報表沒有自己的文案)。
 */

/** 只給測試夾具用的查詢文件(正式報表一律用 codegen 的 hook,DATA-01)。 */
const FIXTURE_REPORT_DOCUMENT = /* GraphQL */ `
  query FixtureReport($input: JSONObject!) {
    fixtureReport(input: $input)
  }
`;

interface FixtureReportData {
  fixtureReport: { orgId: string; amount: number }[];
}

const fixtureQuery = {
  getKey: (variables: ReportQueryVariables) => ["FixtureReport", variables],
  fetcher: (client: GraphQLClient, variables: ReportQueryVariables) => () =>
    client.request<FixtureReportData>(FIXTURE_REPORT_DOCUMENT, variables),
};

const sheetOf = (rows: { amount: number }[]) => ({
  columns: [
    { key: "item", header: "項目" },
    { key: "amount", header: "金額", align: "right" as const },
  ],
  rows: rows.map((row) => ({ item: "示範項目", amount: row.amount })),
});

/** 第一張:日 / 週 / 月,組織最多 50 個。 */
export const summaryFixture = registerReport<FixtureReportData>({
  key: "demo-summary",
  name: "userManager.tableLabel",
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [],
  },
  query: fixtureQuery,
  sheets: (data) => ({
    total: {
      ...sheetOf([
        {
          amount: data.fixtureReport.reduce((sum, row) => sum + row.amount, 0),
        },
      ]),
      notes: ["合計說明"],
    },
    branches: data.fixtureReport.map((row) => ({
      ...sheetOf([row]),
      orgId: row.orgId,
    })),
  }),
});

/** 第二張:只有日,組織最多 20 個。 */
export const dailyFixture = registerReport<FixtureReportData>({
  ...summaryFixture,
  key: "demo-daily",
  name: "roleManager.listTitle",
  conditions: { period: ["day"], orgs: { max: 20 }, extra: [] },
});

export const FIXTURE_REPORTS: readonly ReportDefinition[] = [
  summaryFixture,
  dailyFixture,
];

/** 兩張測試報表的權限(`reports.<報表 key>`)。 */
export const SUMMARY_PERMISSION = "reports.demo-summary";
export const DAILY_PERMISSION = "reports.demo-daily";

/** 網址的 `conditions`:台北 2026-10-16 這一天、兩個組織。 */
export const DAY_WITH_TWO_ORGS = `?conditions=${encodeURIComponent(
  JSON.stringify({
    period: { kind: "day", date: "2026-10-16" },
    orgIds: ["org-north", "org-south"],
    extra: {},
  }),
)}`;
