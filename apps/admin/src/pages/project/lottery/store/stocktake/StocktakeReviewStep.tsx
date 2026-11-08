import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type StocktakeDiffAction,
  type StocktakeDiffKind,
  displayBookNo,
  formatTicketRanges,
  isStocktakeStockLine,
  stocktakeActionsOf,
} from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../store-text";
import { PendingSkipHint, RenumberMatchesCard } from "./RenumberMatchesCard";
import {
  StocktakeCountReview,
  type StocktakeCountReviewProps,
} from "./StocktakeCountReview";
import { ReviewFooter } from "./StocktakeReviewFooter";
import { reviewTotalsOf } from "./stocktake-count-model";
import {
  type ReviewLine,
  type SheetCashPoint,
  type StocktakeReview,
  type StocktakeState,
  diffKeyOf,
  lineKeyOf,
} from "./stocktake-model";

type ReviewDiff = ReviewLine["diffs"][number];

/** 這一行可用的處理(補點編號且這本還有待標註:不在的張多一個 [標跳號];張數店規格 9.3 第 3 點)。 */
const actionsOf = (line: ReviewLine, kind: string) =>
  stocktakeActionsOf(kind as StocktakeDiffKind, line.cashPointId, {
    pendingSkip: line.pendingSkipCount > 0,
  });

interface Row {
  key: string;
  line: ReviewLine;
  diff: ReviewDiff;
}

export interface StocktakeReviewStepProps {
  review: StocktakeReview | null;
  state: StocktakeState;
  storeName: string;
  cashPoints: readonly SheetCashPoint[];
  /** 有 `store.sell` 才有 [補登售出] */
  canBackfill: boolean;
  isBackfilling: boolean;
  /** 補登售出(立即生效);失敗(已被處理)由頁面提示 */
  onBackfill: (rows: readonly { line: ReviewLine; diff: ReviewDiff }[]) => void;
  /** 待查 / 標記異常(只在畫面上;送出時才寫) */
  onChoose: (keys: readonly string[], action: StocktakeDiffAction) => void;
  onRecount: (line: ReviewLine) => void;
  onBack: () => void;
  onSubmit: () => void;
  /** 頁面上的提示(這幾張已被處理…) */
  notice: string | null;
  /** 有已被處理的張時:[重新核對](拿掉那幾張的處理) */
  onClearStale: (() => void) | null;
  unhandled: number;
  /** 待查清單的處理都填好了(找到了要刷到、確認遺失要原因) */
  lostReady: boolean;
  canSubmit: boolean;
  /** 張數盤點的組(張數店;編號盤點不給) */
  count?: Pick<
    StocktakeCountReviewProps,
    "groups" | "onCountSale" | "onChoose" | "onRecount"
  >;
}

/**
 * 差異核對(規格 6.8;Figma ST-14):依本分組列出每一張有差異的張,每張各自處理,可多選後一次套用 ——
 * 系統未售、實際不在 → [補登售出](立即生效)/ [待查];系統已售、實際還在 → [標記異常];整本 [重新盤點這本]。
 */
export const StocktakeReviewStep = ({
  review,
  state,
  storeName,
  cashPoints,
  canBackfill,
  isBackfilling,
  onBackfill,
  onChoose,
  onRecount,
  onBack,
  onSubmit,
  notice,
  onClearStale,
  unhandled,
  lostReady,
  canSubmit,
  count,
}: StocktakeReviewStepProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.review");
  const tStock = useTranslations("admin.lotteryStore.stocktake.stock");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const lines = review?.lines ?? [];
  const rowsOf = (line: ReviewLine): Row[] =>
    line.diffs.map((diff) => ({
      key: diffKeyOf(lineKeyOf(line.bookId, line.cashPointId), diff.ticketNo),
      line,
      diff,
    }));
  const allRows = lines.flatMap((line) => rowsOf(line));
  const chosen = allRows.filter(
    (row) => selected.includes(row.key) && !row.diff.backfilled,
  );
  const commonActions = (
    ["sale_backfill", "investigate", "flag", "skip"] as const
  ).filter(
    (action) =>
      chosen.length > 0 &&
      chosen.every((row) =>
        actionsOf(row.line, row.diff.kind).includes(action),
      ) &&
      (action !== "sale_backfill" || canBackfill),
  );
  const toggle = (key: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    );
  };
  const pointOf = (id: string) => cashPoints.find((point) => point.id === id);
  /** 一行的說明:收銀點的班開著 / 沒開;庫存那一區沒有班,說明只能待查。 */
  const lineNoteOf = (line: ReviewLine): string => {
    if (isStocktakeStockLine(line.cashPointId)) {
      return t("stockHint");
    }
    const point = pointOf(line.cashPointId);
    return point?.shift == null
      ? t("shiftClosed")
      : t("shiftOpen", { name: point.shift.ownerName });
  };
  const apply = (rows: readonly Row[], action: StocktakeDiffAction) => {
    if (action === "sale_backfill") {
      onBackfill(rows.map((row) => ({ line: row.line, diff: row.diff })));
    } else {
      onChoose(
        rows.map((row) => row.key),
        action,
      );
    }
    setSelected([]);
  };
  const resultOf = (row: Row) => {
    const amount = `+${moneyText(row.line.unitPrice)}`;
    const point = pointOf(row.line.cashPointId);
    if (row.diff.backfilled) {
      return point?.shift == null
        ? t("result.backfillClosed", {
            cashPoint: row.line.cashPointName,
            amount,
          })
        : t("result.backfillOpen", {
            cashPoint: row.line.cashPointName,
            amount,
          });
    }
    const choice = state.diffs[row.key];
    if (choice?.action === "investigate") {
      return t("result.investigate", { store: storeName });
    }
    if (choice?.action === "flag") {
      return t("result.flag");
    }
    if (choice?.action === "skip") {
      return t("result.skip");
    }
    return t("result.none");
  };
  const actionButton = (row: Row, action: StocktakeDiffAction) => {
    const isChosen = state.diffs[row.key]?.action === action;
    return (
      <Button
        key={action}
        size="small"
        variant={isChosen ? "contained" : "outlined"}
        disabled={action === "sale_backfill" && isBackfilling}
        onClick={() => {
          apply([row], action);
        }}
      >
        {t(`actions.${action}`)}
      </Button>
    );
  };
  const columns: TableColumn<Row>[] = [
    {
      key: "pick",
      header: "",
      width: 48,
      render: (row) => (
        <Checkbox
          size="small"
          disabled={row.diff.backfilled}
          checked={selected.includes(row.key)}
          slotProps={{
            input: {
              "aria-label": t("pickAria", { ticketNo: row.diff.ticketNo }),
            },
          }}
          onChange={(event) => {
            toggle(row.key, event.target.checked);
          }}
        />
      ),
    },
    {
      key: "ticket",
      header: t("columns.ticket"),
      render: (row) => `#${row.diff.ticketNo}`,
    },
    {
      key: "system",
      header: t("columns.system"),
      render: (row) =>
        row.diff.kind === "missing" ? t("system.unsold") : t("system.sold"),
    },
    {
      key: "actual",
      header: t("columns.actual"),
      render: (row) =>
        row.diff.kind === "missing" ? t("actual.absent") : t("actual.present"),
    },
    {
      key: "action",
      header: t("columns.action"),
      render: (row) =>
        row.diff.backfilled ? (
          <Tag tone="success" label={t("backfilled")} />
        ) : (
          <Stack direction="row" spacing={1}>
            {actionsOf(row.line, row.diff.kind)
              .filter((action) => action !== "sale_backfill" || canBackfill)
              .map((action) => actionButton(row, action))}
          </Stack>
        ),
    },
    { key: "result", header: t("columns.result"), render: resultOf },
  ];
  const summary = review?.summary;
  const totals = reviewTotalsOf(review, state);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
        <Typography variant="h6" component="h2">
          {t("title")}
        </Typography>
      </Stack>
      <Alert severity="info">
        {t(count === undefined ? "info" : "infoCount")}
      </Alert>
      {notice === null ? null : (
        <Alert
          severity="warning"
          action={
            onClearStale === null ? undefined : (
              <Button size="small" variant="text" onClick={onClearStale}>
                {t("recheck")}
              </Button>
            )
          }
        >
          {notice}
        </Alert>
      )}
      {lostReady ? null : <Alert severity="warning">{t("lostNotReady")}</Alert>}
      {selected.length > 0 ? (
        <Card sx={{ px: 2, py: 1.5, bgcolor: "primary.lighter" }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {t("selected", { count: selected.length })}
            </Typography>
            {commonActions.map((action) => (
              <Button
                key={action}
                size="small"
                variant={action === "sale_backfill" ? "contained" : "outlined"}
                disabled={action === "sale_backfill" && isBackfilling}
                onClick={() => {
                  apply(chosen, action);
                }}
              >
                {t(`actions.${action}`)}
              </Button>
            ))}
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setSelected([]);
              }}
            >
              {t("clear")}
            </Button>
          </Stack>
        </Card>
      ) : null}
      {/* 補點編號的自動對號(張數店規格 9.3 第 2 點;不算差異) */}
      <RenumberMatchesCard matches={review?.renumberMatches ?? []} />
      {count === undefined || review === null ? null : (
        <StocktakeCountReview
          lines={review.countLines}
          groups={count.groups}
          cashPoints={cashPoints}
          storeName={storeName}
          canBackfill={canBackfill}
          isBackfilling={isBackfilling}
          onCountSale={count.onCountSale}
          onChoose={count.onChoose}
          onRecount={count.onRecount}
        />
      )}
      {review !== null &&
      allRows.length === 0 &&
      review.countLines.every(
        (line) => line.kind === "match" && !line.stale,
      ) ? (
        <Typography color="textSecondary">{t("noDiff")}</Typography>
      ) : null}
      {lines
        .filter(
          (line) =>
            line.diffs.length > 0 || line.pendingReversalTicketNos.length > 0,
        )
        .map((line) => {
          return (
            <Card
              key={lineKeyOf(line.bookId, line.cashPointId)}
              sx={{ px: { xs: 2, sm: 3 }, py: 2 }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "baseline" } }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t("lineTitle", {
                      cashPoint: isStocktakeStockLine(line.cashPointId)
                        ? tStock("name")
                        : line.cashPointName,
                      game: `${line.gameCode} ${line.gameName}`,
                      bookNo: displayBookNo(line.bookNo),
                    })}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ flex: 1 }}
                  >
                    {`${moneyText(line.unitPrice)} · ${lineNoteOf(line)}`}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => {
                      onRecount(line);
                    }}
                  >
                    {t("recount")}
                  </Button>
                </Stack>
                {line.diffs.length > 0 ? (
                  <Table
                    columns={columns}
                    rows={rowsOf(line)}
                    getRowKey={(row) => row.key}
                    size="small"
                    minWidth={720}
                    containerSx={{ height: "auto" }}
                  />
                ) : null}
                <PendingSkipHint line={line} />
                {line.diffs.some((diff) => diff.kind === "extra") ? (
                  <Typography variant="caption" color="textSecondary">
                    {t("extraHint")}
                  </Typography>
                ) : null}
                {line.pendingReversalTicketNos.length > 0 ? (
                  <Typography variant="caption" color="textSecondary">
                    {t("pendingReversal", {
                      tickets: formatTicketRanges(
                        line.pendingReversalTicketNos,
                      ),
                    })}
                  </Typography>
                ) : null}
              </Stack>
            </Card>
          );
        })}
      <ReviewFooter
        backfillCount={summary?.backfillCount ?? 0}
        backfillAmount={summary?.backfillAmount ?? 0}
        investigated={totals.investigated}
        flagged={totals.flagged}
        unhandled={unhandled}
        canSubmit={canSubmit}
        onBack={onBack}
        onSubmit={onSubmit}
      />
    </Stack>
  );
};
