import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, parseLocalDate } from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useTenantToday } from "@/hooks/base/useTenantToday";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  type ResolvedReportConditions,
  reportQueryInputOf,
  resolveConditions,
} from "@/lib/base/reports/report-conditions";
import {
  type ReportPeriodValue,
  lastDayOfWeek,
} from "@/lib/base/reports/report-period";
import {
  REPORTS_PERMISSIONS,
  type ReportDefinition,
} from "@/lib/base/reports/report-registry";

import {
  reportConditionsSchema,
  reportPreviewSchema,
} from "../reports-url-state";
import { ReportConditionsCard } from "./ReportConditionsCard";
import { ReportPreviewPanel } from "./ReportPreviewPanel";
import { useReportRun } from "./useReportRun";

/** 期間的顯示文字:日 `2026-10-16`、週 `2026-10-11 ~ 2026-10-17`、月 `2026 年 10 月`。 */
const usePeriodText = () => {
  const t = useTranslations("admin.reports.period");
  return (period: ReportPeriodValue): string => {
    if (period.kind === "week") {
      return t("week", { from: period.date, to: lastDayOfWeek(period.date) });
    }
    if (period.kind === "month") {
      const day = parseLocalDate(period.date);
      return t("month", { year: day?.year ?? 0, month: day?.month ?? 0 });
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
 * 選定一張報表之後的畫面:左側選單 + 右側條件;按 [預覽] 換成預覽。
 * 沒有 `reports.export` 看不到 [匯出 Excel]。
 */
export const ReportWorkspace = ({
  report,
  renderList,
}: ReportWorkspaceProps) => {
  const t = useTranslations("admin");
  const { hasPermission } = usePermissions();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  // 「今天」在頁面開啟時取一次(租戶時區;底座 `useTenantToday`)
  const today = useTenantToday();
  const periodText = usePeriodText();

  const [state, setState] = useUrlState("conditions", reportConditionsSchema);
  const [preview, setPreview] = useUrlState("preview", reportPreviewSchema);

  const conditions = resolveConditions(report, state, today);
  const input = reportQueryInputOf(report, conditions, timezone);
  const canExport = hasPermission(REPORTS_PERMISSIONS.export);
  const isPreviewOpen = preview.open && input !== null;

  const name = t(report.name);
  const period = periodText(conditions.period);
  const run = useReportRun({
    report,
    input,
    isPreviewOpen,
    timezone,
    fileLabel: { name, period },
  });
  /** 關預覽(返回條件、換報表、改條件):上一次匯出失敗的提示跟著清掉 */
  const closePreview = () => {
    setPreview({ open: false, sheet: 0 });
    run.clearExportError();
  };

  const changeConditions = (next: ResolvedReportConditions) => {
    setState(next);
    closePreview();
  };
  const error =
    run.errorCode === null ? null : (
      <Alert severity="error">{t(`reports.errors.${run.errorCode}`)}</Alert>
    );

  if (isPreviewOpen) {
    return (
      <Stack spacing={2}>
        {error}
        <ReportPreviewPanel
          title={t("reports.preview.title", { name, period })}
          orgNames={run.orgs.map((org) => org.name)}
          sheets={run.sheets}
          SheetBody={report.SheetBody}
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
          input={input}
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
