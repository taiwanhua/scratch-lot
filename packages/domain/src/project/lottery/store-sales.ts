import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 店面的銷售、當下撤銷與拆本規則(專案規格 3.3、6.2、6.3、6.4;正本 `docs/modules/project/store.md`
 * 「銷售與拆本」)。api 判斷能不能做、admin 決定開哪個視窗都用這裡,不另寫一份。
 */

/** 看板宣告的掃描用途(`useScanner`;B10 頁面優先於預設的快速銷售)。 */
export const STORE_SALE_SCAN_PURPOSE = "store-sale";

/** 拆本精靈「先選要拆的本」可以刷條碼選本(開著時優先於看板的銷售)。 */
export const STORE_SPLIT_SCAN_PURPOSE = "store-split";

/** 當下撤銷的時限:售出後 30 分鐘內(規格 6.3)。 */
export const SALE_UNDO_WINDOW_MINUTES = 30;
const MINUTE_MS = 60_000;

/**
 * 刷到一張刮刮樂時怎麼處理(規格 6.3「刷到時」「錢算在哪一班」、3.3 移櫃情境表;Figma ST-05a–f):
 *
 * - `sell`:在本機收銀點檯面 → 直接售出,算本機收銀點的班
 * - `sell_other_mine`:在別的收銀點檯面、那一班是自己開的 → 確認後算那一班,不移櫃(ST-05a)
 * - `move_and_sell`:在別的收銀點檯面(那一班不是自己的)、有 `store.move` → 確認後寫「移櫃」+「售出」,
 *   算本機收銀點的班(ST-05b)
 * - `move_forbidden`:同上但沒有 `store.move` → 擋下,不寫任何事件
 * - `unopened`:這本還沒拆 → 詢問是否拆本並售出(ST-05d)
 * - `recover`:待查或遺失 → 提示尋回(ST-05f)
 * - `blocked`:不能銷售(ST-05e,原因見 `StoreScanBlockReason`)
 * - `info_only`:銷售條件不符(沒設本機收銀點、本機收銀點沒開班、沒有 `store.sell`)→ 只顯示資訊
 */
export const STORE_SCAN_OUTCOMES = [
  "sell",
  "sell_other_mine",
  "move_and_sell",
  "move_forbidden",
  "unopened",
  "recover",
  "blocked",
  "info_only",
] as const;
export type StoreScanOutcome = (typeof STORE_SCAN_OUTCOMES)[number];

/**
 * 不能銷售的原因:不是本店的刮刮樂 / 已售 / 跳號 / 報廢 / 被單據鎖定 / 在途 /
 * 在庫存但這本已經拆了(收回到庫存的張,要先移到收銀點檯面)。
 */
export const STORE_SCAN_BLOCK_REASONS = [
  "not_this_store",
  "sold",
  "skipped",
  "scrapped",
  "locked",
  "in_transit",
  "in_stock",
] as const;
export type StoreScanBlockReason = (typeof STORE_SCAN_BLOCK_REASONS)[number];

/** 判斷要用的這一張的事實。 */
export interface StoreScanTicketFacts {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  /** 在檯面時的收銀點。 */
  cashPointId: string | null;
  /** 張目前在刷到的這家店。 */
  inThisStore: boolean;
  /** 被調貨單或撤銷售出申請鎖定。 */
  locked: boolean;
  /** 這本在這家店還沒拆(未售的張全在庫存)。 */
  bookUnopened: boolean;
  /** 張所在收銀點開著的班是不是操作者自己開的;沒開班 = false。 */
  counterShiftIsMine: boolean;
}

/** 銷售條件(規格 6.3)與權限。 */
export interface StoreScanContext {
  /** 這台裝置的本機收銀點;沒設定 = null。 */
  localCashPointId: string | null;
  /** 本機收銀點有開著的班。 */
  localShiftOpen: boolean;
  canSell: boolean;
  canMove: boolean;
}

export interface StoreScanDecision {
  outcome: StoreScanOutcome;
  /** `outcome = blocked` 時的原因。 */
  blockReason: StoreScanBlockReason | null;
}

const decide = (
  outcome: StoreScanOutcome,
  blockReason: StoreScanBlockReason | null = null,
): StoreScanDecision => ({ outcome, blockReason });

/** 張本身就不能賣的原因(與銷售條件無關);可以賣 = null。 */
function blockReasonOf(
  ticket: StoreScanTicketFacts,
): StoreScanBlockReason | null {
  if (!ticket.inThisStore) {
    return "not_this_store";
  }
  switch (ticket.status) {
    case TICKET_STATUS.sold: {
      return "sold";
    }
    case TICKET_STATUS.skipped: {
      return "skipped";
    }
    case TICKET_STATUS.scrapped: {
      return "scrapped";
    }
    default: {
      break;
    }
  }
  if (ticket.locked) {
    return "locked";
  }
  if (ticket.locationKind === TICKET_LOCATION_KIND.inTransit) {
    return "in_transit";
  }
  if (
    ticket.locationKind === TICKET_LOCATION_KIND.stock &&
    !ticket.bookUnopened
  ) {
    return "in_stock";
  }
  return null;
}

/**
 * 刷到一張刮刮樂時的處理(見 `STORE_SCAN_OUTCOMES`)。順序:待查 / 遺失(任何一家店刷到都提示尋回)→
 * 張本身不能賣 → 銷售條件 → 未拆 → 在哪個收銀點檯面。
 */
export function storeScanDecisionOf(
  ticket: StoreScanTicketFacts,
  context: StoreScanContext,
): StoreScanDecision {
  if (
    ticket.status === TICKET_STATUS.investigating ||
    ticket.status === TICKET_STATUS.lost
  ) {
    return decide("recover");
  }
  const blocked = blockReasonOf(ticket);
  if (blocked !== null) {
    return decide("blocked", blocked);
  }
  if (
    !context.canSell ||
    context.localCashPointId === null ||
    !context.localShiftOpen
  ) {
    return decide("info_only");
  }
  if (ticket.locationKind === TICKET_LOCATION_KIND.stock) {
    return decide("unopened");
  }
  if (ticket.cashPointId === context.localCashPointId) {
    return decide("sell");
  }
  if (ticket.counterShiftIsMine) {
    return decide("sell_other_mine");
  }
  return decide(context.canMove ? "move_and_sell" : "move_forbidden");
}

/**
 * 不能當下撤銷的原因(規格 6.3):不是自己賣的 / 超過 30 分鐘 / 那一班已送出交班結帳 /
 * 之後有其他異動(售出後那張刮刮樂又有事件,例:移櫃)/ 已經撤銷。可以撤銷 = null。
 */
export const SALE_UNDO_BLOCKS = [
  "not_mine",
  "expired",
  "shift_closed",
  "changed",
  "already_undone",
] as const;
export type SaleUndoBlock = (typeof SALE_UNDO_BLOCKS)[number];

export interface SaleUndoFacts {
  /** 售出的人是操作者本人。 */
  soldByMe: boolean;
  soldAt: Date;
  now: Date;
  /** 售出算進的那一班還開著。 */
  shiftOpen: boolean;
  /** 售出事件之後那張刮刮樂又有別的事件。 */
  changedAfterSale: boolean;
  /** 那一筆售出已經撤銷。 */
  undone: boolean;
}

/** 當下撤銷的條件(自己賣的、30 分鐘內、班還開著、之後沒有其他異動);不符 → 改送撤銷售出申請。 */
export function saleUndoBlockOf(facts: SaleUndoFacts): SaleUndoBlock | null {
  if (facts.undone) {
    return "already_undone";
  }
  if (!facts.soldByMe) {
    return "not_mine";
  }
  if (!facts.shiftOpen) {
    return "shift_closed";
  }
  if (facts.changedAfterSale) {
    return "changed";
  }
  if (
    facts.now.getTime() - facts.soldAt.getTime() >
    SALE_UNDO_WINDOW_MINUTES * MINUTE_MS
  ) {
    return "expired";
  }
  return null;
}

/** 拆本精靈的一筆分配:這些張號放到哪個收銀點。 */
export interface SplitAssignment {
  cashPointId: string;
  ticketNos: readonly string[];
}

/** 拆本的檢查結果;可以拆 = null。 */
export type SplitPlanProblem =
  | "skip_count_mismatch"
  | "skip_not_in_book"
  | "unassigned"
  | "assigned_twice"
  | "assigned_unknown";

/**
 * 拆本精靈的檢查(規格 6.4):① 標的跳號剛好等於待標註張數,而且是這本(這家店庫存裡)的張;
 * ② 跳號以外的每一張都分配到恰好一個收銀點。`ticketNos` = 這本在這家店庫存裡未售的張號。
 */
export function splitPlanProblemOf(
  ticketNos: readonly string[],
  pendingSkipCount: number,
  skippedTicketNos: readonly string[],
  assignments: readonly SplitAssignment[],
): SplitPlanProblem | null {
  const all = new Set(ticketNos);
  const skipped = new Set(skippedTicketNos);
  if (skipped.size !== pendingSkipCount) {
    return "skip_count_mismatch";
  }
  if ([...skipped].some((no) => !all.has(no))) {
    return "skip_not_in_book";
  }
  const assigned = new Set<string>();
  for (const assignment of assignments) {
    for (const no of assignment.ticketNos) {
      if (!all.has(no) || skipped.has(no)) {
        return "assigned_unknown";
      }
      if (assigned.has(no)) {
        return "assigned_twice";
      }
      assigned.add(no);
    }
  }
  return assigned.size === all.size - skipped.size ? null : "unassigned";
}
