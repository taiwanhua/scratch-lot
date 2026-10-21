import { useState } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import {
  type LotteryRedemptionFieldsFragment,
  useLotteryPurchaseRedemptionsQuery,
} from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { RedemptionDetailDialog } from "../../../store/redemption/RedemptionDetailDialog";
import { formatMoney } from "../purchase-keys";

type Row = LotteryRedemptionFieldsFragment;

export interface PurchaseRedemptionsProps {
  /** 進貨分店;還沒選 = "" */
  branchId: string;
  /** 已勾的兌獎紀錄 id */
  pickedIds: ReadonlySet<string>;
  onToggle: (row: Row) => void;
}

/**
 * 進貨單新增頁的兌獎區(規格 8.2「兌獎」;Figma PU-05 兌獎區):勾選這次拿去兌獎的兌獎紀錄,只列進貨分店
 * 「店內持有」的(跨分店不做);兌獎金額 = 勾選的合計,不能手填。送出後勾選的改「已送兌」(api 的掛接點)。
 * 點一列(勾選框以外)開兌獎紀錄詳情。
 */
export const PurchaseRedemptions = ({
  branchId,
  pickedIds,
  onToggle,
}: PurchaseRedemptionsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.redemption");
  const tStatus = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const temporal = useTemporalText();
  const query = useLotteryPurchaseRedemptionsQuery(
    session.client,
    { orgId: branchId, submissionId: null },
    { enabled: branchId !== "" },
  );
  const rows = query.data?.lotteryPurchaseRedemptions.items ?? [];
  // 點一列(勾選框以外)開兌獎紀錄詳情(規格 6.5 的入口之一;用已讀到的那一筆)
  const [opened, setOpened] = useState<Row | null>(null);
  const ticketOf = (row: Row) =>
    `${row.gameCode} · ${displayBookNo(row.bookNo)} · #${row.ticketNo}`;

  const columns: TableColumn<Row>[] = [
    {
      key: "pick",
      header: "",
      width: 48,
      render: (row) => (
        <Checkbox
          checked={pickedIds.has(row.id)}
          slotProps={{
            input: { "aria-label": t("pick", { ticket: row.ticketLabel }) },
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onChange={() => {
            onToggle(row);
          }}
        />
      ),
    },
    {
      key: "serialNo",
      header: t("columns.serialNo"),
      render: (row) => row.serialNo ?? "—",
    },
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
    { key: "ticket", header: t("columns.ticket"), render: ticketOf },
    {
      key: "prize",
      header: t("columns.prize"),
      align: "right",
      render: (row) => formatMoney(row.prizeAmount),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: () => <Tag tone="warning" label={tStatus("status.in_store")} />,
    },
  ];

  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "baseline" } }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("scope")}
          </Typography>
        </Stack>
        {branchId === "" ? (
          <Typography variant="body2" color="text.secondary">
            {t("noBranch")}
          </Typography>
        ) : (
          <Table
            aria-label={t("aria")}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            isLoading={query.isLoading}
            emptyMessage={t("empty")}
            minWidth={640}
            size="small"
            onRowClick={setOpened}
          />
        )}
      </Stack>
      {opened === null ? null : (
        <RedemptionDetailDialog
          id={opened.id}
          item={opened}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </Card>
  );
};
