import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { TICKET_STATUS, displayBookNo } from "@repo/domain/project/lottery";
import {
  type LotteryInvestigationRowFieldsFragment,
  useLotteryInvestigationsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { INVESTIGATIONS_TABLE_MIN_WIDTH, moneyText } from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";

type Row = LotteryInvestigationRowFieldsFragment;

/**
 * 待查·遺失分頁(Figma IN-05 91:1109;規格 7.4):列出有待查或遺失的張的本(一本 × 一種狀態一列):
 * 本、遊戲、狀態、責任分店、來源單據、日期、批購成本(`show-cost`)、[尋回](`recover`;不換店,回到張所在分店的庫存)。
 * 「確認遺失」在盤點確認申請(店面管理)。點一列進本的詳情。
 */
export const InvestigationsTab = () => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useInventoryAccess();
  const temporal = useTemporalText();
  const [recovering, setRecovering] = useState<Row | null>(null);
  const query = useLotteryInvestigationsQuery(session.client);
  const data = query.data?.lotteryInvestigations;
  const rows = data?.items ?? [];
  const canRecover = data?.canRecover ?? false;
  const showCost = rows.some((row) => row.cost != null);

  const columns: TableColumn<Row>[] = [
    {
      key: "bookNo",
      header: t("investigations.columns.book"),
      isEmphasized: true,
      render: (row) => displayBookNo(row.bookNo),
    },
    {
      key: "game",
      header: t("investigations.columns.game"),
      render: (row) => `${row.gameCode} ${row.gameName}`,
    },
    {
      key: "status",
      header: t("investigations.columns.status"),
      render: (row) => (
        <Tag
          tone={row.status === TICKET_STATUS.lost ? "error" : "warning"}
          label={t(`ticketStatuses.${row.status}`)}
        />
      ),
    },
    {
      key: "responsible",
      header: t("investigations.columns.responsible"),
      render: (row) => row.responsibleOrg?.name ?? t("stock.none"),
    },
    {
      key: "source",
      header: t("investigations.columns.source"),
      render: (row) =>
        t("investigations.source", {
          // 未拆整本:待標註的跳號不算(api 已扣)
          count: row.ticketCount,
          serial: row.refSerialNo ?? t("stock.none"),
        }),
    },
    {
      key: "at",
      header: t("investigations.columns.at"),
      render: (row) => (row.at ? temporal(row.at, "monthDay") : ""),
    },
    ...(showCost
      ? [
          {
            key: "cost",
            header: t("investigations.columns.cost"),
            align: "right" as const,
            render: (row: Row) => (row.cost == null ? "" : moneyText(row.cost)),
          },
        ]
      : []),
    ...(canRecover
      ? [
          {
            key: "actions",
            header: "",
            render: (row: Row) => (
              <Button
                variant="text"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  setRecovering(row);
                }}
              >
                {t("investigations.recover")}
              </Button>
            ),
          },
        ]
      : []),
  ];
  const bookRoute = access.bookRoute;
  const rowClick =
    bookRoute === null
      ? {}
      : {
          onRowClick: (row: Row) => {
            void navigate(`${bookRoute}/${row.bookId}`);
          },
        };

  return (
    <Box sx={{ flex: 1, minHeight: 0 }}>
      {query.isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("investigations.loadFailed")}
        </Alert>
      ) : null}
      <Table
        aria-label={t("investigations.listAria")}
        columns={columns}
        rows={rows}
        getRowKey={(row) => `${row.bookId}:${row.status}`}
        isLoading={query.isLoading}
        emptyMessage={t("investigations.empty")}
        minWidth={INVESTIGATIONS_TABLE_MIN_WIDTH}
        {...rowClick}
      />
      {recovering === null ? null : (
        <RecoverTicketDialog
          book={{
            gameCode: recovering.gameCode,
            gameName: recovering.gameName,
            unitPrice: recovering.unitPrice,
            bookNo: recovering.bookNo,
          }}
          tickets={recovering.tickets.map((ticket) => ({
            id: ticket.id,
            version: ticket.version,
            ticketNo: ticket.ticketNo,
            status: ticket.status,
            orgName: ticket.org.name,
          }))}
          keepStore
          onClose={() => {
            setRecovering(null);
          }}
        />
      )}
    </Box>
  );
};
