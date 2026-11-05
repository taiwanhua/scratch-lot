import type {
  CounterScanProblem,
  SaleUndoBlock,
  StoreScanBlockReason,
} from "@repo/domain/project/lottery";

import type { StoreSalesErrorCode } from "@/lib/project/lottery/store-sales-error";

/**
 * 銷售相關文案的 key 對照(`admin.lotteryStore` 底下;執行期的碼對到字面 key,不組字串)。
 */

/** 擋下的原因(ST-05e)。 */
export const BLOCK_REASON_KEYS: Record<StoreScanBlockReason, string> = {
  not_this_store: "scan.blocked.notThisStore",
  sold: "scan.blocked.sold",
  skipped: "scan.blocked.skipped",
  scrapped: "scan.blocked.scrapped",
  locked: "scan.blocked.locked",
  in_transit: "scan.blocked.inTransit",
  in_stock: "scan.blocked.inStock",
  unmatched_no_partner: "scan.blocked.unmatchedNoPartner",
};

/** [收回] / [刷條碼移櫃] 刷到不能移的原因(張數店規格 13.1;當下寫在輸入框下方)。 */
export const COUNTER_PROBLEM_KEYS: Record<CounterScanProblem, string> = {
  not_this_store: "counterScan.problems.notThisStore",
  sold: "counterScan.problems.sold",
  unmatched_no_partner: "counterScan.problems.unmatchedNoPartner",
  skipped: "counterScan.problems.skipped",
  scrapped: "counterScan.problems.scrapped",
  locked: "counterScan.problems.locked",
  in_transit: "counterScan.problems.inTransit",
  in_stock: "counterScan.problems.inStock",
  missing: "counterScan.problems.missing",
  already_there: "counterScan.problems.alreadyThere",
  not_on_source: "counterScan.problems.notOnSource",
};

/** 不能當下撤銷的原因(ST-08b)。 */
export const UNDO_BLOCK_KEYS: Record<SaleUndoBlock, string> = {
  not_mine: "undo.blocks.notMine",
  expired: "undo.blocks.expired",
  shift_closed: "undo.blocks.shiftClosed",
  changed: "undo.blocks.changed",
  already_undone: "undo.blocks.alreadyUndone",
};

/** 銷售類錯誤(`storeSalesErrorOf`)。 */
export const SALES_ERROR_KEYS: Record<StoreSalesErrorCode, string> = {
  LOCAL_SHIFT_NOT_OPEN: "salesErrors.LOCAL_SHIFT_NOT_OPEN",
  TICKET_NOT_SELLABLE: "salesErrors.TICKET_NOT_SELLABLE",
  ALREADY_SOLD: "salesErrors.ALREADY_SOLD",
  MOVE_CONFIRM_REQUIRED: "salesErrors.MOVE_CONFIRM_REQUIRED",
  MOVE_NOT_ALLOWED: "salesErrors.MOVE_NOT_ALLOWED",
  UNDO_NOT_ALLOWED: "salesErrors.UNDO_NOT_ALLOWED",
  BOOK_ALREADY_OPENED: "salesErrors.BOOK_ALREADY_OPENED",
  SPLIT_PLAN_INVALID: "salesErrors.SPLIT_PLAN_INVALID",
  TICKET_NOT_ON_COUNTER: "salesErrors.TICKET_NOT_ON_COUNTER",
  GAME_NOT_FOUND: "salesErrors.GAME_NOT_FOUND",
  COUNT_SALE_NOT_ALLOWED: "salesErrors.COUNT_SALE_NOT_ALLOWED",
  COUNT_SALE_INVALID: "salesErrors.COUNT_SALE_INVALID",
  COUNT_SALE_NOT_FOUND: "salesErrors.COUNT_SALE_NOT_FOUND",
  COUNT_UNDO_EXCEEDS: "salesErrors.COUNT_UNDO_EXCEEDS",
  COUNT_STORE_SCAN_ONLY: "salesErrors.COUNT_STORE_SCAN_ONLY",
  COUNTER_TICKET_BLOCKED: "salesErrors.COUNTER_TICKET_BLOCKED",
  MOVE_PAUSED: "salesErrors.MOVE_PAUSED",
  MOVE_BY_COUNT_INVALID: "salesErrors.MOVE_BY_COUNT_INVALID",
  SPLIT_ACTUAL_COUNT_REQUIRED: "salesErrors.SPLIT_ACTUAL_COUNT_REQUIRED",
  SPLIT_ACTUAL_COUNT_MISMATCH: "salesErrors.SPLIT_ACTUAL_COUNT_MISMATCH",
  CONFLICT: "salesErrors.CONFLICT",
};

/** 張的狀態(刷到時的資訊列)。 */
export const TICKET_STATUS_KEYS: Partial<Record<string, string>> = {
  unsold: "scan.statuses.unsold",
  sold: "scan.statuses.sold",
  skipped: "scan.statuses.skipped",
  scrapped: "scan.statuses.scrapped",
  investigating: "scan.statuses.investigating",
  lost: "scan.statuses.lost",
};
