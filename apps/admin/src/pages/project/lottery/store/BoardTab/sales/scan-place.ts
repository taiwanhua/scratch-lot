import type { LotteryStoreScanItemFieldsFragment } from "@repo/graphql";

import { BLOCK_REASON_KEYS } from "./sales-text";
import { useSalesText } from "./useSalesText";

export type ScanItem = LotteryStoreScanItemFieldsFragment;

/** 這張在哪裡(檯面 · 收銀點(誰的班)/ 庫存(未拆)/ 在途)。 */
export const usePlaceText = () => {
  const { t } = useSalesText();
  return (item: ScanItem): string => {
    if (item.locationKind === "counter" && item.cashPoint) {
      return item.counterShiftOwner
        ? t("scan.place.counterOwned", {
            cashPoint: item.cashPoint.name,
            owner: item.counterShiftOwner.name,
          })
        : t("scan.place.counter", { cashPoint: item.cashPoint.name });
    }
    if (item.locationKind === "stock") {
      return item.outcome === "unopened"
        ? t("scan.place.stockUnopened")
        : t("scan.place.stock");
    }
    return item.locationKind === "in_transit"
      ? t("scan.place.inTransit")
      : t("scan.place.other");
  };
};

/**
 * 擋下的說明(原因 → 文案;已售帶售出時間;沒有移櫃權限帶收銀點)。張數店(`countBoard`)的跳號 / 報廢
 * 提示先更正(張數店規格 6.5);已售·未對號找不到配對帶刷的那台(`localName`,6.4)。
 */
export const useBlockedText = (countBoard = false, localName = "") => {
  const { t, clock } = useSalesText();
  return (item: ScanItem): string => {
    if (item.outcome === "move_forbidden") {
      return t("scan.blocked.moveForbidden", {
        cashPoint: item.cashPoint?.name ?? "",
      });
    }
    if (countBoard && item.blockReason === "skipped") {
      return t("scan.blocked.skippedFix");
    }
    if (countBoard && item.blockReason === "scrapped") {
      return t("scan.blocked.scrappedFix");
    }
    const reason = (item.blockReason ?? "") as keyof typeof BLOCK_REASON_KEYS;
    if (!(reason in BLOCK_REASON_KEYS)) {
      return t("scan.blocked.notThisStore");
    }
    return t(BLOCK_REASON_KEYS[reason], {
      time: item.soldAt ? clock(item.soldAt) : "",
      // 找不到配對:刷的那台(本機收銀點)的這個遊戲沒有未售的張
      cashPoint: localName,
    });
  };
};
