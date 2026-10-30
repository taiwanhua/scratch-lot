import { createContext, useContext } from "react";

import type { ReportDefinition } from "@/lib/base/reports/report-registry";

/**
 * 輸出報表的登記清單(`docs/modules/reports.md`「報表登記介面」):底座與專案的登記由
 * `app/module-pages.tsx` 以 `composeReports` 合成,`app/providers/ReportRegistrationsProvider.tsx` 注入。
 * 沒有 Provider = 沒有登記任何報表(選單是空的)。
 */
export const ReportRegistrationsContext = createContext<
  readonly ReportDefinition[]
>([]);

/** 登記的全部報表(順序 = 選單順序;權限過濾由頁面做)。 */
export const useReportRegistrations = (): readonly ReportDefinition[] =>
  useContext(ReportRegistrationsContext);
