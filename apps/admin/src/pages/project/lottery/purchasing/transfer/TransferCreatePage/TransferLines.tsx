import { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { formatMoney } from "../transfer-keys";
import {
  type TransferDraftLine,
  bookLabelOf,
  lineAmountOf,
  linePurchaseAmountOf,
  lineTicketsOf,
} from "./transfer-form";

export interface TransferLinesProps {
  lines: readonly TransferDraftLine[];
  /** 平板 / 手機改卡片 */
  isCompact: boolean;
  onRate: (rowId: string, rate: number) => void;
  onRemove: (rowId: string) => void;
}

/** 批購金額率輸入:整數 0–100;其他值不改。 */
const parseRate = (raw: string): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
};

/**
 * 調貨單新增頁的明細(規格 8.4 明細;Figma PU-09):遊戲、本、方式、張號、張數、金額、批購金額率(可逐本改)、
 * 批購金額;電腦表格、平板 / 手機卡片。
 */
export const TransferLines = ({
  lines,
  isCompact,
  onRate,
  onRemove,
}: TransferLinesProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const modeText = (line: TransferDraftLine) =>
    line.mode === TRANSFER_MODE.whole ? t("modes.whole") : t("modes.partial");
  const ticketsText = (line: TransferDraftLine) =>
    line.mode === TRANSFER_MODE.whole
      ? t("wholeRange", { count: lineTicketsOf(line) })
      : formatTicketRanges(line.ticketNos);
  const rateField = (line: TransferDraftLine) => (
    <TextField
      size="small"
      value={String(line.rate)}
      onChange={(event) => {
        const rate = parseRate(event.target.value);
        if (rate !== null) {
          onRate(line.rowId, rate);
        }
      }}
      sx={{ width: 72 }}
      slotProps={{
        htmlInput: {
          inputMode: "numeric",
          "aria-label": t("rateOf", { book: bookLabelOf(line.book) }),
        },
      }}
    />
  );
  const removeButton = (line: TransferDraftLine) => (
    <Button
      variant="text"
      size="small"
      color="error"
      aria-label={t("removeOf", { book: bookLabelOf(line.book) })}
      onClick={() => {
        onRemove(line.rowId);
      }}
    >
      {t("remove")}
    </Button>
  );

  if (lines.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("noLines")}
      </Typography>
    );
  }

  if (isCompact) {
    return (
      <Stack spacing={1}>
        {lines.map((line) => (
          <Card key={line.rowId} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {`${line.book.gameCode} ${line.book.gameName} · ${bookLabelOf(line.book)}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("cardFacts", {
                    mode: modeText(line),
                    tickets: ticketsText(line),
                    count: lineTicketsOf(line),
                    amount: formatMoney(lineAmountOf(line)),
                    purchase: formatMoney(linePurchaseAmountOf(line)),
                  })}
                </Typography>
              </Box>
              {rateField(line)}
              {removeButton(line)}
            </Stack>
          </Card>
        ))}
      </Stack>
    );
  }

  const columns: TableColumn<TransferDraftLine>[] = [
    {
      key: "game",
      header: t("columns.game"),
      render: (line) => `${line.book.gameCode} ${line.book.gameName}`,
    },
    {
      key: "book",
      header: t("columns.book"),
      render: (line) => bookLabelOf(line.book),
      isEmphasized: true,
    },
    { key: "mode", header: t("columns.mode"), render: modeText },
    { key: "ticketNos", header: t("columns.ticketNos"), render: ticketsText },
    {
      key: "tickets",
      header: t("columns.tickets"),
      align: "right",
      render: (line) => formatMoney(lineTicketsOf(line)),
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "right",
      render: (line) => formatMoney(lineAmountOf(line)),
    },
    { key: "rate", header: t("columns.rate"), render: rateField },
    {
      key: "purchaseAmount",
      header: t("columns.purchaseAmount"),
      align: "right",
      render: (line) => formatMoney(linePurchaseAmountOf(line)),
    },
    { key: "remove", header: "", render: removeButton },
  ];
  return (
    <Table
      aria-label={t("linesAria")}
      size="small"
      columns={columns}
      rows={lines}
      getRowKey={(line) => line.rowId}
      minWidth={760}
      containerSx={{ height: "auto" }}
    />
  );
};
