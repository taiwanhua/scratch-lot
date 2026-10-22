import { useState } from "react";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import {
  LOTTERY_FIELD_CATEGORY_KEYS,
  MANUAL_SALE_SCAN_FAILED,
} from "@repo/domain/project/lottery-fields";
import {
  useMoveLotteryTicketsMutation,
  useRecallLotteryTicketsMutation,
  useSellLotteryTicketsMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import {
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

/** 選到的一張(條件更新用的版本)。 */
export interface CounterTicket {
  id: string;
  version: number;
  ticketNo: string;
}

/** 卡片的本(視窗上方的灰底區塊)。 */
export interface CounterBook {
  gameCode: string;
  gameName: string;
  unitPrice: number;
  bookNo: string;
}

const BookBox = ({ book, line }: { book: CounterBook; line: string }) => {
  const { t } = useSalesText();
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="subtitle1" color="textPrimary">
          {book.gameCode} {book.gameName}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {t("card.price", { price: moneyText(book.unitPrice) })}
        </Typography>
      </Stack>
      <Typography variant="body2" color="textSecondary">
        {line}
      </Typography>
    </Box>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
    <Typography variant="body2" color="textSecondary">
      {label}
    </Typography>
    <Typography variant="body1" sx={{ textAlign: "right" }}>
      {value}
    </Typography>
  </Stack>
);

const rangesOf = (tickets: readonly CounterTicket[]) =>
  formatTicketRanges(tickets.map((ticket) => ticket.ticketNo));

export interface ManualSaleDialogProps {
  orgId: string;
  localCashPointId: string;
  /** 「店內櫃台(王小明 08:02 開的班)」 */
  cashPointText: string;
  cashPointName: string;
  book: CounterBook;
  tickets: readonly CounterTicket[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * 手動標記售出(Figma ST-07;規格 6.3「手動標記」):選了哪幾張、單張金額、合計、原因(必選,
 * 欄位管理「手動標記原因」,預設「刷不到條碼」);手機全螢幕。錢算本機收銀點這一班。
 */
export const ManualSaleDialog = ({
  orgId,
  localCashPointId,
  cashPointText,
  cashPointName,
  book,
  tickets,
  onClose,
  onDone,
}: ManualSaleDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>({
    reasonKey: MANUAL_SALE_SCAN_FAILED,
    reasonNote: "",
  });
  const [invalid, setInvalid] = useState<string[]>([]);
  const total = book.unitPrice * tickets.length;
  const sell = useSellLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("manualSale.success", { count: tickets.length }),
      error: errorText,
      onSuccess: () => {
        refresh();
        onDone();
      },
    }),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={t("manualSale.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={sell.isPending}
            onClick={() => {
              const missing = missingReasonFields(reason);
              setInvalid(missing);
              if (missing.length > 0) {
                return;
              }
              sell.mutate({
                input: {
                  orgId,
                  localCashPointId,
                  tickets: tickets.map((ticket) => ({
                    ticketId: ticket.id,
                    version: ticket.version,
                  })),
                  source: "manual",
                  ...reasonInputOf(reason),
                },
              });
            }}
          >
            {t("manualSale.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="textSecondary">
          {t("manualSale.book", {
            code: book.gameCode,
            name: book.gameName,
            bookNo: displayBookNo(book.bookNo),
          })}
        </Typography>
        <Row label={t("manualSale.cashPoint")} value={cashPointText} />
        <Row
          label={t("manualSale.tickets")}
          value={t("manualSale.ticketsValue", {
            ranges: rangesOf(tickets),
            count: tickets.length,
          })}
        />
        <Row
          label={t("manualSale.unitPrice")}
          value={t("card.price", { price: moneyText(book.unitPrice) })}
        />
        <Row
          label={t("manualSale.total")}
          value={t("card.price", { price: moneyText(total) })}
        />
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason}
          label={t("manualSale.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <Typography variant="body2" color="textSecondary">
          {t("manualSale.hint", {
            name: cashPointName,
            amount: moneyText(total),
          })}
        </Typography>
      </Stack>
    </Dialog>
  );
};

export interface CounterMoveDialogProps {
  kind: "move" | "recall";
  orgId: string;
  book: CounterBook;
  /** 卡片所在的收銀點 */
  cashPointId: string;
  cashPointName: string;
  /** 這個收銀點檯面上這本全部未售的張(「全部」) */
  all: readonly CounterTicket[];
  /** 格子裡選的張(「部分張數」) */
  selected: readonly CounterTicket[];
  /** 這家店的收銀點(移到哪裡) */
  cashPoints: readonly { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * 移櫃 / 收回到庫存(Figma ST-10b / 10a;規格 6.4,`store.move`):全部(這個收銀點檯面上這本未售的張)
 * 或部分張數(格子選的);移櫃選移到哪個收銀點。一律寫「移櫃」/「收回」事件,不需審核。
 */
export const CounterMoveDialog = ({
  kind,
  orgId,
  book,
  cashPointId,
  cashPointName,
  all,
  selected,
  cashPoints,
  onClose,
  onDone,
}: CounterMoveDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const targets = cashPoints.filter((point) => point.id !== cashPointId);
  const [scope, setScope] = useState<"all" | "partial">("all");
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const tickets = scope === "all" ? all : selected;
  const feedback = {
    error: errorText,
    onSuccess: () => {
      refresh();
      onDone();
    },
  };
  const move = useMoveLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      ...feedback,
      success: t("move.success", { count: tickets.length }),
    }),
  );
  const recall = useRecallLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      ...feedback,
      success: t("recall.success", { count: tickets.length }),
    }),
  );
  const refs = tickets.map((ticket) => ({
    ticketId: ticket.id,
    version: ticket.version,
  }));
  const busy = move.isPending || recall.isPending;
  const isMove = kind === "move";
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={isMove ? t("move.title") : t("recall.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={busy || tickets.length === 0 || (isMove && to === "")}
            onClick={() => {
              if (isMove) {
                move.mutate({
                  input: { orgId, tickets: refs, toCashPointId: to },
                });
              } else {
                recall.mutate({ input: { orgId, tickets: refs } });
              }
            }}
          >
            {isMove ? t("move.submit") : t("recall.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <BookBox
          book={book}
          line={t("move.line", {
            bookNo: displayBookNo(book.bookNo),
            ranges: rangesOf(all),
            cashPoint: cashPointName,
            count: all.length,
          })}
        />
        {isMove ? (
          <SelectField
            label={t("move.to")}
            value={to}
            fullWidth
            options={targets.map((point) => ({
              value: point.id,
              label: point.name,
            }))}
            onChange={(value: string) => {
              setTo(value);
            }}
          />
        ) : null}
        <RadioGroup
          value={scope}
          onChange={(event) => {
            setScope(event.target.value === "partial" ? "partial" : "all");
          }}
        >
          <FormControlLabel
            value="all"
            control={<Radio />}
            label={
              isMove
                ? t("move.all", { count: all.length })
                : t("recall.all", { count: all.length })
            }
          />
          <FormControlLabel
            value="partial"
            disabled={selected.length === 0}
            control={<Radio />}
            label={
              isMove
                ? t("move.partial", { count: selected.length })
                : t("recall.partial", { count: selected.length })
            }
          />
        </RadioGroup>
      </Stack>
    </Dialog>
  );
};
