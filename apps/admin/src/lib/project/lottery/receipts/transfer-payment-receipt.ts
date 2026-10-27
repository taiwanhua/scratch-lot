import { TRANSFER_SETTLEMENT_SIDE } from "@repo/domain/project/lottery";
import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import {
  type ReceiptLayout,
  type ReceiptTranslator,
  receiptMoney,
} from "./receipt-layout";

/** 調貨付款收據印兩聯(規格第 12 章、8.4):第 1 聯 收貨店留存、第 2 聯 送貨人留存(文案 `transferPayment.copies.*`)。 */
export const TRANSFER_PAYMENT_COPIES = ["receiver", "courier"] as const;

/** 現金從哪裡付:小金庫,或收銀點抽屜(店面的功能接上後可帶收銀點名稱)。 */
export type TransferPaymentSource = "vault" | "drawer";

export interface TransferPaymentReceiptInput {
  /** 這筆付款(現金流水)id:列印紀錄的 `refId`,一筆付款一張收據 */
  recordId: string;
  serialNo: string | null;
  /** 收貨分店(付款的店):印表機選單依它 */
  branchId: string;
  branchName: string;
  source: TransferPaymentSource;
  /** 從收銀點抽屜付時的收銀點名稱;沒有就印「收銀點抽屜」 */
  cashPointName?: string | null;
  /** 收款人(付款視窗的經手 / 收款人,現金必填) */
  payee: string;
  amount: number;
  /** 付款時間(ISO 時點) */
  occurredAt: string;
  /** 印表機:收銀點的印表機;沒有就用分店預設 */
  defaultPrinterId?: string | null;
  url: string;
}

/**
 * 調貨付款收據(規格第 12 章、8.4;Figma RC-07 `102:23493`):收貨店付現金時印,
 * 單號、付款店(分店 · 現金來源)、收款人、現金金額;簽名欄 付款人、送貨人簽收。
 * 兩聯(`TRANSFER_PAYMENT_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const transferPaymentReceiptOf = (
  input: TransferPaymentReceiptInput,
  t: ReceiptTranslator,
): ReceiptLayout => {
  const source =
    input.source === "drawer"
      ? (input.cashPointName ?? t("transferPayment.sources.drawer"))
      : t("transferPayment.sources.vault");
  return {
    title: t("transferPayment.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: input.occurredAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("transferPayment.payer"),
        value: t("transferPayment.payerValue", {
          branch: input.branchName,
          source,
        }),
      },
      { type: "row", label: t("transferPayment.payee"), value: input.payee },
      {
        type: "total",
        label: t("transferPayment.cash"),
        value: receiptMoney(input.amount),
      },
      { type: "divider" },
    ],
    qr: { value: input.url, caption: t("qrCaption") },
    signatures: [
      t("transferPayment.payerSign"),
      t("transferPayment.courierSign"),
    ],
  };
};

type Settlement = LotterySettlementFieldsFragment;
type SettlementRecord = Settlement["records"][number];

/** 收貨店付的現金(付款收據要印的那種):收貨店這一邊、現金、支出、不是沖正也沒被沖正。 */
const isReceiverCashPayment = (record: SettlementRecord): boolean =>
  record.side === TRANSFER_SETTLEMENT_SIDE.receiver &&
  record.method === "cash" &&
  record.direction === "out" &&
  record.reversalOf === null &&
  record.reversedById === null;

/**
 * 收付紀錄 → 付款收據的資料;不是調貨單收貨店付的現金(銀行、出貨店、收到退款、沖正)→ `null`(不印)。
 */
export const transferPaymentInputOf = (
  settlement: Settlement,
  recordId: string,
  url: string,
): TransferPaymentReceiptInput | null => {
  const record = settlement.records.find((item) => item.id === recordId);
  const side = settlement.sides.find(
    (item) => item.side === TRANSFER_SETTLEMENT_SIDE.receiver,
  );
  if (
    settlement.kind !== "transfer" ||
    record === undefined ||
    side === undefined ||
    !isReceiverCashPayment(record)
  ) {
    return null;
  }
  return {
    recordId: record.id,
    serialNo: settlement.docNo,
    branchId: side.branch.id,
    branchName: side.branch.name,
    source: record.cashPlace === "drawer" ? "drawer" : "vault",
    cashPointName: record.cashPointName ?? null,
    // 抽屜付的:收銀點的印表機當預設(沒設定 → 分店預設)
    defaultPrinterId: record.cashPointPrinterId ?? null,
    payee: record.handler ?? "",
    amount: record.amount,
    occurredAt: record.occurredAt,
    url,
  };
};

/** 檢視頁的 [列印](補印)印最近一筆收貨店付的現金;沒有 → `null`(不出現按鈕)。 */
export const latestTransferPaymentInputOf = (
  settlement: Settlement,
  url: string,
): TransferPaymentReceiptInput | null => {
  const latest = settlement.records.findLast((record) =>
    isReceiverCashPayment(record),
  );
  return latest === undefined
    ? null
    : transferPaymentInputOf(settlement, latest.id, url);
};
