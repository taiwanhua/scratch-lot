import { useState } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import type {
  SheetCashPoint,
  StocktakeReview,
  StocktakeSheet,
  StocktakeState,
} from "./stocktake-model";

interface CashPointRow {
  point: SheetCashPoint;
  count: number;
  amount: number;
}

export interface StocktakeSubmitDialogProps {
  open: boolean;
  scopeLabel: string;
  sheet: StocktakeSheet;
  review: StocktakeReview;
  state: StocktakeState;
  /** 還沒盤的本數(沒盤的本不比對) */
  uncounted: number;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}

/**
 * 送出盤點?(規格 6.8、8.6;Figma ST-15):各收銀點的補登售出與應有現金(已結帳 → 事後更正)、
 * 新增待查、標記異常、未拆的本不在、確認遺失;[送出盤點確認申請] 建立盤點單(待核准)並送出申請。
 */
export const StocktakeSubmitDialog = ({
  open,
  scopeLabel,
  sheet,
  review,
  state,
  uncounted,
  isPending,
  error,
  onClose,
  onConfirm,
}: StocktakeSubmitDialogProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.submit");
  const temporal = useTemporalText();
  const [note, setNote] = useState("");
  const rows: CashPointRow[] = sheet.cashPoints.flatMap((point) => {
    const backfilled = review.lines
      .filter((line) => line.cashPointId === point.id)
      .flatMap((line) =>
        line.diffs.filter((diff) => diff.backfilled).map(() => line.unitPrice),
      );
    return backfilled.length === 0
      ? []
      : [
          {
            point,
            count: backfilled.length,
            amount: backfilled.reduce((sum, value) => sum + value, 0),
          },
        ];
  });
  const shiftText = (point: SheetCashPoint) => {
    const shift = point.shift ?? point.lastShift;
    if (shift == null) {
      return point.name;
    }
    const time = temporal(shift.openedAt, "monthDayTime").split(" ").at(-1);
    return `${point.name} · ${
      shift.closed
        ? t("shiftClosed", { name: shift.ownerName, time: time ?? "" })
        : t("shiftOpen", { name: shift.ownerName, time: time ?? "" })
    }`;
  };
  const columns: TableColumn<CashPointRow>[] = [
    {
      key: "point",
      header: t("cashPoint"),
      render: (row) => shiftText(row.point),
    },
    {
      key: "count",
      header: t("backfill"),
      align: "right",
      render: (row) => t("count", { count: row.count }),
    },
    {
      key: "expected",
      header: t("expected"),
      align: "right",
      render: (row) =>
        row.point.shift == null
          ? t("postClose", { amount: moneyText(row.amount) })
          : moneyText(row.point.shift.expectedCash ?? 0),
    },
  ];
  const investigated = review.lines.flatMap((line) =>
    line.diffs
      .filter(
        (diff) =>
          state.diffs[`${line.bookId}:${line.cashPointId}#${diff.ticketNo}`]
            ?.action === "investigate",
      )
      .map((diff) => `#${diff.ticketNo}`),
  );
  const flagged = review.lines.flatMap((line) =>
    line.diffs
      .filter(
        (diff) =>
          state.diffs[`${line.bookId}:${line.cashPointId}#${diff.ticketNo}`]
            ?.action === "flag",
      )
      .map((diff) => `#${diff.ticketNo}`),
  );
  const absentBooks = sheet.unopenedBooks.filter(
    (book) => state.unopened[book.bookId] === false,
  );
  const summary = review.summary;
  const facts: [string, string][] = [
    [
      t("newInvestigate"),
      investigated.length === 0
        ? t("count", { count: 0 })
        : `${t("count", { count: investigated.length })}(${investigated.join("、")})`,
    ],
    [
      t("flagged"),
      flagged.length === 0
        ? t("count", { count: 0 })
        : `${t("count", { count: flagged.length })}(${flagged.join("、")})`,
    ],
    [
      t("unopenedAbsent"),
      absentBooks.length === 0
        ? t("books", { count: 0 })
        : `${t("books", { count: absentBooks.length })}(${absentBooks
            .map((book) => displayBookNo(book.bookNo))
            .join("、")})`,
    ],
    [
      t("confirmLost"),
      summary.confirmLostCost == null
        ? t("count", { count: summary.confirmLost })
        : t("lostCost", {
            count: summary.confirmLost,
            cost: moneyText(summary.confirmLostCost),
          }),
    ],
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <span>{t("title")}</span>
          <Typography variant="body2" color="text.secondary">
            {scopeLabel}
          </Typography>
        </Stack>
      }
      actions={
        <Stack
          direction="row"
          sx={{ width: "100%", justifyContent: "space-between" }}
        >
          <Button variant="text" onClick={onClose}>
            {t("back")}
          </Button>
          <Button
            variant="contained"
            disabled={isPending}
            onClick={() => {
              onConfirm(note);
            }}
          >
            {t("confirm")}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2">{t("hint")}</Typography>
        {uncounted > 0 ? (
          <Alert severity="warning">
            {t("uncounted", { count: uncounted })}
          </Alert>
        ) : null}
        {rows.length > 0 ? (
          <Table
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.point.id}
            size="small"
            containerSx={{ height: "auto" }}
          />
        ) : null}
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 3,
            rowGap: 1,
            m: 0,
          }}
        >
          {facts.map(([label, value]) => (
            <Box key={label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="body2"
                sx={{ m: 0, textAlign: "right", color: "text.primary" }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        <TextField
          label={t("note")}
          size="small"
          fullWidth
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        {error === null ? null : <Alert severity="error">{error}</Alert>}
      </Stack>
    </Dialog>
  );
};
