import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { StocktakeBookList } from "./StocktakeBookList";
import { StocktakeBookPanel } from "./StocktakeBookPanel";
import { StocktakeCountGroupPanel } from "./StocktakeCountGroupPanel";
import { LostSection, UnopenedSection } from "./StocktakeSections";
import { diffTotalOf, stocktakeNavKeysOf } from "./stocktake-count-model";
import {
  type SheetCashPoint,
  type StocktakeSheet,
  type StocktakeState,
  placeNameOf,
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

/**
 * 盤點頁的盤點步驟(規格 6.8;Figma ST-13、張數店 CS-09a / 09b):進度、本清單(張數店:收銀點 → 遊戲的組)、
 * 選中的本或組、未拆的本、待查清單、[差異核對]。[上一本] [下一本](張數盤點是 [上一組] [下一組])照張數店規格 13.3:
 * [上一本] 外框按鈕、第一本停用;[下一本] 跳到下一本還沒盤的,全部盤完改成 [盤完,前往差異核對](`stocktakeNavOf`)。
 */
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
  const { books, countGroups, current, currentGroup, currentKey, itemKeys } =
    flow;
  const pointName = (id: string) =>
    placeNameOf(sheet.cashPoints, id, t("stock.name"));
  const nav = stocktakeNavKeysOf(itemKeys, currentKey, flow.isCounted);
  const prevKey = nav.prevKey;
  const goPrev =
    prevKey === null
      ? null
      : () => {
          flow.select(prevKey);
        };
  const goNext = () => {
    if (nav.nextKey === null) {
      flow.setStep("review");
    } else {
      flow.select(nav.nextKey);
    }
  };
  const nextIsReview = nav.nextKey === null;
  const diffTotal = diffTotalOf(books, countGroups, state);
  const total = itemKeys.length;
  const progress = total === 0 ? 0 : (nav.counted / total) * 100;
  const progressKey = flow.isCountMode
    ? "page.progressGroups"
    : "page.progress";

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ whiteSpace: "nowrap" }}>
          {t(progressKey, { done: nav.counted, total })}
        </Typography>
        <Box
          role="progressbar"
          aria-valuenow={nav.counted}
          aria-valuemin={0}
          aria-valuemax={total}
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
          countGroups={countGroups}
          state={state}
          selectedKey={currentKey}
          onSelect={flow.select}
          onRedeem={onRedeem}
          isNarrow={isNarrow}
        />
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          {currentGroup !== undefined && currentKey !== null ? (
            <StocktakeCountGroupPanel
              key={currentKey}
              group={currentGroup}
              cashPointName={pointName(currentGroup.cashPointId)}
              count={state.groups[currentKey]}
              onConfirm={(present) => {
                flow.confirmGroup(currentGroup, present);
              }}
              onRecount={() => {
                flow.recountGroup(currentKey);
              }}
              onPrev={goPrev}
              onNext={goNext}
              nextIsReview={nextIsReview}
            />
          ) : null}
          {current !== undefined && currentKey !== null ? (
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
              onPrev={goPrev}
              nextIsReview={nextIsReview}
              onNext={() => {
                const before = state.counts[currentKey];
                flow.setCount(currentKey, {
                  method: before?.method ?? "grid",
                  present: before?.present ?? [],
                });
                goNext();
              }}
            />
          ) : null}
          {currentKey === null ? (
            <Typography color="textSecondary">{t("page.noBooks")}</Typography>
          ) : null}
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
          disabled={nav.counted === 0}
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
