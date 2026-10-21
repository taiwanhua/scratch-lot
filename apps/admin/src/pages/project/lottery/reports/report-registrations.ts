import type { ReportDefinition } from "@/lib/project/reports/report-registry";

/**
 * 「輸出報表」的報表登記清單(專案規格 18.4;正本 `docs/modules/project/reports.md`「報表登記介面」)。
 * 新報表在這裡加一筆 `registerReport({...})`(`lib/project/reports/report-registry.ts`),
 * 權限 `reports.<報表 key>` 要先在 `apps/db-migrator/seeds/project/reports.ts` 宣告。
 * 清單順序 = 報表選單的順序。營運報表、班次結帳歷史報表由各自的功能登記。
 */
export const REPORT_REGISTRATIONS: readonly ReportDefinition[] = [];
