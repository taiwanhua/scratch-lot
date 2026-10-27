import { Fragment, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { SupportRequestRow } from "./support-requests";
import type { SupportRequestColumn } from "./useSupportRequestColumns";

export interface SupportRequestCardsProps {
  rows: readonly SupportRequestRow[];
  /** 列表欄位配置算出的欄(與表格同一份) */
  columns: readonly SupportRequestColumn[];
  isLoading: boolean;
  onOpen: (row: SupportRequestRow) => void;
}

/** 卡片標題列放前幾欄。 */
const HEADING_COUNT = 4;

/** 幾格串成一行,以「 · 」分隔。 */
const joined = (
  row: SupportRequestRow,
  columns: readonly SupportRequestColumn[],
): ReactNode =>
  columns.map((column, index) => (
    <Fragment key={column.key}>
      {index > 0 && " · "}
      {column.render(row)}
    </Fragment>
  ));

/**
 * 手機版的支援需求單列表(規格 16.0 / RW-01:表格在手機改成卡片)。欄位與表格同一份(列表欄位配置):
 * 前四欄(初值是單號、日期、開始、結束)一行、狀態放右上,其餘一行;點卡片進詳情頁。
 */
export const SupportRequestCards = ({
  rows,
  columns,
  isLoading,
  onOpen,
}: SupportRequestCardsProps) => {
  const t = useTranslations("admin.schedule.supportRequests");
  if (isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("empty")}
      </Typography>
    );
  }
  const status = columns.find((column) => column.key === "status");
  const others = columns.filter((column) => column.key !== "status");
  const heading = others.slice(0, HEADING_COUNT);
  const detail = others.slice(HEADING_COUNT);
  return (
    <Stack spacing={1.5} sx={{ height: "100%", overflow: "auto" }}>
      {rows.map((row) => (
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
              <Typography variant="subtitle2" component="div" sx={{ flex: 1 }}>
                {joined(row, heading)}
              </Typography>
              {status?.render(row)}
            </Stack>
            {detail.length > 0 && (
              <Typography variant="body2" color="textSecondary" component="div">
                {joined(row, detail)}
              </Typography>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};
