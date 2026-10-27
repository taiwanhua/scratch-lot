import {
  type ReceiptLayout,
  type ReceiptTranslator,
  qrOf,
  receiptMoney,
} from "./receipt-layout";
import { type CashMovementReceiptBase, noteBlocks } from "./store-receipts";

export interface BankDepositReceiptInput extends CashMovementReceiptBase {
  /** 經手人(按 [存銀行] 的人) */
  handler: string;
  /** 存入帳戶的名稱 */
  accountName: string;
}

/**
 * 存款單(規格第 12 章、6.11;Figma RC-03 `68:1858`):[存銀行] 時自動印。
 * 分店、經手人、存入帳戶、備註、金額;QR 連到即時現金帳那一筆「存銀行」;簽名欄 經手人。
 */
export const bankDepositReceiptOf = (
  input: BankDepositReceiptInput,
  t: ReceiptTranslator,
  now: string,
): ReceiptLayout => ({
  title: t("bankDeposit.title"),
  documentNo: "",
  time: now,
  blocks: [
    { type: "divider" },
    { type: "row", label: t("branch"), value: input.branchName },
    { type: "row", label: t("handler"), value: input.handler },
    {
      type: "row",
      label: t("bankDeposit.account"),
      value: input.accountName,
    },
    ...noteBlocks(input.note, t("note")),
    {
      type: "total",
      label: t("amount"),
      value: receiptMoney(input.amount),
    },
    { type: "divider" },
  ],
  qr: qrOf(input.url, t("qrCaption")),
  signatures: [t("handlerSign")],
});
