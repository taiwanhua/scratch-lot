import type { ReportDefinition } from "@/lib/base/reports/report-registry";

/**
 * 底座登記的報表(`docs/modules/reports.md`「報表登記介面」);目前底座沒有。
 * 專案的登記在 `app/project/reports.ts`,兩份由 `app/module-pages.tsx` 的 `composeReports` 合成。
 */
export const baseReports: readonly ReportDefinition[] = [];
