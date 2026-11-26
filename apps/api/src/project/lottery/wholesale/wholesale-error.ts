import { GraphQLError } from "graphql";

/**
 * 批售單的業務錯誤(GQL-04):只用通用碼,細分原因放 `extensions.reason`
 * (正本 `docs/modules/project/purchasing.md`「批售單」的錯誤碼)。掛接點擋下的專案錯誤碼都列在這裡。
 */
export const WHOLESALE_REASONS = {
  /** 出貨分店沒填,或不在送出的人的可見範圍:送出擋下 */
  branchInvalid: "WHOLESALE_BRANCH_INVALID",
  /** 批售客戶不是往來中,或送出的人讀不到:送出擋下 */
  customerInvalid: "WHOLESALE_CUSTOMER_INVALID",
  /** 明細沒有任何一列:送出擋下 */
  noLines: "WHOLESALE_NO_LINES",
  /** 明細的本不存在 / 已撤銷、遊戲不同、張數 / 整本金額 / 批購金額率 / 批售金額不合、同一本重複:送出擋下 */
  lineInvalid: "WHOLESALE_LINE_INVALID",
  /** 本不是未拆整本在出貨分店庫存、被單據鎖住:送出擋下(`extensions.books`);核准前的保險檢查也用它 */
  bookUnavailable: "WHOLESALE_BOOK_UNAVAILABLE",
  /** 從帳戶入帳的入帳帳戶停用、使用組織不含出貨分店、送出的人看不到:送出、核准擋下 */
  accountInvalid: "WHOLESALE_ACCOUNT_INVALID",
  /** 已經登記收款(已收淨額不是 0)不能改成「從帳戶入帳」:送出擋下 */
  modeHasReceipts: "WHOLESALE_MODE_HAS_RECEIPTS",
  /** 收到錢再核准:已收 < 批售金額,核准擋下 */
  unreceived: "WHOLESALE_UNRECEIVED",
  /** 收到錢再核准:已收 > 批售金額,核准擋下(先記退款) */
  overreceived: "WHOLESALE_OVERRECEIVED",
  /** 刪除:只限草稿 */
  notDraft: "WHOLESALE_NOT_DRAFT",
  /** 批售出去的張不再是已批售、或最後一筆事件不是這張單的「批售」:作廢擋下 */
  booksInUse: "WHOLESALE_BOOKS_IN_USE",
} as const;

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 送出擋下的一本與原因(`extensions.books`)。 */
export interface UnavailableBook {
  rowId: string;
  bookId: string;
  gameCode: string;
  bookNo: string;
  /** `WholesaleBookProblem.kind` */
  problem: string;
  /** 鎖住它的單據(調貨單 / 批售單)的單號 */
  lockedSerialNo: string | null;
}

/** 本不能批售:守門的 `{ code, message }` 帶不了哪幾本,直接拋(同一個通用碼 + reason,另帶 `books`)。 */
export function bookUnavailableError(
  books: readonly UnavailableBook[],
): GraphQLError {
  return new GraphQLError("Some books cannot be wholesaled", {
    extensions: {
      code: "FORBIDDEN",
      reason: WHOLESALE_REASONS.bookUnavailable,
      books,
    },
  });
}
