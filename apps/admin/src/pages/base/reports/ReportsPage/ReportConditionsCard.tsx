import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { ReportPeriodPicker } from "@/components/base/ReportPeriodPicker/ReportPeriodPicker";
import type { ResolvedReportConditions } from "@/lib/base/reports/report-conditions";
import {
  type ReportDefinition,
  type ReportQueryInput,
  extraConditionsFor,
} from "@/lib/base/reports/report-registry";

import { ReportExtraConditionField } from "./ReportExtraConditionField";

export interface ReportConditionsCardProps {
  report: ReportDefinition;
  conditions: ResolvedReportConditions;
  onChange: (conditions: ResolvedReportConditions) => void;
  today: string;
  /** 目前條件組成的查詢 input;條件不完整 = null(給報表的自訂欄位與專屬區塊) */
  input: ReportQueryInput | null;
  /** 有 `reports.export` 才有 [匯出 Excel] */
  canExport: boolean;
  /** 條件完整(有選組織)才能預覽 / 匯出 */
  isReady: boolean;
  isExporting: boolean;
  onPreview: () => void;
  onExport: () => void;
}

/**
 * 右側「<報表> · 條件」:期間 → 其他條件 → 組織(有上限)
 * → [預覽] [匯出 Excel]。
 */
export const ReportConditionsCard = ({
  report,
  conditions,
  onChange,
  today,
  input,
  canExport,
  isReady,
  isExporting,
  onPreview,
  onExport,
}: ReportConditionsCardProps) => {
  const t = useTranslations("admin");
  const title = t("reports.conditions.title", { name: t(report.name) });
  const extras = extraConditionsFor(report.conditions, conditions.period.kind);
  const { ConditionsAddon, MonthCaption } = report;

  return (
    <Card
      component="section"
      aria-label={title}
      sx={{ p: 2.5, flex: 1, minWidth: 0 }}
    >
      <Stack spacing={2.5}>
        <Typography variant="subtitle1" component="h2">
          {title}
        </Typography>
        <ReportPeriodPicker
          value={conditions.period}
          onChange={(period) => {
            onChange({ ...conditions, period });
          }}
          kinds={report.conditions.period}
          today={today}
          monthCaption={
            MonthCaption === undefined
              ? undefined
              : (month) => <MonthCaption month={month} input={input} />
          }
        />
        {extras.length > 0 && (
          <Stack spacing={1}>
            {extras.map((condition) => (
              <ReportExtraConditionField
                key={condition.key}
                condition={condition}
                value={conditions.extra[condition.key] ?? false}
                onChange={(value) => {
                  onChange({
                    ...conditions,
                    extra: { ...conditions.extra, [condition.key]: value },
                  });
                }}
                orgIds={conditions.orgIds}
                input={input}
              />
            ))}
          </Stack>
        )}
        {ConditionsAddon !== undefined && (
          <ConditionsAddon
            input={input}
            periodKind={conditions.period.kind}
            periodDate={conditions.period.date}
            extra={conditions.extra}
          />
        )}
        <OrgTreeSelect
          label={t("reports.conditions.orgs")}
          size="small"
          // 業務頁(用法表 ⑤):整棵租戶樹、可見範圍內的才能選,不是管理範圍
          scope="visible"
          isMultiSelect
          maxCount={report.conditions.orgs.max}
          value={conditions.orgIds}
          onChange={(orgIds) => {
            onChange({ ...conditions, orgIds });
          }}
          helperText={
            conditions.orgIds.length === 0
              ? t("reports.conditions.orgsRequired")
              : undefined
          }
          fullWidth
        />
        {/* [匯出 Excel](主要)在左、[預覽](外框)在右 */}
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          {canExport && (
            <Button
              variant="contained"
              disabled={!isReady || isExporting}
              onClick={onExport}
            >
              {isExporting
                ? t("reports.conditions.exporting")
                : t("reports.conditions.export")}
            </Button>
          )}
          <Button variant="outlined" disabled={!isReady} onClick={onPreview}>
            {t("reports.conditions.preview")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
