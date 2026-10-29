import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { ReportDefinition } from "@/lib/base/reports/report-registry";

export interface ReportListCardProps {
  /** 操作者有權限的報表(沒有權限的不出現) */
  reports: readonly ReportDefinition[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/**
 * 左側「報表」選單:一張報表一個單選,名稱後註明組織上限。
 * 一張都沒有(沒有任何報表權限)時顯示說明。
 */
export const ReportListCard = ({
  reports,
  selectedKey,
  onSelect,
}: ReportListCardProps) => {
  const t = useTranslations("admin");
  const title = t("reports.reportList.title");
  return (
    <Card
      component="section"
      aria-label={title}
      sx={{ p: 2.5, width: { xs: "100%", md: 300 }, flexShrink: 0 }}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h2">
          {title}
        </Typography>
        {reports.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            {t("reports.reportList.empty")}
          </Typography>
        ) : (
          <RadioGroup
            aria-label={title}
            value={selectedKey ?? ""}
            onChange={(_event, value) => {
              onSelect(value);
            }}
          >
            {reports.map((report) => (
              <FormControlLabel
                key={report.key}
                value={report.key}
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    {t("reports.reportList.option", {
                      name: t(report.name),
                      max: report.conditions.orgs.max,
                    })}
                  </Typography>
                }
              />
            ))}
          </RadioGroup>
        )}
      </Stack>
    </Card>
  );
};
