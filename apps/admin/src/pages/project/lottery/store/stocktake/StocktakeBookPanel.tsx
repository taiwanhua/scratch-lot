import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_SCAN_PURPOSE,
  type StocktakeMethod,
  displayBookNo,
  formatTicketRanges,
  isStocktakeStockLine,
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
  /** [上一本]:第一本 = null(停用、不隱藏;張數店規格 13.3) */
  onPrev: (() => void) | null;
  /** [下一本]:記成已盤後跳到下一本還沒盤的 */
  onNext: () => void;
  /** 其他的本都盤完了:[下一本] 改成 [盤完,前往差異核對] */
  nextIsReview?: boolean;
  /**
   * 補點編號(張數店規格 9.3、13.2;Figma CS-11):未對號的格子虛線、可以點(實際在 = 已選),圖例「虛線 = 系統預設帶入的張號」;
   * 比對時先自動對號,不算差異。
   */
  renumber?: boolean;
}

/** 盤點說明:補點編號 / 庫存那一區 / 檯面。 */
const hintKeyOf = (renumber: boolean, cashPointId: string) => {
  if (renumber) {
    return "hintRenumber";
  }
  return isStocktakeStockLine(cashPointId) ? "hintStock" : "hint";
};

/** 補點編號的格子狀態:已售·未對號 / 待查·遺失·未對號(虛線)、未售、已售。 */
const cellStateOf = (ticket: SheetBook["tickets"][number]) => {
  if (ticket.unmatched) {
    return ticket.status === "sold" ? "unmatchedSold" : "unmatchedLost";
  }
  return ticket.status === "unsold" ? "unsold" : "sold";
};

/**
 * 盤點頁右欄:選中的本(規格 6.8;Figma ST-13):方式切換(點格子 / 掃描,不用數量)、張數格子(已選 = 在)、
 * 系統數字(開始盤這本那一刻)、實盤數、差異張數;[上一本] [下一本](13.3:[上一本] 外框按鈕、第一本停用、位置固定;
 * 最後一本是 [盤完,前往差異核對];Figma ST-13-3a / 3b)。
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
  nextIsReview = false,
  renumber = false,
}: StocktakeBookPanelProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.book");
  const temporal = useTemporalText();
  const [code, setCode] = useState("");
  const method: StocktakeMethod = count?.method ?? "grid";
  const present = count?.present ?? [];
  const figures = figuresOf(book, count ?? { countedAt, method, present: [] });
  const cells: TicketGridCell[] = book.tickets.map((ticket) => ({
    ticketNo: ticket.ticketNo,
    state: cellStateOf(ticket),
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
    <Card sx={{ px: { xs: 1.5, sm: 3 }, py: 2.5 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              flex: 1,
              minWidth: 0,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <Typography variant="subtitle1" component="h2">
              {t("title", {
                game: `${book.gameCode} ${book.gameName}`,
                bookNo: displayBookNo(book.bookNo),
              })}
            </Typography>
            <Typography variant="body2" color="textSecondary">
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
            sx={{ flexShrink: 0, width: { xs: "100%", sm: 180 } }}
          />
        </Stack>
        <Typography variant="body2" color="textSecondary">
          {t(hintKeyOf(renumber, book.cashPointId))}
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
          selectableStates={
            renumber
              ? ["unsold", "sold", "unmatchedSold", "unmatchedLost"]
              : ["unsold", "sold"]
          }
          selected={present}
          onSelectedChange={(next) => {
            onChange({ method, present: next });
          }}
          legendItems={
            renumber
              ? ["unsold", "sold", "unmatchedSold", "unmatchedLost", "selected"]
              : ["unsold", "sold", "selected"]
          }
          labels={{ selected: t("legendSelected") }}
          {...(renumber && { legendNote: t("legendGuess") })}
          summary={false}
        />
        <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap" }}>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("system", { time })}
            </Typography>
            <Typography variant="subtitle1">{systemRange}</Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("present")}
            </Typography>
            <Typography variant="subtitle1">
              {t("tickets", { count: figures.presentCount })}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="textSecondary">
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
          <Button
            variant="outlined"
            disabled={onPrev === null}
            onClick={() => {
              onPrev?.();
            }}
          >
            {t("prev")}
          </Button>
          <Button variant="contained" onClick={onNext}>
            {nextIsReview ? t("finish") : t("next")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
