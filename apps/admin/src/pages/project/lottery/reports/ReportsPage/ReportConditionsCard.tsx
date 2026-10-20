import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { ReportPeriodPicker } from "@/components/project/ReportPeriodPicker/ReportPeriodPicker";
import type { ResolvedReportConditions } from "@/lib/project/reports/report-conditions";
import {
  type ReportDefinition,
  extraConditionsFor,
} from "@/lib/project/reports/report-registry";

import { ReportExtraConditionField } from "./ReportExtraConditionField";

export interface ReportConditionsCardProps {
  report: ReportDefinition;
  conditions: ResolvedReportConditions;
  onChange: (conditions: ResolvedReportConditions) => void;
  today: string;
  /** 有 `reports.export` 才有 [匯出 Excel] */
  canExport: boolean;
  /** 條件完整(有選分店)才能預覽 / 匯出 */
  isReady: boolean;
  isExporting: boolean;
  onPreview: () => void;
  onExport: () => void;
}

/**
 * 右側「<報表> · 條件」(Figma RE-01 `94:17`、RE-03 `129:421`):期間 → 其他條件 → 分店(有上限)
 * → [預覽] [匯出 Excel]。
 */
export const ReportConditionsCard = ({
  report,
  conditions,
  onChange,
  today,
  canExport,
  isReady,
  isExporting,
  onPreview,
  onExport,
}: ReportConditionsCardProps) => {
  const t = useTranslations("admin");
  const title = t("lotteryReports.conditions.title", { name: t(report.name) });
  const extras = extraConditionsFor(report.conditions, conditions.period.kind);

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
              />
            ))}
          </Stack>
        )}
        <OrgTreeSelect
          label={t("lotteryReports.conditions.orgs")}
          // 業務頁:候選是操作者的可見範圍(查 `visibleOrgTree`),不是管理範圍
          scope="visible"
          isMultiSelect
          maxCount={report.conditions.orgs.max}
          value={conditions.orgIds}
          onChange={(orgIds) => {
            onChange({ ...conditions, orgIds });
          }}
          helperText={
            conditions.orgIds.length === 0
              ? t("lotteryReports.conditions.orgsRequired")
              : undefined
          }
          fullWidth
        />
        {/* Figma RE-03:[匯出 Excel](主要)在左、[預覽](外框)在右 */}
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          {canExport && (
            <Button
              variant="contained"
              disabled={!isReady || isExporting}
              onClick={onExport}
            >
              {isExporting
                ? t("lotteryReports.conditions.exporting")
                : t("lotteryReports.conditions.export")}
            </Button>
          )}
          <Button variant="outlined" disabled={!isReady} onClick={onPreview}>
            {t("lotteryReports.conditions.preview")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
