import type { ReactNode } from "react";

import { ReportRegistrationsContext } from "@/hooks/base/useReportRegistrations";
import type { ReportDefinition } from "@/lib/base/reports/report-registry";

export interface ReportRegistrationsProviderProps {
  /** 組裝好的報表登記(`app/module-pages.tsx` 的 `reportRegistrations`) */
  reports: readonly ReportDefinition[];
  children: ReactNode;
}

/**
 * 把報表登記注入給輸出報表頁(`hooks/base/useReportRegistrations.ts`)。登記由呼叫端組好傳進來,
 * 這裡不讀任何登記表。
 */
export const ReportRegistrationsProvider = ({
  reports,
  children,
}: ReportRegistrationsProviderProps) => (
  <ReportRegistrationsContext.Provider value={reports}>
    {children}
  </ReportRegistrationsContext.Provider>
);
