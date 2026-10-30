import { Stack } from "@repo/ui/stack";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useReportRegistrations } from "@/hooks/base/useReportRegistrations";
import { useUrlState } from "@/hooks/base/useUrlState";
import { reportPermissionOf } from "@/lib/base/reports/report-registry";

import { reportKeySchema } from "../reports-url-state";
import { ReportListCard } from "./ReportListCard";
import { ReportWorkspace } from "./ReportWorkspace";

/**
 * 輸出報表(模組 `reports`;正本 `docs/modules/reports.md`):
 * 選報表 → 條件 → [預覽] [匯出 Excel]。報表來自登記清單(`useReportRegistrations`;底座與專案各自登記),
 * 只列操作者有 `reports.<報表 key>` 的;一張都沒有時選單是空的並顯示說明。
 * 選的報表、條件、預覽都放網址(REACT-14),重新整理或分享網址回到同一個畫面。
 */
export const ReportsPage = () => {
  const { hasPermission } = usePermissions();
  const [reportKey, setReportKey] = useUrlState("report", reportKeySchema);
  const reports = useReportRegistrations().filter((report) =>
    hasPermission(reportPermissionOf(report.key)),
  );
  const report =
    reports.find((candidate) => candidate.key === reportKey) ?? reports.at(0);
  const list = (onSelect: (key: string) => void) => (
    <ReportListCard
      reports={reports}
      selectedKey={report?.key ?? null}
      onSelect={onSelect}
    />
  );

  if (report === undefined) {
    return <Stack spacing={2}>{list(setReportKey)}</Stack>;
  }
  return (
    <ReportWorkspace
      key={report.key}
      report={report}
      renderList={(closePreview) =>
        list((key) => {
          setReportKey(key);
          closePreview();
        })
      }
    />
  );
};
