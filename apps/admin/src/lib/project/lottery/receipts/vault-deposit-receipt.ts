import {
  type ReceiptLayout,
  type ReceiptTranslator,
  receiptMoney,
} from "./receipt-layout";
import { type CashMovementReceiptBase, noteBlocks } from "./store-receipts";

export interface VaultDepositReceiptInput extends CashMovementReceiptBase {
  cashPointName: string;
}

/**
 * 投庫單(規格第 12 章、6.7;Figma RC-01 `102:23305`):投庫時自動印。
 * 分店、收銀點、方向(抽屜 → 小金庫)、金額;現金流水沒有單號與詳情頁,QR 連到即時現金帳那一筆;
 * 簽名欄 投庫人、見證人。`now` = 印的當下(交易剛完成)。
 */
export const vaultDepositReceiptOf = (
  input: VaultDepositReceiptInput,
  t: ReceiptTranslator,
  now: string,
): ReceiptLayout => ({
  title: t("vaultDeposit.title"),
  documentNo: "",
  time: now,
  blocks: [
    { type: "divider" },
    { type: "row", label: t("branch"), value: input.branchName },
    { type: "row", label: t("cashPoint"), value: input.cashPointName },
    {
      type: "row",
      label: t("direction"),
      value: t("vaultDeposit.directionValue"),
    },
    ...noteBlocks(input.note, t("note")),
    {
      type: "total",
      label: t("amount"),
      value: receiptMoney(input.amount),
    },
    { type: "divider" },
  ],
  qr: { value: input.url, caption: t("qrCaption") },
  signatures: [t("vaultDeposit.depositorSign"), t("witnessSign")],
});
