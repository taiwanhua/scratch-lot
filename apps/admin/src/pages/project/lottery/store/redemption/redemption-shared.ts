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

/**
 * 兌獎視窗的掃描用途(B10;`useScanner`):視窗開著時刷到的碼交給兌獎,不交給看板的銷售(`store-sale`)
 * —— 否則刷中獎的那一張會被當成售出。
 */
export const REDEMPTION_SCAN_PURPOSE = "store-redemption";

/** [最近兌獎] 的 query key 前綴(看板的 `board` 信號也重抓它,`app/project/realtime-signals.ts`)。 */
export const STORE_RECENT_REDEMPTIONS_QUERY_KEY: QueryKey = [
  "LotteryRecentRedemptions",
];

/** 兌獎紀錄分頁的 query key 前綴(同上)。 */
export const STORE_REDEMPTIONS_QUERY_KEY: QueryKey = ["LotteryRedemptions"];

/** 兌獎寫入後要重抓的資料:看板(應有現金)、[最近兌獎]、兌獎紀錄分頁與詳情、進貨單的兌獎區。 */
const REDEMPTION_QUERY_KEYS: readonly QueryKey[] = [
  STORE_BOARD_QUERY_KEY,
  STORE_RECENT_REDEMPTIONS_QUERY_KEY,
  STORE_REDEMPTIONS_QUERY_KEY,
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

/**
 * 兌獎視窗的錯誤(REACT-18):api 指到編號(`code`)/ 獎金(`prizeAmount`)時原因寫在那一欄正下方,
 * 下方提示只放通用句;沒有指到這兩欄的錯誤(班已結帳、已送兌……)原因照寫在提示裡。
 */
export const redemptionFieldErrorsOf = (
  error: unknown,
  t: (key: string, values?: Record<string, string>) => string,
  timeText: (value: unknown) => string,
): {
  codeError: string | undefined;
  prizeError: string | undefined;
  errorText: string | null;
} => {
  if (error === null) {
    return { codeError: undefined, prizeError: undefined, errorText: null };
  }
  const reason = redemptionErrorText(error, t, timeText);
  const fields = redemptionErrorOf(error).fields ?? [];
  const codeError = fields.includes("code") ? reason : undefined;
  const prizeError = fields.includes("prizeAmount") ? reason : undefined;
  return {
    codeError,
    prizeError,
    errorText:
      codeError === undefined && prizeError === undefined
        ? reason
        : t("errors.VALIDATION_FAILED"),
  };
};
