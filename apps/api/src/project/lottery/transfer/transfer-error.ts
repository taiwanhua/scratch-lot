import { GraphQLError } from "graphql";

/**
 * 調貨單的業務錯誤(GQL-04):只用通用碼,細分原因放 `extensions.reason`
 * (正本 `docs/modules/project/purchasing.md`「調貨單」的錯誤碼)。掛接點擋下的專案錯誤碼也列在這裡。
 */
export const TRANSFER_REASONS = {
  /** 明細沒有任何一列:送出擋下 */
  noLines: "TRANSFER_NO_LINES",
  /** 出貨分店 / 收貨分店沒填、相同,或出貨分店不在送出的人的可見範圍:送出擋下 */
  branchInvalid: "TRANSFER_BRANCH_INVALID",
  /** 明細的本不存在 / 已撤銷、方式不合(整本要沒拆過、選張要拆過)、張數 / 金額 / 批購金額率不合、同一張重複:送出擋下 */
  lineInvalid: "TRANSFER_LINE_INVALID",
  /** 選張但沒有 `purchasing.transfer.partial-tickets`:送出擋下 */
  partialForbidden: "TRANSFER_PARTIAL_FORBIDDEN",
  /** 本或張不在出貨店、不是未售、被鎖定,或在其他未結束的調貨單上:送出擋下 */
  ticketsUnavailable: "TRANSFER_TICKETS_UNAVAILABLE",
  /** 已點收的列被改或刪(rowId 比對):送出擋下 */
  receivedRowChanged: "TRANSFER_RECEIVED_ROW_CHANGED",
  /** 叫貨單不是收貨分店的待購買叫貨單:送出擋下 */
  requisitionInvalid: "TRANSFER_REQUISITION_INVALID",
  /** 還有沒點收的張(整本的列沒刷、選張的列沒到齊):核准(點收關卡)擋下 */
  unreceivedRows: "TRANSFER_UNRECEIVED_ROWS",
  /** 核准前:收貨店還沒付夠(收貨店已付 < 調貨金額) */
  receiverUnderpaid: "TRANSFER_RECEIVER_UNDERPAID",
  /** 核准前:出貨店還沒記收款(出貨店已收 < 調貨金額) */
  shipperUnreceived: "TRANSFER_SHIPPER_UNRECEIVED",
  /** 核准前:出貨店多收,請先記退款 */
  shipperOverreceived: "TRANSFER_SHIPPER_OVERRECEIVED",
  /** 核准前:收貨店多付,請記收到退款 */
  receiverOverpaid: "TRANSFER_RECEIVER_OVERPAID",
  /** 已有點收:駁回 / 刪除擋下 */
  hasReceipts: "TRANSFER_HAS_RECEIPTS",
  /** 調入後已售、再調出或拆本:作廢擋下 */
  booksInUse: "TRANSFER_BOOKS_IN_USE",
  /** 點收:單據不在審核中,或操作者沒有這張單的點收任務(第二關) */
  notReceivable: "TRANSFER_NOT_RECEIVABLE",
  /** 點收:看不懂的碼 */
  scanInvalid: "TRANSFER_SCAN_INVALID",
  /** 點收:正面的碼對到單上好幾款遊戲同本號、沒選遊戲(`extensions.gameIds` = 對到的遊戲) */
  scanAmbiguousGame: "TRANSFER_SCAN_AMBIGUOUS_GAME",
  /** 點收:這一列 / 這幾張已點收(`extensions.ticketNos` = 已點收的張號,選張的列) */
  alreadyReceived: "TRANSFER_ALREADY_RECEIVED",
  /** 點收:整本的列不能在格子上逐張點收(刷一張 = 整列) */
  wholeRowTickets: "TRANSFER_WHOLE_ROW_TICKETS",
  /** 點收:這列還沒出貨(第一關還沒通過) */
  notShipped: "TRANSFER_NOT_SHIPPED",
  /** 點收:這本屬於送往別家分店的調貨單(送錯分店) */
  wrongStore: "TRANSFER_WRONG_STORE",
  /** 點收:這本 / 這張不在這張調貨單上 */
  bookNotOnTransfer: "TRANSFER_BOOK_NOT_ON_TRANSFER",
} as const;

export type TransferReason =
  (typeof TRANSFER_REASONS)[keyof typeof TRANSFER_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function validationError(
  message: string,
  fields: string[],
  reason?: TransferReason,
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
  reason: TransferReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}
