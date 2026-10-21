import type { QueryClient, QueryKey } from "@tanstack/react-query";

import {
  REDEMPTION_MAX_PRIZE,
  displayBookNo,
} from "@repo/domain/project/lottery";
import type { LotteryRedemptionFieldsFragment } from "@repo/graphql";

import {
  redemptionErrorDetailOf,
  redemptionErrorOf,
} from "@/lib/project/lottery/redemption-error";

import { STORE_BOARD_QUERY_KEY } from "../BoardTab/board-query";
import { moneyText } from "../store-text";

export type RedemptionRow = LotteryRedemptionFieldsFragment;

/** 兌獎寫入後要重抓的資料:看板(應有現金)、[最近兌獎]、兌獎紀錄分頁與詳情、進貨單的兌獎區。 */
const REDEMPTION_QUERY_KEYS: readonly QueryKey[] = [
  STORE_BOARD_QUERY_KEY,
  ["LotteryRecentRedemptions"],
  ["LotteryRedemptions"],
  ["LotteryRedemption"],
  ["LotteryPurchaseRedemptions"],
];

export const invalidateRedemptions = (queryClient: QueryClient): void => {
  for (const queryKey of REDEMPTION_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey });
  }
};

/** [最近兌獎]、進貨單兌獎區的張編號:`5164 · 056527 · #031`。 */
export const ticketShortOf = (
  row: Pick<RedemptionRow, "gameCode" | "bookNo" | "ticketNo">,
): string =>
  `${row.gameCode} · ${displayBookNo(row.bookNo)} · #${row.ticketNo}`;

/** 狀態標籤的顏色:店內持有 黃、已送兌 綠、已撤銷 灰(Figma ST-40)。 */
export const statusToneOf = (
  status: string,
): "warning" | "success" | "grey" => {
  if (status === "in_store") {
    return "warning";
  }
  return status === "sent" ? "success" : "grey";
};

/** 時點字串 → 牆上時間的「時:分」(`monthDayTime` 的後半)。 */
export const timeOnly = (monthDayTime: string): string =>
  monthDayTime.split(" ").at(-1) ?? monthDayTime;

/**
 * 中獎金額的畫面檢查:正整數;超過 5,000 / 超過抽屜應有 → 文案 key(`problem`)。
 * 那一班已結帳時 `expectedCash = null`(不檢查抽屜)。
 */
export const prizeStateOf = (
  text: string,
  expectedCash: number | null,
): {
  value: number;
  isValid: boolean;
  problem: "overLimit" | "overDrawer" | null;
} => {
  const value = Number(text.trim());
  const isValid = text.trim() !== "" && Number.isInteger(value) && value > 0;
  let problem: "overLimit" | "overDrawer" | null = null;
  if (isValid && value > REDEMPTION_MAX_PRIZE) {
    problem = "overLimit";
  } else if (isValid && expectedCash !== null && value > expectedCash) {
    problem = "overDrawer";
  }
  return { value, isValid, problem };
};

/** api 錯誤 → 文案(已兌過帶時間與收銀點、超過抽屜應有帶金額)。 */
export const redemptionErrorText = (
  error: unknown,
  t: (key: string, values?: Record<string, string>) => string,
  timeText: (value: unknown) => string,
): string => {
  const parsed = redemptionErrorOf(error);
  const detail = redemptionErrorDetailOf(error);
  if (parsed.code === "REDEMPTION_DUPLICATE") {
    return t("existing", {
      time: timeText(detail.redeemedAt),
      cashPoint: detail.cashPointName ?? "",
    });
  }
  if (parsed.code === "AMOUNT_EXCEEDS_DRAWER") {
    return t("overDrawer", { expected: moneyText(detail.expected ?? 0) });
  }
  return t(`errors.${parsed.code}`);
};
