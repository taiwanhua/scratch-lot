import {
  type ReceiptLayout,
  type ReceiptTranslator,
  qrOf,
  receiptMoney,
} from "./receipt-layout";
import { type CashMovementReceiptBase, noteBlocks } from "./store-receipts";

export interface VaultWithdrawReceiptInput extends CashMovementReceiptBase {
  cashPointName: string;
  /** 出庫原因的名稱(欄位管理「出庫原因」;開班領零用金 =「開班零用金」) */
  reasonLabel: string;
}

/**
 * 出庫單(規格第 12 章、6.7、6.6;Figma RC-02 `102:23345`):出庫時、開班從小金庫領零用金時自動印。
 * 分店、方向(小金庫 → 收銀點抽屜)、原因、金額;QR 連到即時現金帳那一筆;簽名欄 領取人、見證人。
 */
export const vaultWithdrawReceiptOf = (
  input: VaultWithdrawReceiptInput,
  t: ReceiptTranslator,
  now: string,
): ReceiptLayout => ({
  title: t("vaultWithdraw.title"),
  documentNo: "",
  time: now,
  blocks: [
    { type: "divider" },
    { type: "row", label: t("branch"), value: input.branchName },
    {
      type: "row",
      label: t("direction"),
      value: t("vaultWithdraw.directionValue", {
        cashPoint: input.cashPointName,
      }),
    },
    { type: "row", label: t("reason"), value: input.reasonLabel },
    ...noteBlocks(input.note, t("note")),
    {
      type: "total",
      label: t("amount"),
      value: receiptMoney(input.amount),
    },
    { type: "divider" },
  ],
  qr: qrOf(input.url, t("qrCaption")),
  signatures: [t("vaultWithdraw.receiverSign"), t("witnessSign")],
});
