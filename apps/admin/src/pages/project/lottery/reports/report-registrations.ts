import {
  type LotteryOperationsReportQuery,
  type LotteryShiftCheckoutsReportQuery,
  useLotteryOperationsReportQuery,
  useLotteryShiftCheckoutsReportQuery,
} from "@repo/graphql";

import {
  type ReportDefinition,
  registerReport,
} from "@/lib/project/reports/report-registry";

import { OperationsConditionsAddon } from "./operations/OperationsConditionsAddon";
import { OperationsMonthCaption } from "./operations/OperationsMonthCaption";
import { buildOperationsSheets } from "./operations/operations-sheets";
import { CashPointConditionField } from "./shift-checkouts/CashPointConditionField";
import { buildShiftCheckoutsSheets } from "./shift-checkouts/shift-checkouts-sheets";

/**
 * 營運報表(專案規格 11.2;Figma RE-01 / RE-02 / RE-03 / RE-04):分店最多 50 家;日可勾「對齊日結」。
 * 預覽與 Excel 是同一份分段表格(每區塊一張小表;手機每列一張卡片)。範圍限制與 api
 * `project/lottery/reports/report-scope.ts` 的 `OPERATIONS_RANGE` 同一組值。
 */
export const operationsReport = registerReport<LotteryOperationsReportQuery>({
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
  query: useLotteryOperationsReportQuery,
  sheets: buildOperationsSheets,
  ConditionsAddon: OperationsConditionsAddon,
  MonthCaption: OperationsMonthCaption,
});

/**
 * 班次結帳歷史報表(專案規格 11.3;Figma RE-05):分店最多 20 家;條件另有收銀點、只看有差額。
 * 範圍限制與 api 的 `SHIFT_CHECKOUTS_RANGE` 同一組值。
 */
export const shiftCheckoutsReport =
  registerReport<LotteryShiftCheckoutsReportQuery>({
    key: "shift-checkouts",
    name: "lotteryReports.reports.shift-checkouts",
    conditions: {
      period: ["day", "week", "month"],
      orgs: { max: 20 },
      extra: [
        {
          key: "cashPointId",
          type: "custom",
          label: "lotteryReports.extra.cashPoint",
          defaultValue: "",
          Field: CashPointConditionField,
        },
        {
          key: "onlyWithDifference",
          type: "boolean",
          label: "lotteryReports.extra.onlyWithDifference",
        },
      ],
    },
    query: useLotteryShiftCheckoutsReportQuery,
    sheets: buildShiftCheckoutsSheets,
  });

/**
 * 「輸出報表」的報表登記清單(專案規格 18.4;正本 `docs/modules/project/reports.md`「報表登記介面」)。
 * 新報表在這裡加一筆 `registerReport({...})`(`lib/project/reports/report-registry.ts`),
 * 權限 `reports.<報表 key>` 要先在 `apps/db-migrator/seeds/project/reports.ts` 宣告。
 * 清單順序 = 報表選單的順序。
 */
export const REPORT_REGISTRATIONS: readonly ReportDefinition[] = [
  operationsReport,
  shiftCheckoutsReport,
];
