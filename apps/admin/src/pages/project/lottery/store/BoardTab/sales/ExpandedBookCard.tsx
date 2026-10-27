import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import {
  INVENTORY_MODULE_KEYS,
  INVENTORY_PERMISSIONS,
  STORE_PERMISSIONS,
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import {
  type LotteryStoreBoardBookFieldsFragment,
  useLotteryStoreBookCardQuery,
  useSellLotteryTicketsMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import { useMe } from "@/hooks/base/useMe";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { CounterMoveDialog, ManualSaleDialog } from "./CounterActionDialogs";
import {
  type CardAction,
  type CardDialog,
  type ExpandedCashPoint,
  actionsOf,
  cellStateOf,
  legendOf,
  toCounter,
} from "./card-cells";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

export interface ExpandedBookCardProps {
  orgId: string;
  /** 看的那家店的名稱(尋回「回到 …」) */
  storeName: string;
  book: LotteryStoreBoardBookFieldsFragment;
  point: ExpandedCashPoint;
  /** 卡片在本機收銀點 */
  isLocal: boolean;
  /** 本機收銀點(移櫃並售出算到它);沒設定或沒開班 = null */
  local: { id: string; name: string } | null;
  /** 這家店的收銀點(移櫃的目的地) */
  cashPoints: readonly { id: string; name: string }[];
  /** 刷到這本的哪一張(那一格閃一下);`nonce` 讓同一張再刷也會閃 */
  flash: { ticketNo: string; nonce: number } | null;
  onClose: () => void;
  onUndo: (ticketId: string) => void;
}

/**
 * 看板卡片原地展開(Figma ST-36a 本機收銀點選未售、36b 選本班售出、36c 其他收銀點;規格 6.2):
 * 頁首(遊戲、本號、剩餘 / 總張數、[本的詳情] [收合])、共用圖例、`TicketGrid`(在別的收銀點的張不能選,
 * 收銀點名稱用 tooltip);選張後操作列「已選 N 張 #…」+ 依狀態與所屬收銀點的按鈕。電腦 / 平板在卡片
 * 下方占滿整列(主色框),手機用底部面板。刷到這本的張時那一格閃一下。
 */
export const ExpandedBookCard = ({
  orgId,
  storeName,
  book,
  point,
  isLocal,
  local,
  cashPoints,
  flash,
  onClose,
  onUndo,
}: ExpandedBookCardProps) => {
  const { t, clock, errorText } = useSalesText();
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const me = useMe();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const card = useLotteryStoreBookCardQuery(session.client, {
    orgId,
    bookId: book.bookId,
  }).data?.lotteryStoreBookCard.item;
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<CardDialog>(null);
  const moveAndSell = useSellLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("expand.moveAndSellSuccess"),
      error: errorText,
      onSuccess: () => {
        setSelected([]);
        refresh();
      },
    }),
  );
  const bookRoute =
    me.data?.me.modules.find(
      (module) => module.key === INVENTORY_MODULE_KEYS.bookPage,
    )?.route ?? null;

  const tickets = card?.tickets ?? [];
  const cells: TicketGridCell[] = tickets.map((ticket) => {
    const state = cellStateOf(ticket, point);
    let tooltip: string | undefined;
    if (state === "otherCashPoint") {
      tooltip =
        ticket.cashPoint == null
          ? t("expand.inStock")
          : t("expand.atCashPoint", { name: ticket.cashPoint.name });
    }
    return { ticketNo: ticket.ticketNo, state, ...(tooltip && { tooltip }) };
  });
  const stateByNo = new Map(cells.map((cell) => [cell.ticketNo, cell.state]));
  const picked = tickets.filter((ticket) => selected.includes(ticket.ticketNo));
  const states = new Set(
    picked.map((ticket) => stateByNo.get(ticket.ticketNo) ?? "sold"),
  );
  const can = (action: CardAction): boolean => {
    switch (action) {
      case "markSold": {
        return hasPermission(STORE_PERMISSIONS.sell) && point.shift != null;
      }
      case "move":
      case "recall": {
        return hasPermission(STORE_PERMISSIONS.move);
      }
      case "moveAndSell": {
        return (
          hasPermission(STORE_PERMISSIONS.move) &&
          hasPermission(STORE_PERMISSIONS.sell) &&
          local !== null
        );
      }
      case "undoSale": {
        return hasPermission(STORE_PERMISSIONS.undoSale);
      }
      case "recover": {
        return hasPermission(INVENTORY_PERMISSIONS.recover);
      }
    }
  };
  const actions = actionsOf(states, picked.length, isLocal, can);
  const onCounter = tickets.filter(
    (ticket) => cellStateOf(ticket, point) === "unsold",
  );
  const run = (action: CardAction) => {
    switch (action) {
      case "markSold":
      case "move":
      case "recall":
      case "recover": {
        setDialog({
          kind: action === "markSold" ? "manual" : action,
          tickets: picked,
        });
        return;
      }
      case "undoSale": {
        const first = picked.at(0);
        if (first !== undefined) {
          onUndo(first.id);
        }
        return;
      }
      case "moveAndSell": {
        if (local === null) {
          return;
        }
        moveAndSell.mutate({
          input: {
            orgId,
            localCashPointId: local.id,
            tickets: picked.map((ticket) => ({
              ticketId: ticket.id,
              version: ticket.version,
            })),
            source: "scan",
            confirmMove: true,
          },
        });
      }
    }
  };
  const actionLabels: Record<CardAction, string> = {
    markSold: t("expand.markSold"),
    move: t("expand.move"),
    recall: t("expand.recall"),
    undoSale: t("expand.undoSale"),
    recover: t("expand.recover"),
    moveAndSell: t("expand.moveAndSell"),
  };
  const counterBook = {
    gameCode: book.gameCode,
    gameName: book.gameName,
    unitPrice: book.unitPrice,
    bookNo: book.bookNo,
  };
  const done = () => {
    setDialog(null);
    setSelected([]);
  };

  let dialogElement: ReactNode = null;
  if (dialog?.kind === "manual" && point.shift) {
    dialogElement = (
      <ManualSaleDialog
        orgId={orgId}
        localCashPointId={point.id}
        cashPointName={point.name}
        cashPointText={t("manualSale.cashPointValue", {
          name: point.name,
          owner: point.shift.openedBy.name,
          time: clock(point.shift.openedAt),
        })}
        book={counterBook}
        tickets={toCounter(dialog.tickets)}
        onClose={() => {
          setDialog(null);
        }}
        onDone={done}
      />
    );
  } else if (dialog?.kind === "move" || dialog?.kind === "recall") {
    dialogElement = (
      <CounterMoveDialog
        kind={dialog.kind}
        orgId={orgId}
        book={counterBook}
        cashPointId={point.id}
        cashPointName={point.name}
        all={toCounter(onCounter)}
        selected={toCounter(dialog.tickets)}
        cashPoints={cashPoints}
        onClose={() => {
          setDialog(null);
        }}
        onDone={done}
      />
    );
  } else if (dialog?.kind === "recover") {
    dialogElement = (
      <RecoverTicketDialog
        book={counterBook}
        tickets={dialog.tickets.map((ticket) => ({
          id: ticket.id,
          version: ticket.version,
          ticketNo: ticket.ticketNo,
          status: ticket.status,
          orgName: storeName,
        }))}
        // 展開卡片是在格子上點選,不是刷到實體:不換店(檯面上的張本來就在這家店)
        keepStore
        onClose={() => {
          setDialog(null);
        }}
        onRecovered={() => {
          setSelected([]);
          refresh();
        }}
      />
    );
  }

  const content = (
    <Stack spacing={1.5}>
      {picked.length > 0 ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{
            bgcolor: "primary.lighter",
            borderRadius: 1,
            px: 2,
            py: 1,
            alignItems: { sm: "center" },
          }}
        >
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {t("expand.selected", {
              count: picked.length,
              ranges: formatTicketRanges(selected),
            })}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {actions.map((action, index) => (
              <Button
                key={action}
                size="small"
                variant={index === 0 ? "contained" : "outlined"}
                disabled={moveAndSell.isPending}
                onClick={() => {
                  run(action);
                }}
              >
                {actionLabels[action]}
              </Button>
            ))}
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setSelected([]);
              }}
            >
              {t("expand.clear")}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      <TicketGrid
        cells={cells}
        selectableStates={
          isLocal ? ["unsold", "soldThisShift", "lost"] : ["unsold"]
        }
        selected={selected}
        onSelectedChange={setSelected}
        legendItems={legendOf(tickets)}
        quickSelect={false}
        summary={false}
        {...(flash && { flash })}
      />
    </Stack>
  );

  const title = t("expand.title", {
    code: book.gameCode,
    name: book.gameName,
    bookNo: displayBookNo(book.bookNo),
  });
  const meta = t("expand.meta", {
    cashPoint: point.name,
    price: moneyText(book.unitPrice),
    remaining: book.remaining,
    total: book.total,
  });
  const detailButton =
    bookRoute === null ? null : (
      <Button
        size="small"
        variant="outlined"
        onClick={() => {
          void navigate(`${bookRoute}/${book.bookId}`);
        }}
      >
        {t("expand.bookDetail")}
      </Button>
    );

  if (isMobile) {
    return (
      <>
        <Drawer
          open
          anchor="bottom"
          title={title}
          closeLabel={t("expand.close")}
          onClose={onClose}
        >
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="body2" color="textSecondary">
                {meta}
              </Typography>
              {detailButton}
            </Stack>
            {content}
          </Stack>
        </Drawer>
        {dialogElement}
      </>
    );
  }
  return (
    <Card
      variant="outlined"
      aria-label={title}
      sx={{
        gridColumn: "1 / -1",
        borderColor: "primary.main",
        borderWidth: 2,
        p: 2,
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h4">
            {title}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {meta}
          </Typography>
        </Box>
        {detailButton}
        <Button size="small" variant="text" onClick={onClose}>
          {t("expand.collapse")}
        </Button>
      </Stack>
      {content}
      {dialogElement}
    </Card>
  );
};
