import type { LotteryCheckoutQuery } from "@repo/graphql";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  qrOf,
  receiptMoney,
} from "./receipt-layout";
import { receiptSignedMoney } from "./store-receipts";

type CheckoutDetail = LotteryCheckoutQuery["lotteryCheckout"];

/** 時點 → 單據上的短時間(呼叫端以租戶時區的 `formatTemporal` 格式化,例 `10/16 08:02`)。 */
export type ReceiptTimeText = (value: string) => string;

/** 盤點方式(跳過 / 沿用 / 現在盤點)與時間(已格式化)。 */
export interface ReceiptStocktake {
  mode: "skip" | "reuse" | "new";
  /** 沿用 / 現在盤點的那張盤點單開始盤的時間 */
  timeText: string | null;
  /** 跳過的原因 */
  reason: string | null;
}

export interface ShiftCheckoutReceiptInput {
  /** 結帳確認申請的提交 id:列印紀錄的 `refId`,QR 連到檢視頁 */
  submissionId: string;
  serialNo: string | null;
  branchId: string;
  cashPointName: string;
  /** 收銀點的印表機;沒有就用分店預設 */
  defaultPrinterId: string | null;
  /** 班次:開班 ~ 結束(已格式化) */
  shiftFrom: string;
  shiftTo: string;
  /** 交班人(送出交班結帳的人) */
  handedBy: string;
  /** 接班人;沒有 = null */
  successor: string | null;
  stocktake: ReceiptStocktake;
  expected: number;
  counted: number;
  difference: number;
  diffReason: string | null;
  leftForNext: number;
  /** 送出時間(ISO 時點) */
  submittedAt: string;
  url: string | null;
}

/** 「標籤:值」一列一個區塊。 */
const rowBlocks = (pairs: readonly [string, string][]): ReceiptBlock[] =>
  pairs.map(([label, value]) => ({ type: "row", label, value }));

/** 盤點那一格的文字。 */
export const stocktakeTextOf = (
  stocktake: ReceiptStocktake,
  t: ReceiptTranslator,
): string => {
  switch (stocktake.mode) {
    case "skip": {
      return t("stocktake.skip", { reason: stocktake.reason ?? "" });
    }
    case "reuse": {
      return t("stocktake.reuse", { time: stocktake.timeText ?? "" });
    }
    case "new": {
      return t("stocktake.new", { time: stocktake.timeText ?? "" });
    }
  }
};

/** 差額那一格:不為 0 時接原因(例 `-300(找錯錢)`)。 */
export const differenceTextOf = (
  difference: number,
  reason: string | null,
  t: ReceiptTranslator,
): string =>
  difference === 0 || reason === null || reason === ""
    ? receiptSignedMoney(difference)
    : t("differenceWithReason", {
        amount: receiptSignedMoney(difference),
        reason,
      });

/**
 * 交班結帳單(規格第 12 章、6.9;Figma RC-04 `68:1809`):交班結帳送出時自動印,結帳檢視頁可補印。
 * 收銀點、班次、交班人、接班人、盤點、應有現金、實點、差額(與原因)、留給下一班;
 * 表頭單號 = 結帳確認申請的單號,時間 = 送出時間;QR 連到結帳確認申請;簽名欄 交班人、接班人。
 */
export const shiftCheckoutReceiptOf = (
  input: ShiftCheckoutReceiptInput,
  t: ReceiptTranslator,
): ReceiptLayout => {
  const rows: [string, string][] = [
    [t("cashPoint"), input.cashPointName],
    [
      t("shiftCheckout.shift"),
      t("range", { from: input.shiftFrom, to: input.shiftTo }),
    ],
    [t("shiftCheckout.handedBy"), input.handedBy],
    [t("shiftCheckout.successor"), input.successor ?? t("none")],
    [t("stocktake.label"), stocktakeTextOf(input.stocktake, t)],
  ];
  const cash: [string, string][] = [
    [t("shiftCheckout.expected"), receiptMoney(input.expected)],
    [t("counted"), receiptMoney(input.counted)],
    [t("difference"), differenceTextOf(input.difference, input.diffReason, t)],
  ];
  return {
    title: t("shiftCheckout.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: input.submittedAt,
    blocks: [
      { type: "divider" },
      ...rowBlocks(rows),
      { type: "divider" },
      ...rowBlocks(cash),
      {
        type: "total",
        label: t("shiftCheckout.leftForNext"),
        value: receiptMoney(input.leftForNext),
      },
      { type: "divider" },
    ],
    qr: qrOf(input.url, t("qrCaption")),
    signatures: [
      t("shiftCheckout.handedSign"),
      t("shiftCheckout.successorSign"),
    ],
  };
};

/** 結帳單的盤點方式 → 單據的盤點資料。 */
export const receiptStocktakeOf = (
  detail: Pick<CheckoutDetail, "stocktakeMode" | "stocktake" | "skipReason">,
  timeText: ReceiptTimeText,
): ReceiptStocktake => {
  if (detail.stocktakeMode === "skip") {
    return { mode: "skip", timeText: null, reason: detail.skipReason ?? null };
  }
  const stocktake = detail.stocktake ?? null;
  return {
    mode: detail.stocktakeMode === "reuse" ? "reuse" : "new",
    timeText: stocktake === null ? null : timeText(stocktake.startedAt),
    reason: null,
  };
};

/** 結帳確認申請檢視頁的結帳單(交班)→ 交班結帳單的資料。 */
export const shiftCheckoutInputOf = (
  detail: CheckoutDetail,
  serialNo: string | null,
  url: string | null,
  timeText: ReceiptTimeText,
): ShiftCheckoutReceiptInput => ({
  submissionId: detail.submissionId,
  serialNo,
  branchId: detail.orgId,
  cashPointName: detail.cashPoint?.name ?? "",
  defaultPrinterId: detail.cashPointPrinterId ?? null,
  shiftFrom: detail.shiftOpenedAt == null ? "" : timeText(detail.shiftOpenedAt),
  shiftTo: timeText(detail.shiftClosedAt ?? detail.submittedAt),
  handedBy: detail.submittedBy?.name ?? "",
  successor: detail.successor?.name ?? null,
  stocktake: receiptStocktakeOf(detail, timeText),
  expected: detail.expected,
  counted: detail.counted,
  difference: detail.difference,
  diffReason: detail.diffReason ?? null,
  leftForNext: detail.leftForNext,
  submittedAt: detail.submittedAt,
  url,
});
