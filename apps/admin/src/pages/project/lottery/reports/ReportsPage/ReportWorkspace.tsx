import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  type ResolvedReportConditions,
  reportQueryInputOf,
  resolveConditions,
} from "@/lib/project/reports/report-conditions";
import {
  type ReportPeriodValue,
  lastDayOfWeek,
  todayOf,
} from "@/lib/project/reports/report-period";
import {
  REPORTS_PERMISSIONS,
  type ReportDefinition,
} from "@/lib/project/reports/report-registry";

import {
  reportConditionsSchema,
  reportPreviewSchema,
} from "../reports-url-state";
import { ReportConditionsCard } from "./ReportConditionsCard";
import { ReportPreviewPanel } from "./ReportPreviewPanel";
import { useReportRun } from "./useReportRun";

/** 期間的顯示文字:日 `2026-10-16`、週 `2026-10-11 ~ 2026-10-17`、月 `2026 年 10 月`。 */
const usePeriodText = () => {
  const t = useTranslations("admin.lotteryReports.period");
  return (period: ReportPeriodValue): string => {
    if (period.kind === "week") {
      return t("week", { from: period.date, to: lastDayOfWeek(period.date) });
    }
    if (period.kind === "month") {
      return t("month", {
        year: Number(period.date.slice(0, 4)),
        month: Number(period.date.slice(5, 7)),
      });
    }
    return t("day", { date: period.date });
  };
};

export interface ReportWorkspaceProps {
  report: ReportDefinition;
  /** 左側報表選單(由頁面畫;選了別張報表時順便關掉預覽) */
  renderList: (closePreview: () => void) => ReactNode;
}

/**
 * 選定一張報表之後的畫面:左側選單 + 右側條件;按 [預覽] 換成預覽(Figma RE-01 / RE-02 / RE-03)。
 * 沒有 `reports.export` 看不到 [匯出 Excel]。
 */
export const ReportWorkspace = ({
  report,
  renderList,
}: ReportWorkspaceProps) => {
  const t = useTranslations("admin");
  const { hasPermission } = usePermissions();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  // 「今天」在頁面開啟時取一次(租戶時區)
  const [openedAt] = useState(() => Date.now());
  const today = todayOf(timezone, openedAt);
  const periodText = usePeriodText();

  const [state, setState] = useUrlState("conditions", reportConditionsSchema);
  const [preview, setPreview] = useUrlState("preview", reportPreviewSchema);

  const conditions = resolveConditions(report, state, today);
  const input = reportQueryInputOf(conditions, timezone);
  const canExport = hasPermission(REPORTS_PERMISSIONS.export);
  const isPreviewOpen = preview.open && input !== null;

  const name = t(report.name);
  const period = periodText(conditions.period);
  const closePreview = () => {
    setPreview({ open: false, sheet: 0 });
  };
  const run = useReportRun({
    report,
    input,
    isPreviewOpen,
    timezone,
    fileLabel: { name, period },
  });

  const changeConditions = (next: ResolvedReportConditions) => {
    setState(next);
    closePreview();
  };
  const error =
    run.errorCode === null ? null : (
      <Alert severity="error">
        {t(`lotteryReports.errors.${run.errorCode}`)}
      </Alert>
    );

  if (isPreviewOpen) {
    return (
      <Stack spacing={2}>
        {error}
        <ReportPreviewPanel
          title={t("lotteryReports.preview.title", { name, period })}
          orgNames={run.orgs.map((org) => org.name)}
          sheets={run.sheets}
          isLoading={run.isLoading}
          sheetIndex={preview.sheet}
          onSheetChange={(sheet) => {
            setPreview({ open: true, sheet });
          }}
          canExport={canExport}
          isExporting={run.isExporting}
          onExport={() => void run.exportExcel()}
          onBack={closePreview}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {error}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: { xs: "stretch", md: "flex-start" } }}
      >
        {renderList(closePreview)}
        <ReportConditionsCard
          report={report}
          conditions={conditions}
          onChange={changeConditions}
          today={today}
          canExport={canExport}
          isReady={input !== null}
          isExporting={run.isExporting}
          onPreview={() => {
            setState(conditions);
            setPreview({ open: true, sheet: 0 });
          }}
          onExport={() => void run.exportExcel()}
        />
      </Stack>
    </Stack>
  );
};
