import type { ReceiptLayout, ReceiptTranslator } from "./receipt-layout";

/** 一種 58mm 單據的定義(`receipt-kinds.ts` 的 `RECEIPT_KINDS` 每一項)。 */
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
