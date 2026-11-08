import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { TICKET_STATUS } from "@repo/domain/project/lottery";
import {
  type LotteryInvestigationRowFieldsFragment,
  useLotteryInvestigationsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { useSession } from "@/hooks/base/useSession";

import { INVESTIGATIONS_TABLE_MIN_WIDTH, moneyText } from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";
import { InvestigationCards } from "./InvestigationCards";
import { useInvestigationText } from "./useInvestigationText";

type Row = LotteryInvestigationRowFieldsFragment;

/**
 * 待查·遺失分頁(Figma IN-05 91:1109、CS-21;規格 7.4、張數店規格 7.9 / 13.2):列出有待查或遺失的張的本
 * (一本 × 一種狀態一列):本、遊戲、狀態、責任分店、來源單據、日期、批購成本(`show-cost`)、[尋回](`recover`;
 * 不換店,回到張所在分店的庫存)。「確認遺失」在盤點確認申請(店面管理)。點一列進本的詳情。
 *
 * 張數店系統預設帶入的待查 / 遺失(未對號)依「遊戲 × 責任分店 × 來源盤點」一列:本寫「—」、張號寫「系統預設帶入」、
 * 來源寫「11/01 交班盤點」;點一下展開看本與張號,不給 [尋回](從清單尋回會把帶入的張號記回庫存,找到的可能是別張)。
 *
 * 手機(< sm)一列一張卡片(`InvestigationCards`;Figma CS-21 手機 862:22606),未對號的卡片直接寫本與張號。
 */
export const InvestigationsTab = () => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useInventoryAccess();
  const text = useInvestigationText();
  const isMobile = useBreakpointDown("sm");
  const [recovering, setRecovering] = useState<Row | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
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
      render: text.book,
    },
    {
      key: "game",
      header: t("investigations.columns.game"),
      render: text.game,
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
      render: text.responsible,
    },
    {
      key: "tickets",
      header: t("investigations.columns.tickets"),
      align: "right",
      // 未拆整本:待標註的跳號不算(api 已扣)
      render: (row) => String(row.ticketCount),
    },
    {
      key: "ticketNos",
      header: t("investigations.columns.ticketNos"),
      render: text.ticketNos,
    },
    {
      key: "source",
      header: t("investigations.columns.source"),
      render: text.source,
    },
    {
      key: "at",
      header: t("investigations.columns.at"),
      render: text.at,
    },
    {
      key: "days",
      header: t("investigations.columns.days"),
      align: "right",
      render: text.days,
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
            render: (row: Row) =>
              row.unmatched ? null : (
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
  const keyOf = (row: Row) =>
    row.unmatched
      ? `unmatched:${row.gameCode}:${row.responsibleOrg?.id ?? ""}:${row.refSerialNo ?? ""}:${row.status}`
      : `${row.bookId}:${row.status}`;
  // 未對號的列:點一下展開 / 收起看本與張號;確定的列:進本的詳情
  const onRowClick = (row: Row) => {
    if (row.unmatched) {
      setExpanded((current) => (current === keyOf(row) ? null : keyOf(row)));
      return;
    }
    if (bookRoute !== null) {
      void navigate(`${bookRoute}/${row.bookId}`);
    }
  };
  const expandedOf = (row: Row) =>
    row.unmatched && expanded === keyOf(row)
      ? t("investigations.unmatchedDetail", { books: text.unmatchedBooks(row) })
      : null;
  // 手機卡片:沒綁本的詳情頁時卡片不能點
  const openCard = bookRoute === null ? {} : { onOpen: onRowClick };

  return (
    <Box sx={{ flex: 1, minHeight: 0 }}>
      {query.isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("investigations.loadFailed")}
        </Alert>
      ) : null}
      {isMobile ? (
        <InvestigationCards
          rows={rows}
          isLoading={query.isLoading}
          getRowKey={keyOf}
          canRecover={canRecover}
          {...openCard}
          onRecover={setRecovering}
        />
      ) : (
        <Table
          aria-label={t("investigations.listAria")}
          columns={columns}
          rows={rows}
          getRowKey={keyOf}
          onRowClick={onRowClick}
          renderExpanded={expandedOf}
          isLoading={query.isLoading}
          emptyMessage={t("investigations.empty")}
          minWidth={INVESTIGATIONS_TABLE_MIN_WIDTH}
        />
      )}
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
