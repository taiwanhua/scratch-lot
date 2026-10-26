import {
  type BankDepositReceiptInput,
  bankDepositReceiptOf,
} from "./bank-deposit-receipt";
import {
  type DailyCloseReceiptInput,
  dailyCloseReceiptOf,
} from "./daily-close-receipt";
import {
  PURCHASE_RECEIVING_COPIES,
  PURCHASING_RECEIPTS_I18N,
  type PurchaseReceivingReceiptInput,
  purchaseReceivingReceiptOf,
} from "./purchase-receiving-receipt";
import type { ReceiptLayout, ReceiptTranslator } from "./receipt-layout";
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
  TRANSFER_PAYMENT_COPIES,
  type TransferPaymentReceiptInput,
  transferPaymentReceiptOf,
} from "./transfer-payment-receipt";
import {
  TRANSFER_RECEIVING_COPIES,
  type TransferReceivingReceiptInput,
  transferReceivingReceiptOf,
} from "./transfer-receiving-receipt";
import {
  TRANSFER_SHIPMENT_COPIES,
  type TransferShipmentReceiptInput,
  transferShipmentReceiptOf,
} from "./transfer-shipment-receipt";
import {
  type VaultDepositReceiptInput,
  vaultDepositReceiptOf,
} from "./vault-deposit-receipt";
import {
  type VaultWithdrawReceiptInput,
  vaultWithdrawReceiptOf,
} from "./vault-withdraw-receipt";

/**
 * 58mm 單據的種類(`printReceiptAfterCommit(kind, payload)` 的 `kind`)與各自的資料形狀。
 * 新的單據:在這裡加一種 + 一支版面函式(每張一檔)。
 */
export interface ReceiptPayloads {
  /** 進貨點收單(進貨單 [完成這次點收]) */
  "purchase-receiving": PurchaseReceivingReceiptInput;
  /** 調貨出貨單(調貨單第一關通過,含跳過) */
  "transfer-shipment": TransferShipmentReceiptInput;
  /** 調貨點收單(調貨單收貨店 [完成這次點收]) */
  "transfer-receiving": TransferReceivingReceiptInput;
  /** 調貨付款收據(收貨店付現金) */
  "transfer-payment": TransferPaymentReceiptInput;
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

export type ReceiptKind = keyof ReceiptPayloads;

export interface ReceiptKindDefinition<Payload> {
  /** 列印工作的 `documentType`(列印紀錄、失敗通知) */
  documentType: string;
  /**
   * 列印工作的 `refType`:已印次數、補印次數以 `refType` + `refId` 計。
   * 同一張提交可以有好幾種單據(調貨單有出貨單與付款收據),所以每種單據各用一個 `refType`
   */
  refType: string;
  /** 文案的 namespace(版面函式的 `t`) */
  i18n: string;
  refIdOf: (payload: Payload) => string;
  /** 單據所屬分店:印表機選單列這家店的印表機 */
  orgIdOf: (payload: Payload) => string;
  /** 使用處的預設印表機(收銀點的印表機);沒有 → 分店預設 */
  defaultPrinterIdOf: (payload: Payload) => string | null;
  /** 單據名稱(例「進貨點收單 P-0031」);列印紀錄、失敗通知上的名稱另依聯別加註(`receiptDocumentNameOf`) */
  documentNameOf: (payload: Payload, t: ReceiptTranslator) => string;
  /** 一聯的版面(各聯內容相同,聯別由 `receiptLayoutsOf` 填);`now` = 列印當下(ISO 時點) */
  layoutOf: (
    payload: Payload,
    t: ReceiptTranslator,
    now: string,
  ) => ReceiptLayout;
  /**
   * 一次列印印哪幾聯(依序;名稱文案 `<i18n>.<copyI18n>.copies.<聯>`);一聯的單據 = 空陣列。
   * 一次列印 = 各聯接成一張圖、聯與聯之間切紙 = 一個列印工作(已印 1 次);補印可選全部或其中一聯。
   */
  copies: readonly string[];
  /** 聯別名稱文案在 `i18n` 底下的位置(例 `purchaseReceiving`);一聯的單據不用 */
  copyI18n?: string;
}

export const RECEIPT_KINDS: {
  [Kind in ReceiptKind]: ReceiptKindDefinition<ReceiptPayloads[Kind]>;
} = {
  "purchase-receiving": {
    documentType: "lottery-purchase-receiving",
    refType: "lottery-purchase-receiving",
    i18n: PURCHASING_RECEIPTS_I18N,
    // 一次點收一張單據(已印 / 補印次數以批次計);沒有批次的舊資料以進貨單計
    refIdOf: (payload) => payload.batch?.batchId ?? payload.submissionId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: () => null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("purchaseReceiving.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t, now) => purchaseReceivingReceiptOf(payload, t, now),
    copies: PURCHASE_RECEIVING_COPIES,
    copyI18n: "purchaseReceiving",
  },
  "transfer-shipment": {
    documentType: "lottery-transfer-shipment",
    refType: "lottery-transfer-shipment",
    i18n: PURCHASING_RECEIPTS_I18N,
    refIdOf: (payload) => payload.submissionId,
    orgIdOf: (payload) => payload.fromBranchId,
    defaultPrinterIdOf: () => null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("transferShipment.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t, now) => transferShipmentReceiptOf(payload, t, now),
    copies: TRANSFER_SHIPMENT_COPIES,
    copyI18n: "transferShipment",
  },
  "transfer-receiving": {
    documentType: "lottery-transfer-receiving",
    refType: "lottery-transfer-receiving",
    i18n: PURCHASING_RECEIPTS_I18N,
    // 一次點收一張單據(同進貨點收單);沒有批次的舊資料以調貨單計
    refIdOf: (payload) => payload.batch?.batchId ?? payload.submissionId,
    orgIdOf: (payload) => payload.toBranchId,
    defaultPrinterIdOf: () => null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("transferReceiving.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t, now) => transferReceivingReceiptOf(payload, t, now),
    copies: TRANSFER_RECEIVING_COPIES,
    copyI18n: "transferReceiving",
  },
  "transfer-payment": {
    documentType: "lottery-transfer-payment",
    refType: "lottery-transfer-payment",
    i18n: PURCHASING_RECEIPTS_I18N,
    refIdOf: (payload) => payload.recordId,
    orgIdOf: (payload) => payload.branchId,
    defaultPrinterIdOf: (payload) => payload.defaultPrinterId ?? null,
    documentNameOf: (payload, t) =>
      t("documentName", {
        title: t("transferPayment.title"),
        serialNo: payload.serialNo ?? "",
      }),
    layoutOf: (payload, t) => transferPaymentReceiptOf(payload, t),
    copies: TRANSFER_PAYMENT_COPIES,
    copyI18n: "transferPayment",
  },
  // 店面的單據(規格第 12 章):現金流水類(投庫、出庫、存款)沒有單號,一筆流水一張(`refId` = 流水 id)
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

/** 某一種單據的定義(型別跟著 `kind` 走)。 */
export const receiptKindOf = <Kind extends ReceiptKind>(
  kind: Kind,
): ReceiptKindDefinition<ReceiptPayloads[Kind]> => RECEIPT_KINDS[kind];

/** 一次列印印全部的聯(補印對話框的預設選項;`receiptLayoutsOf` 的 `which` 預設)。 */
export const RECEIPT_ALL_COPIES = "all";

/** 第幾聯(從 1 起)與名稱(例「店鋪留存」);不是這張單據的聯 → null。 */
const copyOf = (
  definition: { copies: readonly string[]; copyI18n?: string },
  t: ReceiptTranslator,
  copy: string,
): { no: number; name: string } | null => {
  const index = definition.copies.indexOf(copy);
  return index === -1
    ? null
    : {
        no: index + 1,
        name: t(`${definition.copyI18n ?? ""}.copies.${copy}`),
      };
};

/** 聯別那一行(例「第 1 聯 · 店鋪留存」);不是這張單據的聯 → 空字串。 */
export const receiptCopyLineOf = (
  kind: ReceiptKind,
  t: ReceiptTranslator,
  copy: string,
): string => {
  const found = copyOf(RECEIPT_KINDS[kind], t, copy);
  return found === null ? "" : t("copyLine", found);
};

/**
 * 這一次要印的版面(依序;一次列印接成一張圖、聯與聯之間切紙):
 * 一聯的單據 → 一份;多聯的單據 → `which` = 全部時每一聯一份、指定一聯時只有那一聯,名稱下方印聯別。
 */
export const receiptLayoutsOf = <Kind extends ReceiptKind>(
  kind: Kind,
  payload: ReceiptPayloads[Kind],
  t: ReceiptTranslator,
  now: string,
  which: string = RECEIPT_ALL_COPIES,
): ReceiptLayout[] => {
  const definition = receiptKindOf(kind);
  const layout = definition.layoutOf(payload, t, now);
  if (definition.copies.length === 0) {
    return [layout];
  }
  const picked = definition.copies.includes(which)
    ? [which]
    : definition.copies;
  return picked.map((copy) => ({
    ...layout,
    copy: receiptCopyLineOf(kind, t, copy),
  }));
};

/**
 * 列印紀錄 / 失敗通知上的單據名稱:多聯的單據寫印了哪幾聯,補印另標「補印」
 * (例「進貨點收單 P-0001(兩聯)」「進貨點收單 P-0001(送貨人留存)補印」);一聯的單據維持原本的單據名稱(補印與否看列印紀錄的「次數」欄)。
 */
export const receiptDocumentNameOf = <Kind extends ReceiptKind>(
  kind: Kind,
  payload: ReceiptPayloads[Kind],
  t: ReceiptTranslator,
  {
    which = RECEIPT_ALL_COPIES,
    isReprint = false,
  }: { which?: string; isReprint?: boolean } = {},
): string => {
  const definition = receiptKindOf(kind);
  const name = definition.documentNameOf(payload, t);
  if (definition.copies.length === 0) {
    return name;
  }
  const one = copyOf(definition, t, which);
  const named = t("documentNameWithCopies", {
    name,
    copies:
      one === null
        ? t("allCopies", { count: definition.copies.length })
        : one.name,
  });
  return isReprint ? t("documentNameReprint", { name: named }) : named;
};

/**
 * 補印對話框的「補印哪一聯」:全部(預設)、第 1 聯、第 2 聯…;一聯的單據 → null(對話框不多這個選單)。
 */
export const receiptReprintVariantsOf = (
  kind: ReceiptKind,
  t: ReceiptTranslator,
): { label: string; options: { value: string; label: string }[] } | null => {
  const { copies } = RECEIPT_KINDS[kind];
  if (copies.length === 0) {
    return null;
  }
  return {
    label: t("reprintCopies"),
    options: [
      {
        value: RECEIPT_ALL_COPIES,
        label: t("reprintAllCopies", { count: copies.length }),
      },
      ...copies.map((copy) => ({
        value: copy,
        label: receiptCopyLineOf(kind, t, copy),
      })),
    ],
  };
};

/** 列印按鈕 / 列印工作要的單據識別:所屬分店、類型、`refType` + `refId`、名稱(一次印全部的聯)、預設印表機。 */
export const receiptPrintRefOf = <Kind extends ReceiptKind>(
  kind: Kind,
  payload: ReceiptPayloads[Kind],
  t: ReceiptTranslator,
) => {
  const definition = receiptKindOf(kind);
  return {
    orgId: definition.orgIdOf(payload),
    documentType: definition.documentType,
    refType: definition.refType,
    refId: definition.refIdOf(payload),
    documentName: receiptDocumentNameOf(kind, payload, t),
    defaultPrinterId: definition.defaultPrinterIdOf(payload),
  };
};
