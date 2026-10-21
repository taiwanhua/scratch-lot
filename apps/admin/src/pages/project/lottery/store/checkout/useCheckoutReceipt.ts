import { CHECKOUT_TYPE } from "@repo/domain/project/lottery";
import type { LotteryCheckoutQuery } from "@repo/graphql";

import type { ReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useStoreReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useStoreReceiptLinks";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  type DailyCloseReceiptInput,
  dailyCloseInputOf,
} from "@/lib/project/lottery/receipts/daily-close-receipt";
import {
  type ShiftCheckoutReceiptInput,
  shiftCheckoutInputOf,
} from "@/lib/project/lottery/receipts/shift-checkout-receipt";

type CheckoutDetail = LotteryCheckoutQuery["lotteryCheckout"];

/** 一張結帳單要印的那一種單據:交班 → 交班結帳單、日結 → 日結單。 */
export type CheckoutReceipt =
  | { kind: "store-shift-checkout"; payload: ShiftCheckoutReceiptInput }
  | { kind: "store-daily-close"; payload: DailyCloseReceiptInput };

/**
 * 結帳單 → 58mm 單據的資料(送出後自動印的 `CheckoutReceiptEffect` 與檢視頁 [列印] 共用,補印和原單一致):
 * 時間依租戶時區(`formatTemporal` monthDayTime),QR 連到這張結帳確認申請的檢視頁。
 */
export const useCheckoutReceipt = () => {
  const temporal = useTemporalText();
  const { storeViewUrl } = useStoreReceiptLinks();
  const timeText = (value: string) => temporal(value, "monthDayTime");
  return (detail: CheckoutDetail, serialNo: string | null): CheckoutReceipt => {
    const url = storeViewUrl(detail.submissionId);
    return detail.type === CHECKOUT_TYPE.daily
      ? {
          kind: "store-daily-close",
          payload: dailyCloseInputOf(detail, serialNo, url, timeText),
        }
      : {
          kind: "store-shift-checkout",
          payload: shiftCheckoutInputOf(detail, serialNo, url, timeText),
        };
  };
};

/** 印一張結帳單的單據(`kind` 與資料一起帶;交易後自動印用)。 */
export const printCheckoutReceipt = (
  print: ReceiptPrinter["printReceiptAfterCommit"],
  receipt: CheckoutReceipt,
): Promise<void> => {
  switch (receipt.kind) {
    case "store-daily-close": {
      return print("store-daily-close", receipt.payload);
    }
    case "store-shift-checkout": {
      return print("store-shift-checkout", receipt.payload);
    }
  }
};
