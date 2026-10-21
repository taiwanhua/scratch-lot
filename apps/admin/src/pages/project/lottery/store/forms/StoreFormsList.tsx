import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";

import { STORE_KEY } from "./store-forms-keys";

/** 表格最小寬度:窄於它時表格內橫向捲動(手機改用卡片)。 */
const TABLE_MIN_WIDTH = 760;

export interface StoreFormsListProps<Row extends { id: string }> {
  ariaLabel: string;
  rows: readonly Row[];
  isLoading: boolean;
  columns: readonly TableColumn<Row>[];
  /** 手機卡片:標題列(單號 + 狀態)與內文。 */
  cardTitle: (row: Row) => ReactNode;
  cardBody: (row: Row) => ReactNode;
}

/**
 * 撤銷售出 / 現金更正分頁的列表(Figma ST-31a / ST-32a;平板同電腦、手機改卡片):點一列開表單引擎的詳情
 * (綁了詳情頁才點得進去)。
 */
export const StoreFormsList = <Row extends { id: string }>({
  ariaLabel,
  rows,
  isLoading,
  columns,
  cardTitle,
  cardBody,
}: StoreFormsListProps<Row>) => {
  const t = useTranslations("admin.lotteryStore.storeForms");
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const isPhone = useBreakpointDown("sm");
  const viewRoute = access.viewRoute;
  const open =
    viewRoute === null
      ? undefined
      : (row: Row) => {
          void navigate(`${viewRoute}/${row.id}`);
        };
  if (!isPhone) {
    return (
      <Table
        aria-label={ariaLabel}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        isLoading={isLoading}
        emptyMessage={t("empty")}
        minWidth={TABLE_MIN_WIDTH}
        {...(open === undefined ? {} : { onRowClick: open })}
      />
    );
  }
  if (isLoading) {
    return <CircularProgress aria-label={ariaLabel} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("empty")}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5} role="list" aria-label={ariaLabel}>
      {rows.map((row) => (
        <Card
          key={row.id}
          role="listitem"
          variant="outlined"
          sx={{ p: 1.5, cursor: open === undefined ? "default" : "pointer" }}
          onClick={() => {
            open?.(row);
          }}
        >
          <Stack spacing={0.5}>
            {cardTitle(row)}
            {cardBody(row)}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};
