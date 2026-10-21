import {
  PURCHASE_RECEIVING_COPIES,
  PURCHASING_RECEIPTS_I18N,
  type PurchaseReceivingReceiptInput,
  purchaseReceivingReceiptOf,
} from "./purchase-receiving-receipt";
import type { ReceiptLayout, ReceiptTranslator } from "./receipt-layout";
import {
  type TransferPaymentReceiptInput,
  transferPaymentReceiptOf,
} from "./transfer-payment-receipt";
import {
  type TransferShipmentReceiptInput,
  transferShipmentReceiptOf,
} from "./transfer-shipment-receipt";

/**
 * 58mm 單據的種類(`printReceiptAfterCommit(kind, payload)` 的 `kind`)與各自的資料形狀。
 * 新的單據:在這裡加一種 + 一支版面函式(每張一檔)。
 */
export interface ReceiptPayloads {
  /** 進貨點收單(進貨單 [完成這次點收]) */
  "purchase-receiving": PurchaseReceivingReceiptInput;
  /** 調貨出貨單(調貨單第一關通過,含跳過) */
  "transfer-shipment": TransferShipmentReceiptInput;
  /** 調貨付款收據(收貨店付現金) */
  "transfer-payment": TransferPaymentReceiptInput;
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
  /** 列印失敗通知上的單據名稱(例「進貨點收單 P-0031」) */
  documentNameOf: (payload: Payload, t: ReceiptTranslator) => string;
  /** [列印] / [補印] 按鈕印的那一張;`now` = 列印當下(ISO 時點) */
  layoutOf: (
    payload: Payload,
    t: ReceiptTranslator,
    now: string,
  ) => ReceiptLayout;
  /** 交易後自動印的每一張(進貨點收單兩張:店鋪留存、送貨人留存) */
  copiesOf: (
    payload: Payload,
    t: ReceiptTranslator,
    now: string,
  ) => ReceiptLayout[];
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
    layoutOf: (payload, t, now) =>
      purchaseReceivingReceiptOf(payload, t, null, now),
    copiesOf: (payload, t, now) =>
      PURCHASE_RECEIVING_COPIES.map((copy) =>
        purchaseReceivingReceiptOf(payload, t, copy, now),
      ),
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
    copiesOf: (payload, t, now) => [transferShipmentReceiptOf(payload, t, now)],
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
    copiesOf: (payload, t) => [transferPaymentReceiptOf(payload, t)],
  },
};

/** 某一種單據的定義(型別跟著 `kind` 走)。 */
export const receiptKindOf = <Kind extends ReceiptKind>(
  kind: Kind,
): ReceiptKindDefinition<ReceiptPayloads[Kind]> => RECEIPT_KINDS[kind];

/** 列印按鈕 / 列印工作要的單據識別:所屬分店、類型、`refType` + `refId`、名稱、預設印表機。 */
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
    documentName: definition.documentNameOf(payload, t),
    defaultPrinterId: definition.defaultPrinterIdOf(payload),
  };
};
