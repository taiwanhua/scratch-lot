import { useTranslations } from "use-intl";

import {
  openingErrorDetailOf,
  openingErrorOf,
} from "@/lib/project/lottery/opening-error";

/** 計畫不合的原因有自己文案的(其他退回「張號不合」)。 */
const PROBLEM_KEYS = new Set([
  "all_sold",
  "unplaced",
  "ticket_out_of_range",
  "ticket_repeated",
]);

/**
 * 期初建檔頁的錯誤文案(規格 3.2):進貨單帶單號、計畫不合依 `openingProblem`(整本都賣完 / 還有跳號沒標…)。
 */
export const useOpeningErrorText = () => {
  const t = useTranslations("admin.lotteryInventory.opening");
  return (error: unknown): string => {
    const { code } = openingErrorOf(error);
    const detail = openingErrorDetailOf(error);
    if (
      code === "OPENING_PLAN_INVALID" &&
      detail.openingProblem !== undefined
    ) {
      if (detail.openingProblem === "skip_count_mismatch") {
        return t("errors.OPENING_PLAN_INVALID");
      }
      if (PROBLEM_KEYS.has(detail.openingProblem)) {
        return t(`card.problems.${detail.openingProblem}`, {
          count: 0,
          min: 0,
        });
      }
    }
    return t(`errors.${code}`, { serialNo: detail.serialNo ?? "" });
  };
};
