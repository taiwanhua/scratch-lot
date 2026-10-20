import { GraphQLError } from "graphql";

/**
 * 張數帳本的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `CONFLICT`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/inventory.md`「錯誤碼」)。
 */
export const INVENTORY_REASONS = {
  /** 張已被處理(狀態或版本不是呼叫端讀到的、被鎖定、或同一個事件 id 已寫過別的內容) */
  ticketAlreadyProcessed: "TICKET_ALREADY_PROCESSED",
  /** 本編號在租戶內重複 */
  bookKeyDuplicate: "BOOK_KEY_DUPLICATE",
  /** 迄號不在「標準張數 ~ 999」之間 */
  lastTicketNoOutOfRange: "LAST_TICKET_NO_OUT_OF_RANGE",
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
