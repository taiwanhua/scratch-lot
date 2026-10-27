import { type ReceiptBlock, receiptMoney } from "./receipt-layout";

/**
 * 店面管理的 58mm 單據(規格第 12 章;Figma 店面 65:14 58mm 區)共用的東西:文案 namespace、金額的正負號。
 * 每張單據一支版面函式(`vault-deposit-receipt.ts`…),種類登記在 `receipt-kinds.ts`。
 */
export const STORE_RECEIPTS_I18N = "admin.lotteryStore.receipts";

/** 差額的正負號(0 不加號;例 `-300`、`+100`)。 */
export const receiptSignedMoney = (value: number): string => {
  if (value > 0) {
    return `+${receiptMoney(value)}`;
  }
  return value < 0 ? `-${receiptMoney(-value)}` : "0";
};

/** 現金流水類單據(投庫、出庫、存款)共通的資料:這筆流水、分店、印的當下。 */
export interface CashMovementReceiptBase {
  /** 這筆現金流水 id:列印紀錄的 `refId`,QR 連到即時現金帳那一筆(`?movementId=`) */
  movementId: string;
  branchId: string;
  branchName: string;
  amount: number;
  note: string | null;
  /** 印表機:收銀點的印表機;沒有就用分店預設 */
  defaultPrinterId?: string | null;
  /** 即時現金帳那一筆的連結 */
  url: string | null;
}

/** 備註:有填才印。 */
export const noteBlocks = (
  note: string | null,
  label: string,
): ReceiptBlock[] =>
  note === null || note.trim() === ""
    ? []
    : [{ type: "row", label, value: note.trim() }];
