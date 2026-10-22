import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { StocktakeBookList } from "./StocktakeBookList";
import { StocktakeBookPanel } from "./StocktakeBookPanel";
import { LostSection, UnopenedSection } from "./StocktakeSections";
import {
  type SheetCashPoint,
  type StocktakeSheet,
  type StocktakeState,
  bookKeyOf,
  figuresOf,
} from "./stocktake-model";
import type { useStocktakeFlow } from "./useStocktakeFlow";

export interface StocktakeCountStepProps {
  flow: ReturnType<typeof useStocktakeFlow>;
  sheet: StocktakeSheet;
  state: StocktakeState;
  scopeCashPointId: string | null;
  isNarrow: boolean;
  /** 有 `store.redeem` 才給 [補登兌獎] */
  onRedeem: ((point: SheetCashPoint) => void) | null;
  canConfirmLost: boolean;
}

/** 盤點頁的盤點步驟(規格 6.8;Figma ST-13):進度、本清單、選中的本、未拆的本、待查清單、[差異核對]。 */
export const StocktakeCountStep = ({
  flow,
  sheet,
  state,
  scopeCashPointId,
  isNarrow,
  onRedeem,
  canConfirmLost,
}: StocktakeCountStepProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { books, current, currentKey } = flow;
  const pointName = (id: string) =>
    sheet.cashPoints.find((point) => point.id === id)?.name ?? "";
  const index = current === undefined ? -1 : books.indexOf(current);
  const moveTo = (by: number) => {
    const next = books.at(index + by);
    if (next !== undefined && index + by >= 0) {
      flow.select(bookKeyOf(next));
    }
  };
  const counted = books.filter(
    (book) => state.counts[bookKeyOf(book)] !== undefined,
  ).length;
  const diffTotal = books.reduce(
    (sum, book) =>
      sum + figuresOf(book, state.counts[bookKeyOf(book)]).diffNos.length,
    0,
  );
  const progress = books.length === 0 ? 0 : (counted / books.length) * 100;

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ whiteSpace: "nowrap" }}>
          {t("page.progress", { done: counted, total: books.length })}
        </Typography>
        <Box
          role="progressbar"
          aria-valuenow={counted}
          aria-valuemin={0}
          aria-valuemax={books.length}
          sx={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            bgcolor: "grey.200",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              height: "100%",
              width: `${String(progress)}%`,
              bgcolor: "primary.main",
            }}
          />
        </Box>
        <Typography
          variant="subtitle2"
          sx={{ color: "warning.dark", whiteSpace: "nowrap" }}
        >
          {t("page.diffCount", { count: diffTotal })}
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "300px 1fr" },
          alignItems: "start",
        }}
      >
        <StocktakeBookList
          cashPoints={sheet.cashPoints}
          books={books}
          state={state}
          selectedKey={currentKey}
          onSelect={flow.select}
          onRedeem={onRedeem}
          isNarrow={isNarrow}
        />
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          {current === undefined || currentKey === null ? (
            <Typography color="textSecondary">{t("page.noBooks")}</Typography>
          ) : (
            <StocktakeBookPanel
              key={currentKey}
              book={current}
              cashPointName={pointName(current.cashPointId)}
              count={state.counts[currentKey]}
              countedAt={
                state.counts[currentKey]?.countedAt ??
                flow.viewedAt[currentKey] ??
                sheet.serverNow
              }
              onChange={(next) => {
                flow.setCount(currentKey, next);
              }}
              onCode={flow.handleCode}
              onPrev={
                index > 0
                  ? () => {
                      moveTo(-1);
                    }
                  : null
              }
              onNext={() => {
                const before = state.counts[currentKey];
                flow.setCount(currentKey, {
                  method: before?.method ?? "grid",
                  present: before?.present ?? [],
                });
                moveTo(1);
              }}
            />
          )}
          {scopeCashPointId === null ? (
            <>
              <UnopenedSection
                books={sheet.unopenedBooks}
                state={state}
                onChange={flow.setUnopened}
              />
              <LostSection
                groups={flow.lostGroups}
                state={state}
                canConfirmLost={canConfirmLost}
                onChange={flow.setLost}
              />
            </>
          ) : null}
        </Stack>
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("page.footer")}
        </Typography>
        <Button
          variant="contained"
          disabled={counted === 0}
          onClick={() => {
            flow.setStep("review");
          }}
        >
          {t("page.review")}
        </Button>
      </Stack>
    </>
  );
};
