import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { type SupportRequestRow, cellsOf } from "./support-requests";

export interface SupportRequestCardsProps {
  rows: readonly SupportRequestRow[];
  isLoading: boolean;
  onOpen: (row: SupportRequestRow) => void;
}

/**
 * 手機版的支援需求單列表(規格 16.0 / RW-01:表格在手機改成卡片):
 * 日期 · 時段 + 狀態一行,崗位 · 人數 · 分店一行;點卡片進詳情頁。
 */
export const SupportRequestCards = ({
  rows,
  isLoading,
  onOpen,
}: SupportRequestCardsProps) => {
  const t = useTranslations("admin.schedule.supportRequests");
  const temporal = useTemporalText();
  if (isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("empty")}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5} sx={{ height: "100%", overflow: "auto" }}>
      {rows.map((row) => {
        const cells = cellsOf(row);
        return (
          <Card
            key={row.id}
            variant="outlined"
            role="button"
            tabIndex={0}
            onClick={() => {
              onOpen(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onOpen(row);
              }
            }}
            sx={{ p: 2, flexShrink: 0, cursor: "pointer" }}
          >
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {t("cardTitle", {
                    date: temporal(cells.date, "date"),
                    start: cells.start,
                    end: cells.end,
                  })}
                </Typography>
                <SubmissionStatusTag
                  status={row.status}
                  blocked={row.blocked}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("cardDetail", {
                  position: cells.position,
                  headcount: cells.headcount,
                  branch: cells.branch,
                })}
              </Typography>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
};
