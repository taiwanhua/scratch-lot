import { GraphQLError } from "graphql";

/**
 * 進貨單的業務錯誤(GQL-04):只用通用碼,細分原因放 `extensions.reason`
 * (正本 `docs/modules/project/purchasing.md`「進貨單」的錯誤碼)。掛接點擋下的專案錯誤碼也列在這裡。
 */
export const PURCHASE_REASONS = {
  /** 明細沒有任何一列:送出擋下 */
  noLines: "PURCHASE_NO_LINES",
  /** 明細的本號 / 最後張號 / 張數 / 整本金額 / 批購金額率不合(和遊戲不符):送出擋下 */
  lineInvalid: "PURCHASE_LINE_INVALID",
  /** 明細有停售(或已刪除)的遊戲:送出擋下 */
  gameDiscontinued: "PURCHASE_GAME_DISCONTINUED",
  /** 本號和這張單的其他列、其他有效進貨單或既有的本重複:送出擋下 */
  bookDuplicate: "PURCHASE_BOOK_DUPLICATE",
  /** 已點收的列被改或刪(rowId 比對):送出擋下 */
  receivedRowChanged: "PURCHASE_RECEIVED_ROW_CHANGED",
  /** 叫貨單不是同一家分店的待購買叫貨單:送出擋下 */
  requisitionInvalid: "PURCHASE_REQUISITION_INVALID",
  /** 批購甲類不是營業中的甲類:送出擋下 */
  dealerInvalid: "PURCHASE_DEALER_INVALID",
  /** 本人批購 = 否時受託人沒填、不是這位甲類啟用中的受託人:送出擋下 */
  trusteeInvalid: "PURCHASE_TRUSTEE_INVALID",
  /** 扣款帳戶沒填、停用或使用組織不含進貨分店:送出擋下 */
  accountInvalid: "PURCHASE_ACCOUNT_INVALID",
  /** 還有沒點收的列:核准擋下 */
  unreceivedRows: "PURCHASE_UNRECEIVED_ROWS",
  /** 已有點收:駁回 / 刪除擋下 */
  hasReceipts: "PURCHASE_HAS_RECEIPTS",
  /** 有本已售、已調出或已拆本:作廢擋下 */
  booksInUse: "PURCHASE_BOOKS_IN_USE",
  /** 點收:單據不在審核中,或操作者沒有這張單的點收任務 */
  notReceivable: "PURCHASE_NOT_RECEIVABLE",
  /** 點收:看不懂的碼 */
  scanInvalid: "PURCHASE_SCAN_INVALID",
  /** 點收:這一列已點收 */
  alreadyReceived: "PURCHASE_ALREADY_RECEIVED",
  /** 點收:刷到的最後張號和單上不同 → 請退回更正 */
  lastTicketMismatch: "PURCHASE_LAST_TICKET_MISMATCH",
  /** 點收:這本屬於別家分店的進貨單(送錯分店) */
  wrongStore: "PURCHASE_WRONG_STORE",
  /** 點收:這本不在這張單上(也不是別家分店的) */
  bookNotOnPurchase: "PURCHASE_BOOK_NOT_ON_PURCHASE",
} as const;

export type PurchaseReason =
  (typeof PURCHASE_REASONS)[keyof typeof PURCHASE_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function validationError(
  message: string,
  fields: string[],
  reason?: PurchaseReason,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
      ...extra,
    },
  });
}

export function forbiddenError(
  message: string,
  reason: PurchaseReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}
