import type { ReportDefinition } from "@/lib/base/reports/report-registry";
import {
  operationsReport,
  shiftCheckoutsReport,
} from "@/pages/project/lottery/reports/report-registrations";

/**
 * 專案登記的報表(底座「輸出報表」頁的登記清單;`docs/modules/reports.md`「報表登記介面」,
 * 各報表的內容見 `docs/modules/project/reports.md`)。新報表在
 * `pages/project/lottery/reports/report-registrations.ts` 用 `registerReport({...})` 宣告後加進這裡,
 * 權限 `reports.<報表 key>` 要先在 `apps/db-migrator/seeds/project/reports.ts` 宣告。
 * 清單順序 = 報表選單的順序(排在底座登記的後面)。
 */
export const projectReports: readonly ReportDefinition[] = [
  operationsReport,
  shiftCheckoutsReport,
];
