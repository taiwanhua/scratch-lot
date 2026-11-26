import { WHOLESALE_SETTLEMENT_SIDE } from "@repo/domain/project/lottery";
import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import {
  type ReceiptLayout,
  type ReceiptTranslator,
  qrOf,
  receiptMoney,
} from "./receipt-layout";

/** 批售收款收據印兩聯(規格 21.8):第 1 聯 店鋪留存、第 2 聯 客戶留存(文案 `wholesalePayment.copies.*`)。 */
export const WHOLESALE_PAYMENT_COPIES = ["store", "customer"] as const;

/** 現金進哪裡:小金庫,或收銀點抽屜(有收銀點名稱就印名稱)。 */
export type WholesalePaymentPlace = "vault" | "drawer";

export interface WholesalePaymentReceiptInput {
  /** 這筆收款(現金流水)id:列印紀錄的 `refId`,一筆收款一張收據 */
  recordId: string;
  serialNo: string | null;
  /** 出貨分店(收款的店):印表機選單依它 */
  branchId: string;
  branchName: string;
  /** 批售客戶的店名 */
  customerName: string;
  place: WholesalePaymentPlace;
  /** 收進收銀點抽屜時的收銀點名稱;沒有就印「收銀點抽屜」 */
  cashPointName?: string | null;
  /** 經手人(收款視窗的經手人,現金必填) */
  handler: string;
  amount: number;
  /** 收款時間(ISO 時點) */
  occurredAt: string;
  /** 印表機:收銀點的印表機;沒有就用分店預設 */
  defaultPrinterId?: string | null;
  url: string | null;
}

/**
 * 批售收款收據(規格 21.8;Figma RC-12 `930:64906`):[收款] 選現金、寫入成功後印,
 * 單號、批售客戶、現金進(分店 · 小金庫 / 收銀點)、經手人、現金金額、QR;簽名欄 經手人、客戶簽名。
 * 兩聯(`WHOLESALE_PAYMENT_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const wholesalePaymentReceiptOf = (
  input: WholesalePaymentReceiptInput,
  t: ReceiptTranslator,
): ReceiptLayout => {
  const place =
    input.place === "drawer"
      ? (input.cashPointName ?? t("wholesalePayment.places.drawer"))
      : t("wholesalePayment.places.vault");
  return {
    title: t("wholesalePayment.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: input.occurredAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("wholesalePayment.customer"),
        value: input.customerName,
      },
      {
        type: "row",
        label: t("wholesalePayment.place"),
        value: t("wholesalePayment.placeValue", {
          branch: input.branchName,
          place,
        }),
      },
      {
        type: "row",
        label: t("wholesalePayment.handler"),
        value: input.handler,
      },
      {
        type: "total",
        label: t("wholesalePayment.cash"),
        value: receiptMoney(input.amount),
      },
      { type: "divider" },
    ],
    qr: qrOf(input.url, t("qrCaption")),
    signatures: [
      t("wholesalePayment.handlerSign"),
      t("wholesalePayment.customerSign"),
    ],
  };
};

type Settlement = LotterySettlementFieldsFragment;
type SettlementRecord = Settlement["records"][number];

/** 出貨店收的現金(收款收據要印的那種):出貨店這一邊、現金、收入、不是沖正也沒被沖正。 */
const isShipperCashReceipt = (record: SettlementRecord): boolean =>
  record.side === WHOLESALE_SETTLEMENT_SIDE &&
  record.method === "cash" &&
  record.direction === "in" &&
  record.reversalOf === null &&
  record.reversedById === null;

/**
 * 收付紀錄 → 批售收款收據的資料;不是批售單出貨店收的現金(銀行、退款、沖正、其他單據)→ `null`(不印)。
 */
export const wholesalePaymentInputOf = (
  settlement: Settlement,
  recordId: string,
  url: string | null,
): WholesalePaymentReceiptInput | null => {
  const record = settlement.records.find((item) => item.id === recordId);
  const side = settlement.sides.find(
    (item) => item.side === WHOLESALE_SETTLEMENT_SIDE,
  );
  if (
    settlement.kind !== "wholesale" ||
    record === undefined ||
    side === undefined ||
    !isShipperCashReceipt(record)
  ) {
    return null;
  }
  return {
    recordId: record.id,
    serialNo: settlement.docNo,
    branchId: side.branch.id,
    branchName: side.branch.name,
    customerName: settlement.counterparty,
    place: record.cashPlace === "drawer" ? "drawer" : "vault",
    cashPointName: record.cashPointName ?? null,
    // 收進抽屜的:收銀點的印表機當預設(沒設定 → 分店預設)
    defaultPrinterId: record.cashPointPrinterId ?? null,
    handler: record.handler ?? "",
    amount: record.amount,
    occurredAt: record.occurredAt,
    url,
  };
};

/** 檢視頁的 [列印](補印)印最近一筆出貨店收的現金;沒有 → `null`(不出現按鈕)。 */
export const latestWholesalePaymentInputOf = (
  settlement: Settlement,
  url: string | null,
): WholesalePaymentReceiptInput | null => {
  const latest = settlement.records.findLast((record) =>
    isShipperCashReceipt(record),
  );
  return latest === undefined
    ? null
    : wholesalePaymentInputOf(settlement, latest.id, url);
};
