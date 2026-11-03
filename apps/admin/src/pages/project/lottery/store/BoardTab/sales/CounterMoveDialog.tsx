import { useState } from "react";

import {
  STORE_COUNTER_SCAN_PURPOSE,
  displayBookNo,
  normalizeBookNo,
  parseTicketInput,
} from "@repo/domain/project/lottery";
import {
  useMoveLotteryTicketsMutation,
  useRecallLotteryTicketsMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import type { CounterBook, CounterTicket } from "./CounterActionDialogs";
import { rangesOf } from "./card-cells";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

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
 * 移櫃 / 收回到庫存(Figma ST-10b / 10a、ST-10-2a / 2b;規格 6.4,`store.move`):全部(這個收銀點檯面上這本未售的張)
 * 或部分張數(格子選的,也可以刷條碼或手輸張號加進來:兩種店共用的改動,張數店規格 13.4);移櫃選移到哪個收銀點。
 * 一律寫「移櫃」/「收回」事件,不需審核。開著時宣告掃描用途 `store-counter-move`(刷到的張加進部分張數)。
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
  const [scanned, setScanned] = useState<CounterTicket[]>([]);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const partial = [
    ...selected,
    ...scanned.filter(
      (ticket) => !selected.some((one) => one.ticketNo === ticket.ticketNo),
    ),
  ];
  const tickets = scope === "all" ? all : partial;
  /** 刷到或手輸的張:要是這個收銀點檯面上這本未售的張,加進部分張數。 */
  const addCode = (raw: string) => {
    const parsed = parseTicketInput(raw);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    const ticket =
      parsed === null || bookNo !== book.bookNo
        ? undefined
        : all.find((one) => one.ticketNo === parsed.ticketNo);
    if (ticket === undefined) {
      setCodeError(
        parsed === null
          ? t("move.codeInvalid")
          : t("move.codeNotHere", {
              ticketNo: parsed.ticketNo,
              cashPoint: cashPointName,
            }),
      );
      return;
    }
    setScanned((current) =>
      current.some((one) => one.id === ticket.id)
        ? current
        : [...current, ticket],
    );
    setScope("partial");
    setCode("");
    setCodeError(null);
  };
  useScanner(STORE_COUNTER_SCAN_PURPOSE, ({ code: value }) => {
    addCode(value);
  });
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
            disabled={partial.length === 0}
            control={<Radio />}
            label={
              isMove
                ? t("move.partial", { count: partial.length })
                : t("recall.partial", { count: partial.length })
            }
          />
        </RadioGroup>
        <TextField
          label={t("move.code")}
          slotProps={{
            htmlInput: { "data-scanner-field": STORE_COUNTER_SCAN_PURPOSE },
          }}
          size="small"
          value={code}
          error={codeError !== null}
          helperText={codeError ?? undefined}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCode(code);
            }
          }}
        />
      </Stack>
    </Dialog>
  );
};
