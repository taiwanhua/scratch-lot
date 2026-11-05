import { useTranslations } from "use-intl";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import type { StocktakeSessionView } from "./useStocktakeSession";

/** 盤點中登記的位置文字:全店 / 收銀點名稱。 */
export const useSessionPlaceText = () => {
  const t = useTranslations("admin.lotteryStore.stocktake.session");
  return (
    session: Pick<StocktakeSessionView, "wholeStore" | "cashPointName">,
  ): string =>
    session.wholeStore ? t("wholeStore") : (session.cashPointName ?? "");
};

/** 盤點中登記的範圍文字:「臨時盤點 · 全店」「交班盤點 · 店內櫃台」。 */
export const useSessionScopeText = () => {
  const t = useTranslations("admin.lotteryStore.stocktake.session");
  const placeText = useSessionPlaceText();
  return (session: StocktakeSessionView): string =>
    t("scope", {
      type: t(`types.${session.type}`),
      place: placeText(session),
    });
};

/** 被擋的說明:「A 台正在由 OO 盤點(10:05 開始,剩 52 分鐘自動結束),請等他送出。」 */
export const useBlockedText = () => {
  const t = useTranslations("admin.lotteryStore.stocktake.session");
  const placeText = useSessionPlaceText();
  const temporal = useTemporalText();
  return (session: StocktakeSessionView): string =>
    t("blocked", {
      place: placeText(session),
      name: session.byName,
      time: temporal(session.startedAt, "monthDayTime").split(" ").at(-1) ?? "",
      minutes: session.minutesLeft,
    });
};
