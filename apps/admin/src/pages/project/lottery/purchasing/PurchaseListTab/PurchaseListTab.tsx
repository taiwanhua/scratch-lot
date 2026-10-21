import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { formatCount } from "../purchasing-keys";
import {
  PENDING_REQUISITION_ACTIONS,
  type PendingRequisition,
} from "./purchase-list-actions";
import type { PurchaseList } from "./purchase-list-sheet";
import { usePurchaseList } from "./usePurchaseList";

type PurchaseRow = PurchaseList["rows"][number];

/** 分店欄寬(本數)。 */
const BRANCH_WIDTH = 100;

/**
 * 「採購清單」分頁(規格 8.1;Figma PU-03 92:1340;要 `purchasing.requisition.purchase-list`):
 * 只列待購買的叫貨單(未作廢、未被進貨單或調貨單引用),依遊戲 × 分店加總並算預估批購金額;
 * 下半部列出每一張待購買的叫貨單與它的動作([建立進貨單] [從其他分店調貨] 由進貨單、調貨單的功能追加)。
 * [匯出 Excel] 在頁首(`PurchaseListExportButton`)。
 */
export const PurchaseListTab = () => {
  const t = useTranslations("admin.lotteryPurchasing.purchaseList");
  const { list, isLoading, orgNameOf, gameLabelOf } = usePurchaseList();
  const orgIds = list?.orgIds ?? [];

  const gameColumns: TableColumn<PurchaseRow>[] = [
    {
      key: "game",
      header: t("columns.game"),
      width: 220,
      render: (row) => gameLabelOf(row),
    },
    ...orgIds.map((orgId): TableColumn<PurchaseRow> => ({
      key: orgId,
      header: orgNameOf(orgId),
      width: BRANCH_WIDTH,
      align: "right",
      render: (row) => {
        const books = row.branches.find(
          (branch) => branch.orgId === orgId,
        )?.books;
        return books === undefined ? "—" : formatCount(books);
      },
    })),
    {
      key: "totalBooks",
      header: t("columns.totalBooks"),
      width: 110,
      align: "right",
      render: (row) => formatCount(row.totalBooks),
    },
    {
      key: "estimatedAmount",
      header: t("columns.estimatedAmount"),
      width: 140,
      align: "right",
      render: (row) => formatCount(row.estimatedAmount),
    },
  ];

  const requisitionColumns: TableColumn<PendingRequisition>[] = [
    {
      key: "serialNo",
      header: t("columns.serialNo"),
      width: 110,
      render: (row) => row.serialNo ?? "—",
    },
    {
      key: "branch",
      header: t("columns.branch"),
      width: 140,
      render: (row) => orgNameOf(row.orgId),
    },
    {
      key: "books",
      header: t("columns.books"),
      width: 80,
      align: "right",
      render: (row) => formatCount(row.books),
    },
    {
      key: "estimatedAmount",
      header: t("columns.estimatedShort"),
      width: 120,
      align: "right",
      render: (row) => formatCount(row.estimatedAmount),
    },
    ...(PENDING_REQUISITION_ACTIONS.length === 0
      ? []
      : [
          {
            key: "actions",
            header: "",
            render: (row: PendingRequisition) => (
              <Stack direction="row" spacing={1}>
                {PENDING_REQUISITION_ACTIONS.map(({ key, Action }) => (
                  <Action key={key} requisition={row} />
                ))}
              </Stack>
            ),
          },
        ]),
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Typography variant="body2" color="text.secondary">
        {t("hint")}
      </Typography>
      <Table
        aria-label={t("listAria")}
        columns={gameColumns}
        rows={list?.rows ?? []}
        getRowKey={(row) => row.gameId}
        isLoading={isLoading}
        emptyMessage={t("empty")}
        minWidth={gameColumns.reduce(
          (sum, column) =>
            sum + (typeof column.width === "number" ? column.width : 0),
          0,
        )}
      />
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {t("pendingTitle")}
      </Typography>
      <Table
        aria-label={t("pendingAria")}
        columns={requisitionColumns}
        rows={list?.requisitions ?? []}
        getRowKey={(row) => row.requisitionId}
        isLoading={isLoading}
        emptyMessage={t("pendingEmpty")}
        minWidth={460}
      />
    </Stack>
  );
};
