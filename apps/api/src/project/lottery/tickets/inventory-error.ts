import { GraphQLError } from "graphql";

/**
 * 張數帳本的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `CONFLICT` / `FORBIDDEN`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/inventory.md`「錯誤碼」)。
 */
export const INVENTORY_REASONS = {
  /** 張已被處理(狀態或版本不是呼叫端讀到的、被鎖定、或同一個事件 id 已寫過別的內容) */
  ticketAlreadyProcessed: "TICKET_ALREADY_PROCESSED",
  /**
   * 跨店:跨店寫入只能把張移進操作者看得到的店(調入、刷到實體的尋回);報廢、從清單選的尋回、
   * 更正跳號選到所在分店不在操作者可見範圍內的張
   */
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
  /** 標跳號:這本沒有待標註(跳號都標完了) */
  noPendingSkips: "NO_PENDING_SKIPS",
  /** 更正跳號:跟目前的跳號一樣 */
  skipUnchanged: "SKIP_UNCHANGED",
  /** 這個狀態的張不能做這件事(例:報廢只能報未售、尋回只能尋待查 / 遺失、新標的跳號要是未售) */
  ticketStatusNotAllowed: "TICKET_STATUS_NOT_ALLOWED",
  /** 尋回:回到的組織不是店(有下層組織,例:最上層組織) */
  recoverTargetNotStore: "RECOVER_TARGET_NOT_STORE",
  /**
   * 尋回(刷到實體):回到的店不是操作者正在操作的店 —— 目前組織是店時要回到它;目前組織是上層組織
   * (總部、區域)時要有店面權限 `store.view`
   */
  recoverTargetNotOperatingStore: "RECOVER_TARGET_NOT_OPERATING_STORE",
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

/**
 * 本已被處理:張換店後整本要跟著搬,但這幾本搬不了(讀不到、已刪除或剛被別人改過);整個交易回復,
 * 不靜默略過(`extensions.bookIds` 列出搬不了的本)。
 */
export function bookConflictError(bookIds: readonly string[]): GraphQLError {
  return new GraphQLError("這幾本已被處理", {
    extensions: {
      code: "CONFLICT",
      reason: INVENTORY_REASONS.ticketAlreadyProcessed,
      bookIds,
    },
  });
}

/** 刷到實體的尋回:回到的店不是操作者正在操作的店(見 `recoverTargetNotOperatingStore`)。 */
export function recoverTargetForbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "FORBIDDEN",
      reason: INVENTORY_REASONS.recoverTargetNotOperatingStore,
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
