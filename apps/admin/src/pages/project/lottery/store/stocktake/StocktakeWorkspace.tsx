import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import {
  STORE_PERMISSIONS,
  type StocktakeDraft,
} from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { useRedemptionFlow } from "../redemption/useRedemptionFlow";
import { moneyText } from "../store-text";
import { StocktakeCountStep } from "./StocktakeCountStep";
import { StocktakeReviewStep } from "./StocktakeReviewStep";
import { StocktakeSubmitDialog } from "./StocktakeSubmitDialog";
import {
  type SheetCashPoint,
  bookKeyOf,
  lostChoicesReady,
  placeNameOf,
  unhandledOf,
} from "./stocktake-model";
import { useStocktakeFlow } from "./useStocktakeFlow";

export interface StocktakeWorkspaceProps {
  orgId: string;
  /** 只盤一個收銀點;全店 = null */
  scopeCashPointId: string | null;
  /** 頁首:盤點類型(例:「臨時盤點」) */
  heading: string;
  /** 退回後再送出:帶入原內容 */
  initialDraft: StocktakeDraft | null;
  /** 頁首的提示(例:已退回) */
  notice?: ReactNode;
  /** [送出盤點確認申請];回 true = 已送出 */
  /** `scopeLabel` = 全店 / 收銀點名稱(申請的「盤點範圍」) */
  onSubmit: (
    draft: StocktakeDraft,
    totals: string,
    note: string,
    scopeLabel: string,
  ) => Promise<boolean>;
  submitError: string | null;
  isSubmitting: boolean;
  /** [取消(不保留)] */
  onCancel: () => void;
}

/**
 * 盤點頁(專案規格 6.8;Figma ST-13 / 14 / 15,電腦、平板、手機):本清單(依收銀點分組,各收銀點旁 [補登兌獎] 與
 * 應有現金,立即生效)→ 選中的本(點格子 / 掃描)→ 未拆的本、待查清單 → [差異核對] → [送出]。
 * 狀態與動作在 `useStocktakeFlow`;交班 / 日結的盤點步驟以 `scopeCashPointId` 嵌入同一個元件(之後的功能)。
 */
export const StocktakeWorkspace = ({
  orgId,
  scopeCashPointId,
  heading,
  initialDraft,
  notice,
  onSubmit,
  submitError,
  isSubmitting,
  onCancel,
}: StocktakeWorkspaceProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const me = useMe();
  const temporal = useTemporalText();
  const { hasPermission } = usePermissions();
  const isNarrow = useBreakpointDown("md");
  const flow = useStocktakeFlow({ orgId, scopeCashPointId, initialDraft });
  const redemption = useRedemptionFlow();
  const [isConfirming, setIsConfirming] = useState(false);
  const { sheet, state, books, review } = flow;

  if (flow.sheetQuery.isError) {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  if (sheet === null || state === null) {
    return null;
  }

  const pointName = (id: string) =>
    placeNameOf(sheet.cashPoints, id, t("stock.name"));
  const counted = books.filter(
    (book) => state.counts[bookKeyOf(book)] !== undefined,
  ).length;
  const scopeLabel =
    scopeCashPointId === null
      ? t("page.wholeStore")
      : pointName(scopeCashPointId);
  const unhandled = review === null ? 0 : unhandledOf(review, state);
  const lostReady = lostChoicesReady(state);
  const canSubmit =
    review !== null &&
    !flow.reviewQuery.isFetching &&
    review.staleCount === 0 &&
    unhandled === 0 &&
    lostReady;
  const totalsText =
    review === null
      ? ""
      : t("totals", {
          backfill: review.summary.backfillCount,
          amount: moneyText(review.summary.backfillAmount),
          investigate: review.summary.newInvestigate,
          flagged: review.summary.flagged,
          lost: review.summary.confirmLost,
        });
  const openRedeem = (point: SheetCashPoint) => {
    if (point.shift != null) {
      redemption.openRedeem({
        orgId,
        shiftId: point.shift.id,
        cashPointName: point.name,
        expectedCash: point.shift.expectedCash ?? 0,
      });
    }
  };
  const staleNotice =
    flow.staleNos.length > 0
      ? t("review.stale", {
          tickets: flow.staleNos.map(({ no }) => `#${no}`).join("、"),
        })
      : null;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "baseline" } }}
      >
        <Typography variant="h6" component="h1">
          {t("page.title", { heading, scope: scopeLabel })}
        </Typography>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("page.started", {
            time: temporal(state.startedAt, "monthDayTime"),
            name: me.data?.me.name ?? "",
          })}
        </Typography>
        <Button variant="text" color="error" onClick={onCancel}>
          {t("page.cancel")}
        </Button>
      </Stack>
      {notice}
      {flow.step === "count" ? (
        <StocktakeCountStep
          flow={flow}
          sheet={sheet}
          state={state}
          scopeCashPointId={scopeCashPointId}
          isNarrow={isNarrow}
          onRedeem={hasPermission(STORE_PERMISSIONS.redeem) ? openRedeem : null}
          canConfirmLost={hasPermission(STORE_PERMISSIONS.confirmLost)}
        />
      ) : (
        <StocktakeReviewStep
          review={review}
          state={state}
          storeName={sheet.orgName}
          cashPoints={sheet.cashPoints}
          canBackfill={hasPermission(STORE_PERMISSIONS.sell)}
          isBackfilling={flow.isBackfilling}
          onBackfill={flow.runBackfill}
          onChoose={flow.choose}
          onRecount={flow.recount}
          onBack={() => {
            flow.setStep("count");
          }}
          onSubmit={() => {
            setIsConfirming(true);
          }}
          notice={flow.notice ?? staleNotice}
          onClearStale={flow.staleNos.length > 0 ? flow.clearStale : null}
          unhandled={unhandled}
          lostReady={lostReady}
          canSubmit={canSubmit}
        />
      )}
      {review !== null && isConfirming ? (
        <StocktakeSubmitDialog
          open
          scopeLabel={`${heading} · ${scopeLabel}`}
          sheet={sheet}
          review={review}
          state={state}
          uncounted={books.length - counted}
          isPending={isSubmitting}
          error={submitError}
          onClose={() => {
            setIsConfirming(false);
          }}
          onConfirm={(note) => {
            const draft = flow.draft;
            if (draft !== null) {
              void onSubmit(draft, totalsText, note, scopeLabel).then(
                (done) => {
                  if (done) {
                    setIsConfirming(false);
                  }
                },
              );
            }
          }}
        />
      ) : null}
      {redemption.element}
    </Stack>
  );
};
