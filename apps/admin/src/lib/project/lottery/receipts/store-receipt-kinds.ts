import {
  type BankDepositReceiptInput,
  bankDepositReceiptOf,
} from "./bank-deposit-receipt";
import {
  type DailyCloseReceiptInput,
  dailyCloseReceiptOf,
} from "./daily-close-receipt";
import type { ReceiptKindDefinition } from "./receipt-kind-definition";
import {
  type SaleRefundReceiptInput,
  saleRefundReceiptOf,
} from "./sale-refund-receipt";
import {
  type ShiftCheckoutReceiptInput,
  shiftCheckoutReceiptOf,
} from "./shift-checkout-receipt";
import { STORE_RECEIPTS_I18N } from "./store-receipts";
import {
  type VaultDepositReceiptInput,
  vaultDepositReceiptOf,
} from "./vault-deposit-receipt";
import {
  type VaultWithdrawReceiptInput,
  vaultWithdrawReceiptOf,
} from "./vault-withdraw-receipt";

/** 店面管理的 58mm 單據種類(規格第 12 章)與各自的資料形狀;併進 `receipt-kinds.ts` 的 `ReceiptPayloads` / `RECEIPT_KINDS`。 */
export interface StoreReceiptPayloads {
  /** 投庫單(看板 [投庫]) */
  "store-vault-deposit": VaultDepositReceiptInput;
  /** 出庫單(看板 [出庫]、開班從小金庫領零用金) */
  "store-vault-withdraw": VaultWithdrawReceiptInput;
  /** 存款單(看板 [存銀行]) */
  "store-bank-deposit": BankDepositReceiptInput;
  /** 交班結帳單(結帳確認申請,類型 = 交班) */
  "store-shift-checkout": ShiftCheckoutReceiptInput;
  /** 日結單(結帳確認申請,類型 = 日結) */
  "store-daily-close": DailyCloseReceiptInput;
  /** 退貨退款收據(撤銷售出申請,退款給客人 = 是) */
  "store-sale-refund": SaleRefundReceiptInput;
}

export const STORE_RECEIPT_KINDS: {
  [Kind in keyof StoreReceiptPayloads]: ReceiptKindDefinition<
    StoreReceiptPayloads[Kind]
  >;
} = {
  // 現金流水類(投庫、出庫、存款)沒有單號,一筆流水一張(`refId` = 流水 id)
  "store-vault-deposit": {
    documentType: "lottery-store-vault-deposit",
    refType: "lottery-store-vault-deposit",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.movementId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId ?? null,
    documentNameOf: (payload, t) =>
      t("documentNameNoSerial", {
        title: t("vaultDeposit.title"),
        branch: payload.branchName,
      }),
    layoutOf: (payload, t, now) => vaultDepositReceiptOf(payload, t, now),
    copies: [],
  },
  "store-vault-withdraw": {
    documentType: "lottery-store-vault-withdraw",
    refType: "lottery-store-vault-withdraw",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.movementId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId ?? null,
    documentNameOf: (payload, t) =>
      t("documentNameNoSerial", {
        title: t("vaultWithdraw.title"),
        branch: payload.branchName,
      }),
    layoutOf: (payload, t, now) => vaultWithdrawReceiptOf(payload, t, now),
    copies: [],
  },
  "store-bank-deposit": {
    documentType: "lottery-store-bank-deposit",
    refType: "lottery-store-bank-deposit",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.movementId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId ?? null,
    documentNameOf: (payload, t) =>
      t("documentNameNoSerial", {
        title: t("bankDeposit.title"),
        branch: payload.branchName,
      }),
    layoutOf: (payload, t, now) => bankDepositReceiptOf(payload, t, now),
    copies: [],
  },
  "store-shift-checkout": {
    documentType: "lottery-store-shift-checkout",
    refType: "lottery-store-shift-checkout",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.submissionId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("shiftCheckout.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t) => shiftCheckoutReceiptOf(payload, t),
    copies: [],
  },
  "store-daily-close": {
    documentType: "lottery-store-daily-close",
    refType: "lottery-store-daily-close",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.submissionId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: () => null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("dailyClose.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t) => dailyCloseReceiptOf(payload, t),
    copies: [],
  },
  "store-sale-refund": {
    documentType: "lottery-store-sale-refund",
    refType: "lottery-store-sale-refund",
    i18n: STORE_RECEIPTS_I18N,
    refIdOf: (payload) => payload.submissionId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId ?? null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("saleRefund.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t, now) => saleRefundReceiptOf(payload, t, now),
    copies: [],
  },
};
