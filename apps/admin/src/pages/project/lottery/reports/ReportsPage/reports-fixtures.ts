import type { GraphQLClient } from "@repo/graphql";

import {
  type ReportDefinition,
  type ReportQueryVariables,
  registerReport,
} from "@/lib/project/reports/report-registry";

/**
 * 輸出報表外框的測試夾具:本票不登記正式報表,用兩張測試報表(key 借用 seed 已有的
 * `operations` / `shift-checkouts`,權限因此與正式一致)驗外框。查詢走真的 GraphQL client 打 MSW
 * (操作名 `FixtureReport`),錯誤碼的解讀因此與正式報表同一條路。
 */

/** 只給測試夾具用的查詢文件(正式報表一律用 codegen 的 hook,DATA-01)。 */
const FIXTURE_REPORT_DOCUMENT = /* GraphQL */ `
  query FixtureReport($input: JSONObject!) {
    fixtureReport(input: $input)
  }
`;

interface FixtureReportData {
  fixtureReport: { orgId: string; sales: number }[];
}

const fixtureQuery = {
  getKey: (variables: ReportQueryVariables) => ["FixtureReport", variables],
  fetcher: (client: GraphQLClient, variables: ReportQueryVariables) => () =>
    client.request<FixtureReportData>(FIXTURE_REPORT_DOCUMENT, variables),
};

const sheetOf = (rows: { sales: number }[]) => ({
  columns: [
    { key: "item", header: "項目" },
    { key: "amount", header: "金額", align: "right" as const },
  ],
  rows: rows.map((row) => ({ item: "淨銷售", amount: row.sales })),
});

export const operationsFixture = registerReport<FixtureReportData>({
  key: "operations",
  name: "lotteryReports.reports.operations",
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [],
  },
  query: fixtureQuery,
  sheets: (data) => ({
    total: {
      ...sheetOf([
        { sales: data.fixtureReport.reduce((sum, row) => sum + row.sales, 0) },
      ]),
      notes: ["合計說明"],
    },
    branches: data.fixtureReport.map((row) => ({
      ...sheetOf([row]),
      orgId: row.orgId,
    })),
  }),
});

export const shiftCheckoutsFixture = registerReport<FixtureReportData>({
  ...operationsFixture,
  key: "shift-checkouts",
  name: "lotteryReports.reports.shift-checkouts",
  conditions: { period: ["day"], orgs: { max: 20 }, extra: [] },
});

export const FIXTURE_REPORTS: readonly ReportDefinition[] = [
  operationsFixture,
  shiftCheckoutsFixture,
];

/** 網址的 `conditions`:台北 2026-10-16 這一天、兩家分店。 */
export const DAY_WITH_TWO_BRANCHES = `?conditions=${encodeURIComponent(
  JSON.stringify({
    period: { kind: "day", date: "2026-10-16" },
    orgIds: ["org-zhongshan", "org-hsinchu"],
    extra: {},
  }),
)}`;
