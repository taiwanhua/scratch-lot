import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { displayBookKey } from "@repo/domain/project/lottery";
import {
  type LotteryInventoryBookDetailFieldsFragment,
  useLotteryInventoryBookQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import { BookHeader } from "./BookHeader";
import { BookInfoCards } from "./BookInfoCards";
import { BookTimeline } from "./BookTimeline";
import { CorrectSkipsDialog } from "./CorrectSkipsDialog";
import { ScrapTicketsDialog } from "./ScrapTicketsDialog";
import { SelectionBar } from "./SelectionBar";
import {
  BOOK_LEGEND,
  BOOK_SELECTABLE,
  bookCellsOf,
  selectionActionsOf,
} from "./book-cells";

type Detail = LotteryInventoryBookDetailFieldsFragment;
type Ticket = Detail["tickets"][number];

/** 查刮刮樂帶來的張號(`?ticket=071`):打開時標亮(選起來)那一張。 */
const ticketSchema = z.string().default("");

/**
 * 本的詳情(隱藏頁 `inventory.book-page`;Figma IN-03 125:1159 / 整本待查 125:1699;規格 7.3):
 * 頁首(遊戲 · 本號、面額 · 張號、狀態、[更正跳號])→ 整本待查時的狀態列 [整本尋回] →
 * 來源 / 所在 / 成本(`show-cost`)→ 張數格子(選張後上方出現操作列:未售 → [報廢];待查 / 遺失 → [尋回])
 * → 事件時間軸。按鈕依 api 的 `abilities`(沒有權限的按鈕不顯示)。
 */
export const BookPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const id = routeParam ?? "";
  const [ticketParam] = useUrlState("ticket", ticketSchema);
  const [selected, setSelected] = useState<string[]>(
    ticketParam === "" ? [] : [ticketParam],
  );
  const [dialog, setDialog] = useState<
    "correct" | "scrap" | "recover" | "recoverAll" | null
  >(null);
  const query = useLotteryInventoryBookQuery(
    session.client,
    { id },
    { enabled: id !== "", retry: false },
  );
  const detail = query.data?.lotteryInventoryBook.item ?? null;
  useRouteTabItemLabel(
    detail === null
      ? null
      : t("book.tabLabel", {
          key: displayBookKey(detail.book.gameCode, detail.book.bookNo),
        }),
    "view",
  );

  if (query.isLoading) {
    return <CircularProgress aria-label={t("book.loading")} />;
  }
  if (detail === null) {
    return (
      <Alert severity="error">
        {t(
          `errors.${query.error === null ? "NOT_FOUND" : inventoryErrorOf(query.error).code}`,
        )}
      </Alert>
    );
  }

  const { book, abilities } = detail;
  const selectedTickets: Ticket[] = detail.tickets.filter((ticket) =>
    selected.includes(ticket.ticketNo),
  );
  const actions = selectionActionsOf(selectedTickets);
  const missingTickets = detail.tickets.filter(
    (ticket) => ticket.status === "investigating" || ticket.status === "lost",
  );
  const clearSelection = () => {
    setSelected([]);
  };
  const recoverTickets =
    dialog === "recoverAll" ? missingTickets : selectedTickets;

  return (
    <Stack
      spacing={2}
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        pb: 2,
        "& > *": { flexShrink: 0 },
      }}
    >
      <BookHeader
        detail={detail}
        canRecoverAll={abilities.canRecover}
        onCorrect={() => {
          setDialog("correct");
        }}
        onRecoverAll={() => {
          setDialog("recoverAll");
        }}
      />
      <BookInfoCards detail={detail} />

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="subtitle1" color="text.primary">
          {t("book.grid")}
        </Typography>
        <SelectionBar
          tickets={selectedTickets}
          canScrap={actions.canScrap && abilities.canScrap}
          canRecover={actions.canRecover && abilities.canRecover}
          onScrap={() => {
            setDialog("scrap");
          }}
          onRecover={() => {
            setDialog("recover");
          }}
          onClear={clearSelection}
        />
        <Box sx={{ mt: 1.5, maxWidth: 640 }}>
          <TicketGrid
            cells={bookCellsOf(detail.tickets)}
            selectableStates={BOOK_SELECTABLE}
            selected={selected}
            onSelectedChange={setSelected}
            legendItems={BOOK_LEGEND}
            summary={false}
          />
        </Box>
      </Card>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="subtitle1" color="text.primary" sx={{ mb: 1.5 }}>
          {t("book.timeline")}
        </Typography>
        <BookTimeline events={detail.events} />
      </Card>

      {dialog === "correct" ? (
        <CorrectSkipsDialog
          detail={detail}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "scrap" ? (
        <ScrapTicketsDialog
          detail={detail}
          tickets={selectedTickets}
          onClose={() => {
            setDialog(null);
          }}
          onScrapped={clearSelection}
        />
      ) : null}
      {dialog === "recover" || dialog === "recoverAll" ? (
        <RecoverTicketDialog
          book={book}
          tickets={recoverTickets}
          onClose={() => {
            setDialog(null);
          }}
          onRecovered={clearSelection}
        />
      ) : null}
    </Stack>
  );
};
