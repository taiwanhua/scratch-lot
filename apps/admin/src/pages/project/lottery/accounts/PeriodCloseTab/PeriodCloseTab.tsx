import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import {
  type LotteryPeriodClosesQuery,
  useLotteryPeriodClosesQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import type { TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { AccountsList } from "../AccountsList/AccountsList";
import { PERIOD_TABLE_MIN_WIDTH } from "../accounts-config";
import { PeriodCloseDialog } from "./PeriodCloseDialog";
import { PeriodSnapshotDialog } from "./PeriodSnapshotDialog";

type Row = LotteryPeriodClosesQuery["lotteryPeriodCloses"]["items"][number];

/** 狀態標籤色:進行中 = 灰、未關帳 = 警告、已關帳 = 成功(Figma AC-06)。 */
const STATUS_TONES = {
  current: "grey",
  open: "warning",
  closed: "success",
} as const;

const statusOf = (status: string): keyof typeof STATUS_TONES =>
  status === "open" || status === "closed" ? status : "current";

/**
 * 關帳分頁(Figma AC-06 93:1417;規格 10.4):月份列表 —— 月份、狀態、關帳時間、關帳人;
 * [關帳] 只在最早的未關帳、已結束的月份(api 的 `canClose`),已關帳的月份有 [快照]。
 * 整個分頁看 `accounts.close-period`(`AccountsPage` 的分頁權限)。
 */
export const PeriodCloseTab = () => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const query = useLotteryPeriodClosesQuery(session.client);
  const rows = query.data?.lotteryPeriodCloses.items ?? [];
  const [closing, setClosing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const columns: TableColumn<Row>[] = [
    {
      key: "month",
      header: t("periodClose.columns.month"),
      isEmphasized: true,
      render: (row) => row.month,
    },
    {
      key: "status",
      header: t("periodClose.columns.status"),
      render: (row) => (
        <Tag
          tone={STATUS_TONES[statusOf(row.status)]}
          label={t(`periodClose.statuses.${statusOf(row.status)}`)}
        />
      ),
    },
    {
      key: "closedAt",
      header: t("periodClose.columns.closedAt"),
      render: (row) =>
        row.closedAt == null
          ? "—"
          : formatTemporal(row.closedAt, { type: "datetime", timezone }),
    },
    {
      key: "closedBy",
      header: t("periodClose.columns.closedBy"),
      render: (row) => row.closedBy?.name ?? "—",
    },
    {
      key: "actions",
      header: t("periodClose.columns.actions"),
      width: 120,
      render: (row) => {
        if (row.canClose) {
          return (
            <Button
              size="small"
              onClick={() => {
                setClosing(row.month);
              }}
            >
              {t("periodClose.close")}
            </Button>
          );
        }
        return row.status === "closed" ? (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              setViewing(row.month);
            }}
          >
            {t("periodClose.snapshot")}
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <Box sx={{ flexGrow: 1, flexShrink: 0 }}>
      <Typography
        variant="body2"
        color="textSecondary"
        component="p"
        sx={{ mb: 2 }}
      >
        {t("periodClose.hint")}
      </Typography>
      <AccountsList
        aria-label={t("periodClose.listAria")}
        card={{ title: ["month"], tag: "status", actions: "actions" }}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.month}
        isLoading={query.isLoading}
        emptyMessage={t("periodClose.empty")}
        minWidth={PERIOD_TABLE_MIN_WIDTH}
      />
      {closing !== null && (
        <PeriodCloseDialog
          month={closing}
          onClose={() => {
            setClosing(null);
          }}
        />
      )}
      {viewing !== null && (
        <PeriodSnapshotDialog
          month={viewing}
          onClose={() => {
            setViewing(null);
          }}
        />
      )}
    </Box>
  );
};
