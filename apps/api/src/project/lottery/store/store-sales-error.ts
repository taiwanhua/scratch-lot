import { GraphQLError } from "graphql";

import type {
  CountSaleLinesProblem,
  CounterScanProblem,
  MoveByCountProblem,
  MovePauseBlock,
  SaleUndoBlock,
  SplitActualCountProblem,
  SplitPlanProblem,
  StoreScanBlockReason,
} from "@repo/domain/project/lottery";

/**
 * 銷售、當下撤銷、拆本、移櫃 / 收回的業務錯誤(GQL-04):通用碼 `VALIDATION_FAILED` / `FORBIDDEN`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export const STORE_SALES_REASONS = {
  /** 本機收銀點沒有開著的班(銷售條件不符) */
  localShiftNotOpen: "LOCAL_SHIFT_NOT_OPEN",
  /** 這張不能賣(`extensions.blockReason`:不是本店、跳號、報廢、鎖定、在途、在庫存…) */
  ticketNotSellable: "TICKET_NOT_SELLABLE",
  /** 這張已經賣掉了(`extensions.soldAt`:什麼時候賣的;同時兩次售出的失敗方) */
  alreadySold: "ALREADY_SOLD",
  /** 刮刮樂在別的收銀點檯面,要先確認「移櫃並售出」 */
  moveConfirmRequired: "MOVE_CONFIRM_REQUIRED",
  /** 沒有 `store.move`:別的收銀點檯面的刮刮樂不能在這裡賣 */
  moveNotAllowed: "MOVE_NOT_ALLOWED",
  /** 不符合當下撤銷的條件(`extensions.undoBlock`)→ 改送撤銷售出申請 */
  undoNotAllowed: "UNDO_NOT_ALLOWED",
  /** 拆本:這本在這家店已經拆過了 */
  bookAlreadyOpened: "BOOK_ALREADY_OPENED",
  /** 拆本:跳號沒點滿或沒分配完(`extensions.problem`) */
  splitPlanInvalid: "SPLIT_PLAN_INVALID",
  /** 售出:讀不到這張的遊戲(面額不明,不能賣) */
  gameNotFound: "GAME_NOT_FOUND",
  /** 移櫃 / 收回:張不是在檯面上的未售張 */
  ticketNotOnCounter: "TICKET_NOT_ON_COUNTER",
  /**
   * 依張數標記售出:這家店不是張數店(編號店、轉換中不能用;張數店規格 7.2、9.2)(`extensions.countMode`)
   */
  countSaleNotAllowed: "COUNT_SALE_NOT_ALLOWED",
  /** 依張數標記售出:列不對(`extensions.problem`:沒有列 / 同遊戲兩列 / 張數不對 / 超過剩餘,帶 `gameId`、`available`) */
  countSaleInvalid: "COUNT_SALE_INVALID",
  /** 刷退的票:這台沒有依張數售出可以對號(張數店規格 7.3 第 1 點)→ 改送撤銷售出申請 */
  countSaleNotFound: "COUNT_SALE_NOT_FOUND",
  /** 依張數撤銷:要撤的張數超過現在可以撤的(`extensions.available`) */
  countUndoExceeds: "COUNT_UNDO_EXCEEDS",
  /**
   * 收回 / 移櫃:張數店與轉換中只接受刷條碼或手輸張號的張(格子、「整本」不行;張數店規格 7.6、7.7),
   * 並要給來源台 `fromCashPointId`
   */
  countStoreScanOnly: "COUNT_STORE_SCAN_ONLY",
  /** 收回 / 移櫃:刷到的張不能收回 / 移櫃(`extensions.problems`:每張 `{ ticketId, problem }`,`CounterScanProblem`) */
  counterTicketBlocked: "COUNTER_TICKET_BLOCKED",
  /** 移櫃:這個遊戲全店重刷中 / 補點編號中,暫停移櫃(`extensions.pause`:`MovePauseBlock`;8.5a B1 / B2) */
  movePaused: "MOVE_PAUSED",
  /** 依張數移櫃:不是張數店 / 移到同一台 / 張數不對 / 超過來源台剩餘(`extensions.problem`、`available`) */
  moveByCountInvalid: "MOVE_BY_COUNT_INVALID",
  /** 拆本:張數店與轉換中不是原封不動的本要輸入手上實際張數 */
  splitActualCountRequired: "SPLIT_ACTUAL_COUNT_REQUIRED",
  /** 拆本:手上實際張數比系統多 / 少太多(`extensions.problem`、`count`;張數店規格 7.5) */
  splitActualCountMismatch: "SPLIT_ACTUAL_COUNT_MISMATCH",
} as const;

export type StoreSalesReason =
  (typeof STORE_SALES_REASONS)[keyof typeof STORE_SALES_REASONS];

function storeSalesError(
  code: "VALIDATION_FAILED" | "FORBIDDEN",
  message: string,
  reason: StoreSalesReason,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code, reason, ...extra },
  });
}

export function localShiftNotOpenError(): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "the local cash point has no open shift",
    STORE_SALES_REASONS.localShiftNotOpen,
    { fields: ["localCashPointId"] },
  );
}

export function notSellableError(
  ticketId: string,
  blockReason: StoreScanBlockReason | null,
): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "this ticket cannot be sold",
    STORE_SALES_REASONS.ticketNotSellable,
    { fields: ["tickets"], ticketIds: [ticketId], blockReason },
  );
}

export function alreadySoldError(ticketId: string, soldAt: Date): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "this ticket has been sold",
    STORE_SALES_REASONS.alreadySold,
    {
      fields: ["tickets"],
      ticketIds: [ticketId],
      soldAt: soldAt.toISOString(),
    },
  );
}

export function moveConfirmRequiredError(ticketId: string): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "confirm moving the ticket before selling it here",
    STORE_SALES_REASONS.moveConfirmRequired,
    { fields: ["confirmMove"], ticketIds: [ticketId] },
  );
}

export function moveNotAllowedError(ticketId: string): GraphQLError {
  return storeSalesError(
    "FORBIDDEN",
    "missing permission store.move",
    STORE_SALES_REASONS.moveNotAllowed,
    { ticketIds: [ticketId] },
  );
}

export function undoNotAllowedError(undoBlock: SaleUndoBlock): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "this sale cannot be undone now",
    STORE_SALES_REASONS.undoNotAllowed,
    { fields: ["ticketId"], undoBlock },
  );
}

export function bookAlreadyOpenedError(): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "this book has been opened",
    STORE_SALES_REASONS.bookAlreadyOpened,
    { fields: ["bookId"] },
  );
}

export function splitPlanInvalidError(problem: SplitPlanProblem): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "the split plan is incomplete",
    STORE_SALES_REASONS.splitPlanInvalid,
    {
      fields: problem.startsWith("skip")
        ? ["skippedTicketNos"]
        : ["assignments"],
      problem,
    },
  );
}

export function notOnCounterError(ticketIds: readonly string[]): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "only unsold tickets on a counter can be moved or recalled",
    STORE_SALES_REASONS.ticketNotOnCounter,
    { fields: ["tickets"], ticketIds },
  );
}

export function countSaleNotAllowedError(countMode: string): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "selling by count is only for count stores",
    STORE_SALES_REASONS.countSaleNotAllowed,
    { countMode },
  );
}

export function countSaleInvalidError(
  problem: CountSaleLinesProblem,
): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "the count sale lines are invalid",
    STORE_SALES_REASONS.countSaleInvalid,
    {
      fields: ["lines"],
      problem: problem.kind,
      ...("gameId" in problem ? { gameId: problem.gameId } : {}),
      ...("available" in problem ? { available: problem.available } : {}),
    },
  );
}

export function countSaleNotFoundError(ticketId: string): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "no sale by count on this cash point to match the returned ticket",
    STORE_SALES_REASONS.countSaleNotFound,
    { fields: ["ticketId"], ticketIds: [ticketId] },
  );
}

export function countUndoExceedsError(available: number): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "more tickets than can be undone",
    STORE_SALES_REASONS.countUndoExceeds,
    { fields: ["count"], available },
  );
}

export function gameNotFoundError(ticketId: string): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "the game of this ticket cannot be read",
    STORE_SALES_REASONS.gameNotFound,
    { fields: ["tickets"], ticketIds: [ticketId] },
  );
}

export function countStoreScanOnlyError(): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "count stores recall and move scanned tickets only",
    STORE_SALES_REASONS.countStoreScanOnly,
    { fields: ["source", "fromCashPointId"] },
  );
}

export function counterTicketBlockedError(
  problems: readonly { ticketId: string; problem: CounterScanProblem }[],
): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "these tickets cannot be recalled or moved",
    STORE_SALES_REASONS.counterTicketBlocked,
    {
      fields: ["tickets"],
      ticketIds: problems.map((item) => item.ticketId),
      problems,
    },
  );
}

export function movePausedError(pause: MovePauseBlock): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "moving is paused while a rescan or renumber is in progress",
    STORE_SALES_REASONS.movePaused,
    { pause },
  );
}

export function moveByCountInvalidError(
  problem: MoveByCountProblem,
): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "cannot move tickets by count",
    STORE_SALES_REASONS.moveByCountInvalid,
    {
      fields:
        problem.kind === "same_cash_point" ? ["toCashPointId"] : ["count"],
      problem: problem.kind,
      ...("available" in problem ? { available: problem.available } : {}),
      ...("countMode" in problem ? { countMode: problem.countMode } : {}),
    },
  );
}

export function splitActualCountRequiredError(): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "enter how many tickets of this book are on hand",
    STORE_SALES_REASONS.splitActualCountRequired,
    { fields: ["actualCount"] },
  );
}

export function splitActualCountMismatchError(
  problem: SplitActualCountProblem,
): GraphQLError {
  return storeSalesError(
    "VALIDATION_FAILED",
    "the tickets on hand do not match the system",
    STORE_SALES_REASONS.splitActualCountMismatch,
    {
      fields: ["actualCount"],
      problem: problem.kind,
      ...("count" in problem ? { count: problem.count } : {}),
    },
  );
}
