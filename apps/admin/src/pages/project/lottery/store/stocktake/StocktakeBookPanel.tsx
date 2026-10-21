import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_SCAN_PURPOSE,
  type StocktakeMethod,
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import { type BookCount, type SheetBook, figuresOf } from "./stocktake-model";

export interface StocktakeBookPanelProps {
  book: SheetBook;
  cashPointName: string;
  count: BookCount | undefined;
  /** 這本開始盤的時間(系統數字是那一刻的) */
  countedAt: string;
  onChange: (count: Pick<BookCount, "method" | "present">) => void;
  /** 掃描模式:刷到 / 輸入的碼(交給頁面解析) */
  onCode: (code: string) => void;
  onPrev: (() => void) | null;
  onNext: () => void;
}

/**
 * 盤點頁右欄:選中的本(規格 6.8;Figma ST-13):方式切換(點格子 / 掃描,不用數量)、張數格子(已選 = 在)、
 * 系統數字(開始盤這本那一刻)、實盤數、差異張數;[上一本] [下一本]。
 */
export const StocktakeBookPanel = ({
  book,
  cashPointName,
  count,
  countedAt,
  onChange,
  onCode,
  onPrev,
  onNext,
}: StocktakeBookPanelProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.book");
  const temporal = useTemporalText();
  const [code, setCode] = useState("");
  const method: StocktakeMethod = count?.method ?? "grid";
  const present = count?.present ?? [];
  const figures = figuresOf(book, count ?? { countedAt, method, present: [] });
  const cells: TicketGridCell[] = book.tickets.map((ticket) => ({
    ticketNo: ticket.ticketNo,
    state: ticket.status === "unsold" ? "unsold" : "sold",
    ...(ticket.pendingReversal && { tooltip: t("pendingReversal") }),
  }));
  const time = temporal(countedAt, "monthDayTime").split(" ").at(-1) ?? "";
  const systemRange =
    figures.systemNos.length === 0
      ? t("none")
      : `${t("tickets", { count: figures.systemNos.length })} · ${formatTicketRanges(figures.systemNos)}`;
  const submitCode = () => {
    const trimmed = code.trim();
    if (trimmed !== "") {
      onCode(trimmed);
      setCode("");
    }
  };

  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ flex: 1, alignItems: "baseline", flexWrap: "wrap" }}
          >
            <Typography variant="subtitle1" component="h2">
              {t("title", {
                game: `${book.gameCode} ${book.gameName}`,
                bookNo: displayBookNo(book.bookNo),
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("meta", {
                cashPoint: cashPointName,
                price: moneyText(book.unitPrice),
              })}
            </Typography>
          </Stack>
          <SegmentedControl
            aria-label={t("methodAria")}
            value={method}
            options={[
              { value: "grid", label: t("grid") },
              { value: "scan", label: t("scan") },
            ]}
            onChange={(next) => {
              onChange({ method: next, present });
            }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t("hint")}
        </Typography>
        {method === "scan" ? (
          <TextField
            label={t("scanField")}
            size="small"
            value={code}
            helperText={t("scanHint")}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitCode();
              }
            }}
            sx={{ width: { xs: "100%", sm: 320 } }}
            slotProps={{
              htmlInput: { "data-scanner-field": STOCKTAKE_SCAN_PURPOSE },
            }}
          />
        ) : null}
        <TicketGrid
          cells={cells}
          selectableStates={["unsold", "sold"]}
          selected={present}
          onSelectedChange={(next) => {
            onChange({ method, present: next });
          }}
          legendItems={["unsold", "sold", "selected"]}
          labels={{ selected: t("legendSelected") }}
          summary={false}
        />
        <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap" }}>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              {t("system", { time })}
            </Typography>
            <Typography variant="subtitle1">{systemRange}</Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              {t("present")}
            </Typography>
            <Typography variant="subtitle1">
              {t("tickets", { count: figures.presentCount })}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              {t("diff")}
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{
                color: figures.diffNos.length > 0 ? "warning.dark" : undefined,
              }}
            >
              {figures.diffNos.length === 0
                ? t("tickets", { count: 0 })
                : `${t("tickets", { count: figures.diffNos.length })}:${formatTicketRanges(figures.diffNos)}`}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          {onPrev === null ? (
            <span />
          ) : (
            <Button variant="text" onClick={onPrev}>
              {t("prev")}
            </Button>
          )}
          <Button variant="contained" onClick={onNext}>
            {t("next")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
