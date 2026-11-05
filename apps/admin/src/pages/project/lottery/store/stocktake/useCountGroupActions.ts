import { useTranslations } from "use-intl";

import { useBackfillLotteryStocktakeCountSalesMutation } from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { parseAdminError } from "@/lib/base/errors";

import { moneyText } from "../store-text";
import { type GroupCount, emptyGroupCount } from "./stocktake-count-model";
import {
  type ReviewCountLine,
  type SheetCountGroup,
  type StocktakeState,
  countGroupKeyOf,
  groupKeyOf,
} from "./stocktake-model";
import { useRefreshWizardCash } from "./stocktake-queries";

export interface CountGroupActionsInput {
  orgId: string;
  update: (change: (before: StocktakeState) => StocktakeState) => void;
  /** 伺服器時間(ISO) */
  nowIso: () => string;
  viewedAt: Partial<Record<string, string>>;
  setViewedAt: (
    change: (
      before: Partial<Record<string, string>>,
    ) => Partial<Record<string, string>>,
  ) => void;
  setSelectedKey: (key: string) => void;
  setStep: (step: "count" | "review") => void;
  setNotice: (notice: string | null) => void;
  /** 重抓盤點資料與差異核對 */
  refetch: () => void;
}

/**
 * 張數盤點一組的動作(張數店規格 8.1、8.2、13.1;`useStocktakeFlow` 用):[確定]、[重數](盤點單記下每次輸入)、
 * [待查] 幾張 / [標記異常](送出時才寫)、[算售出 N 張](立即生效)、差異核對的 [重數這組]。
 */
export const useCountGroupActions = ({
  orgId,
  update,
  nowIso,
  viewedAt,
  setViewedAt,
  setSelectedKey,
  setStep,
  setNotice,
  refetch,
}: CountGroupActionsInput) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  const refreshWizardCash = useRefreshWizardCash();
  const countBackfill = useBackfillLotteryStocktakeCountSalesMutation(
    session.client,
  );

  const setGroup = (key: string, change: (group: GroupCount) => GroupCount) => {
    update((before) => ({
      ...before,
      groups: {
        ...before.groups,
        [key]: change(
          before.groups[key] ?? emptyGroupCount(viewedAt[key] ?? nowIso()),
        ),
      },
    }));
  };

  /**
   * [重數]:這一次的數字放進 `recounts`(盤點單記下每次輸入)、重新開始數(`countedAt` = 現在);
   * 已 [算售出] 的不退(之前寫的售出已在新的系統數字裡),這一組的處理重選。
   */
  const recountGroup = (key: string) => {
    const at = nowIso();
    setGroup(key, (before) => ({
      ...emptyGroupCount(at),
      recounts:
        before.presentCount == null
          ? before.recounts
          : [...before.recounts, before.presentCount],
    }));
    setViewedAt((before) => ({ ...before, [key]: at }));
  };

  return {
    isBackfilling: countBackfill.isPending,
    /** [確定]:記下實際剩幾張,之後才顯示「系統 · 實際 · 差」。 */
    confirmGroup: (group: SheetCountGroup, presentCount: number) => {
      setGroup(countGroupKeyOf(group), (before) => ({
        ...before,
        presentCount,
        systemShown: group.unsoldCount,
      }));
    },
    recountGroup,
    /** [待查] 幾張 / [標記異常](只在畫面上;送出時才寫)。 */
    chooseGroup: (
      key: string,
      choice: Partial<Pick<GroupCount, "investigateCount" | "flagged">>,
    ) => {
      setGroup(key, (before) => ({ ...before, ...choice }));
    },
    /**
     * [算售出 N 張](立即生效):照挑張順序挑這一組的未售張記已售·未對號,算那個收銀點開著的班(已結帳 → 事後更正);
     * `investigate` = 同時把剩下的記成待查(拆開時)。
     */
    runCountBackfill: (
      line: ReviewCountLine,
      count: number,
      investigate: number,
    ) => {
      setNotice(null);
      const key = groupKeyOf(line.cashPointId, line.gameId);
      void countBackfill
        .mutateAsync({
          input: {
            orgId,
            cashPointId: line.cashPointId,
            gameId: line.gameId,
            count,
          },
        })
        .then((data) => {
          const result = data.backfillLotteryStocktakeCountSales;
          setGroup(key, (before) => ({
            ...before,
            saleCount: before.saleCount + result.count,
            saleRefIds: [...before.saleRefIds, result.refId],
            investigateCount: investigate,
            flagged: false,
          }));
          showSnackbar(
            "success",
            t("review.backfillDone", {
              count: result.count,
              amount: moneyText(result.amount),
            }),
          );
          refetch();
          refreshWizardCash();
        })
        .catch((error: unknown) => {
          const failure = parseAdminError(error, {
            codes: ["CONFLICT", "VALIDATION_FAILED"],
            reasons: [
              "STOCKTAKE_ALREADY_PROCESSED",
              "STOCKTAKE_NO_SHIFT",
              "STOCKTAKE_COUNT_SALE_UNAVAILABLE",
            ],
          });
          setNotice(
            failure.reason === "STOCKTAKE_NO_SHIFT"
              ? t("review.noShift")
              : t("count.saleUnavailable"),
          );
          refetch();
        });
    },
    /** 差異核對的 [重數這組]:回到盤點頁數這一組。 */
    recountLine: (line: ReviewCountLine) => {
      const key = groupKeyOf(line.cashPointId, line.gameId);
      recountGroup(key);
      setSelectedKey(key);
      setStep("count");
    },
  };
};

/** 差異核對的張數盤點(`StocktakeReviewStep` 的 `count`;盤點頁與交班 / 日結的盤點步驟共用);編號盤點 = undefined。 */
export const countReviewPropsOf = (flow: {
  isCountMode: boolean;
  state: StocktakeState | null;
  runCountBackfill: ReturnType<typeof useCountGroupActions>["runCountBackfill"];
  chooseGroup: ReturnType<typeof useCountGroupActions>["chooseGroup"];
  recountLine: ReturnType<typeof useCountGroupActions>["recountLine"];
}) =>
  flow.isCountMode && flow.state !== null
    ? {
        groups: flow.state.groups,
        onCountSale: flow.runCountBackfill,
        onChoose: flow.chooseGroup,
        onRecount: flow.recountLine,
      }
    : undefined;
