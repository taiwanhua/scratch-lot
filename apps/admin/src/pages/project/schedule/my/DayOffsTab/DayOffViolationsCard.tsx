import { useTranslations } from "use-intl";

import type { ScheduleDayOffViolationFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useDayOffViolationText } from "@/hooks/project/schedule/useDayOffViolationText/useDayOffViolationText";

export interface DayOffViolationsCardProps {
  violations: readonly ScheduleDayOffViolationFieldsFragment[];
  /** [查看]:打開那天的詳細(違反有日期才有按鈕) */
  onView: (date: string) => void;
}

/** 我的畫休右側(手機在月曆下方)的違規清單:等級標籤、說明、[查看](規格 14.6)。 */
export const DayOffViolationsCard = ({
  violations,
  onView,
}: DayOffViolationsCardProps) => {
  const t = useTranslations("admin.schedule.dayOffs.my");
  const tRules = useTranslations("admin.schedule.rules");
  const violationText = useDayOffViolationText();
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">
          {t("violationsTitle", { count: violations.length })}
        </Typography>
        {violations.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("noViolations")}
          </Typography>
        )}
        {violations.map((violation) => {
          const date = violation.dates.at(0);
          return (
            <Stack
              key={`${violation.key}-${violation.from ?? ""}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start" }}
            >
              <Tag
                tone={violation.level === "limit" ? "error" : "warning"}
                label={tRules(`levels.${violation.level}`)}
              />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {violationText(violation)}
              </Typography>
              {date !== undefined && (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    onView(date);
                  }}
                >
                  {t("view")}
                </Button>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Card>
  );
};
