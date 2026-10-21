import { useState } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import {
  type LotteryRedemptionFieldsFragment,
  useLotteryPurchaseRedemptionRecordsQuery,
} from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { RedemptionDetailDialog } from "../../../store/redemption/RedemptionDetailDialog";
import { statusToneOf } from "../../../store/redemption/redemption-shared";
import { formatMoney } from "../purchase-keys";

type Row = LotteryRedemptionFieldsFragment;

export interface PurchaseRedemptionRecordsProps {
  submissionId: string;
}

/**
 * 進貨單檢視頁的兌獎區(規格 6.5「兌獎紀錄詳情」的入口之一、8.2「兌獎」):這張單勾選的兌獎紀錄,
 * 點一列開兌獎紀錄詳情。讀取依據是讀得到這張進貨單(`lotteryPurchaseRedemptionRecords`;總部不一定有
 * 店面管理的權限),這裡不能撤銷。沒有勾任何一筆時不顯示。
 */
export const PurchaseRedemptionRecords = ({
  submissionId,
}: PurchaseRedemptionRecordsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.redemption");
  const tStore = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const temporal = useTemporalText();
  const query = useLotteryPurchaseRedemptionRecordsQuery(
    session.client,
    { submissionId },
    { retry: false },
  );
  const rows = query.data?.lotteryPurchaseRedemptionRecords ?? [];
  const [opened, setOpened] = useState<Row | null>(null);
  if (rows.length === 0) {
    return null;
  }

  const columns: TableColumn<Row>[] = [
    {
      key: "time",
      header: t("columns.time"),
      render: (row) => temporal(row.redeemedAt, "monthDayTime"),
    },
    {
      key: "cashPoint",
      header: t("columns.cashPoint"),
      render: (row) => row.cashPoint.name,
    },
    {
      key: "ticket",
      header: t("columns.ticket"),
      render: (row) =>
        `${row.gameCode} · ${displayBookNo(row.bookNo)} · #${row.ticketNo}`,
    },
    {
      key: "prize",
      header: t("columns.prize"),
      align: "right",
      render: (row) => formatMoney(row.prizeAmount),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => (
        <Tag
          tone={statusToneOf(row.status)}
          label={tStore(`status.${row.status}`)}
        />
      ),
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" component="h2">
        {t("viewTitle")}
      </Typography>
      <Table
        aria-label={t("aria")}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        minWidth={560}
        size="small"
        onRowClick={setOpened}
      />
      {opened === null ? null : (
        <RedemptionDetailDialog
          id={opened.id}
          item={opened}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </Stack>
  );
};
