import { GraphQLError } from "graphql";

/**
 * 張數帳本的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `CONFLICT` / `FORBIDDEN`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/inventory.md`「錯誤碼」)。
 */
export const INVENTORY_REASONS = {
  /** 張已被處理(狀態或版本不是呼叫端讀到的、被鎖定、或同一個事件 id 已寫過別的內容) */
  ticketAlreadyProcessed: "TICKET_ALREADY_PROCESSED",
  /** 跨店寫入只能把張移進操作者看得到的店(調入、尋回) */
  crossStoreNotAllowed: "CROSS_STORE_NOT_ALLOWED",
  /** 點收分店不在操作者當前組織的租戶 */
  storeOutsideTenant: "STORE_OUTSIDE_TENANT",
  /** 本編號在租戶內重複 */
  bookKeyDuplicate: "BOOK_KEY_DUPLICATE",
  /** 迄號不在「標準張數 ~ 999」之間 */
  lastTicketNoOutOfRange: "LAST_TICKET_NO_OUT_OF_RANGE",
  /** 更正跳號:這本沒有跳號(跳號在拆本時標註) */
  noSkippedTickets: "NO_SKIPPED_TICKETS",
  /** 更正跳號:改完的張數不等於待標註張數,或張號不在這本 */
  skipCountMismatch: "SKIP_COUNT_MISMATCH",
  /** 更正跳號:跟目前的跳號一樣 */
  skipUnchanged: "SKIP_UNCHANGED",
  /** 這個狀態的張不能做這件事(例:報廢只能報未售、尋回只能尋待查 / 遺失、新標的跳號要是未售) */
  ticketStatusNotAllowed: "TICKET_STATUS_NOT_ALLOWED",
} as const;

export type InventoryReason =
  (typeof INVENTORY_REASONS)[keyof typeof INVENTORY_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: InventoryReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/** 「已被處理」:同時兩個條件更新只有一個成功,另一個收到這個(規格第 17 章共通原則)。 */
export function ticketConflictError(
  ticketIds: readonly string[],
): GraphQLError {
  return new GraphQLError("這幾張已被處理", {
    extensions: {
      code: "CONFLICT",
      reason: INVENTORY_REASONS.ticketAlreadyProcessed,
      ticketIds,
    },
  });
}

/** 跨店寫入不是「把張移進自己看得到的店」(`extensions.ticketIds` 列出不合的張)。 */
export function crossStoreForbiddenError(
  ticketIds: readonly string[],
): GraphQLError {
  return new GraphQLError("跨店只能把張移進自己看得到的店", {
    extensions: {
      code: "FORBIDDEN",
      reason: INVENTORY_REASONS.crossStoreNotAllowed,
      ticketIds,
    },
  });
}
