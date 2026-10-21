import type {
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
