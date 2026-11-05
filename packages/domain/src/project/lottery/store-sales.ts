import { COUNT_MODE, type CountMode, type CountPlace } from "./count-mode";
import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketEventType,
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

/** [最近售出] 開著時刷的是客人退回的票(開著時優先於看板的銷售;張數店規格 7.3 第 1 點)。 */
export const STORE_RETURN_SCAN_PURPOSE = "store-sale-return";

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
 * 在庫存但這本已經拆了(收回到庫存的張,要先移到收銀點檯面)/
 * 系統記已售·未對號但找不到配對張(張數店規格 6.4;請送撤銷售出申請)。
 */
export const STORE_SCAN_BLOCK_REASONS = [
  "not_this_store",
  "sold",
  "skipped",
  "scrapped",
  "locked",
  "in_transit",
  "in_stock",
  "unmatched_no_partner",
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
  /** 未對號(張數店;張號是系統預設帶入的)。不給 = false。 */
  unmatched?: boolean;
}

/** 銷售條件(規格 6.3)與權限。 */
export interface StoreScanContext {
  /** 這台裝置的本機收銀點;沒設定 = null。 */
  localCashPointId: string | null;
  /** 本機收銀點有開著的班。 */
  localShiftOpen: boolean;
  canSell: boolean;
  canMove: boolean;
  /** 這家店實際的盤點制度;不給 = 編號店(不對號)。張數店與轉換中刷到時會對號(張數店規格第 6 節)。 */
  countMode?: CountMode;
}

/** 伺服器依 6.3 找到的配對張所在(對號後刷到的張接手這個位置、未售)。 */
export interface StoreScanPartner {
  locationKind: TicketLocationKind;
  cashPointId: string | null;
  /** 配對張所在收銀點開著的班是不是操作者自己開的。 */
  counterShiftIsMine: boolean;
}

export interface StoreScanDecision {
  outcome: StoreScanOutcome;
  /** `outcome = blocked` 時的原因。 */
  blockReason: StoreScanBlockReason | null;
  /** 這次要先對號(和配對張互換「狀態 + 位置」)再照原本流程處理(張數店規格 6.7)。 */
  match: boolean;
}

const decide = (
  outcome: StoreScanOutcome,
  blockReason: StoreScanBlockReason | null = null,
  match = false,
): StoreScanDecision => ({ outcome, blockReason, match });

const isMissingStatus = (status: TicketStatus): boolean =>
  status === TICKET_STATUS.investigating || status === TICKET_STATUS.lost;

/** 這家店刷到時要不要對號:張數店與轉換中(張數店規格第 6 節;編號店不對號)。 */
export function isMatchingCountMode(mode: CountMode | undefined): boolean {
  return mode === COUNT_MODE.count || mode === COUNT_MODE.converting;
}

/**
 * 看板刷到(刷條碼賣、[標記售出])要不要對號、去哪裡找配對張(張數店規格 6.3 第一列、6.7 ④);不用對號 → null。
 *
 * - 未對號(已售 / 待查 / 遺失)→ 先找刷的那台(本機收銀點),找不到再找這張系統記的位置
 * - 系統記未售、在別的收銀點檯面 → 只找刷的那台:「找不到再找這張系統記的位置」挑到的是同一個位置的未售張,
 *   互換「狀態 + 位置」什麼都不會變(6.1「同位置時等於只換狀態」),所以不找
 * - 編號店、不是本店、被鎖定、跳號 / 報廢、在庫存或在途 → 不對號(6.5、7.1)
 */
export function storeScanMatchPlacesOf(
  ticket: StoreScanTicketFacts,
  context: StoreScanContext,
): CountPlace[] | null {
  if (
    !isMatchingCountMode(context.countMode) ||
    !ticket.inThisStore ||
    ticket.locked
  ) {
    return null;
  }
  const local: CountPlace | null =
    context.localCashPointId === null
      ? null
      : {
          locationKind: TICKET_LOCATION_KIND.counter,
          cashPointId: context.localCashPointId,
        };
  const unmatched =
    ticket.unmatched === true &&
    (ticket.status === TICKET_STATUS.sold || isMissingStatus(ticket.status));
  if (unmatched) {
    const system: CountPlace = {
      locationKind: ticket.locationKind,
      cashPointId: ticket.cashPointId,
    };
    const places = local === null ? [system] : [local, system];
    return places.filter(
      (place, index) =>
        place.locationKind !== TICKET_LOCATION_KIND.inTransit &&
        places.findIndex(
          (other) =>
            other.locationKind === place.locationKind &&
            other.cashPointId === place.cashPointId,
        ) === index,
    );
  }
  if (
    ticket.status === TICKET_STATUS.unsold &&
    ticket.locationKind === TICKET_LOCATION_KIND.counter &&
    local !== null &&
    ticket.cashPointId !== local.cashPointId
  ) {
    return [local];
  }
  return null;
}

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
 * 刷到一張刮刮樂時的處理(見 `STORE_SCAN_OUTCOMES`)。
 *
 * - **編號店**(照現況):待查 / 遺失(任何一家店刷到都提示尋回)→ 張本身不能賣 → 銷售條件 → 未拆 →
 *   在哪個收銀點檯面
 * - **張數店與轉換中**(張數店規格 6.7):① 不是本店 → 照現況 ② 被鎖定 → `locked` ③ 跳號 / 報廢 → 擋下
 *   ④ 未對號或位置不同(`storeScanMatchPlacesOf`)→ 有配對張(`partner`,由伺服器依 6.3 找)就互換後照原本流程
 *   再判斷一次、結果加 `match: true`;沒有 → 已售擋 `unmatched_no_partner`、待查 / 遺失提示尋回(6.4)
 *   ⑤ 其餘照現況。待查 / 遺失的張對號後仍在庫存賣不了時回 `recover`。
 */
export function storeScanDecisionOf(
  ticket: StoreScanTicketFacts,
  context: StoreScanContext,
  partner: StoreScanPartner | null = null,
): StoreScanDecision {
  if (!isMatchingCountMode(context.countMode) || !ticket.inThisStore) {
    return currentDecisionOf(ticket, context);
  }
  if (ticket.locked) {
    return decide("blocked", "locked");
  }
  if (
    ticket.status === TICKET_STATUS.skipped ||
    ticket.status === TICKET_STATUS.scrapped
  ) {
    return decide("blocked", ticket.status);
  }
  const places = storeScanMatchPlacesOf(ticket, context);
  if (places === null) {
    return currentDecisionOf(ticket, context);
  }
  if (partner !== null) {
    if (
      isMissingStatus(ticket.status) &&
      partner.locationKind === TICKET_LOCATION_KIND.stock
    ) {
      return decide("recover", null, true);
    }
    const after = currentDecisionOf(
      {
        ...ticket,
        status: TICKET_STATUS.unsold,
        locationKind: partner.locationKind,
        cashPointId: partner.cashPointId,
        counterShiftIsMine: partner.counterShiftIsMine,
        unmatched: false,
      },
      context,
    );
    return { ...after, match: true };
  }
  if (ticket.status === TICKET_STATUS.sold) {
    return decide("blocked", "unmatched_no_partner");
  }
  if (isMissingStatus(ticket.status)) {
    return decide("recover");
  }
  return currentDecisionOf(ticket, context);
}

/** 編號店(現況)的判斷;張數店不用對號或對號之後也走這裡。 */
function currentDecisionOf(
  ticket: StoreScanTicketFacts,
  context: StoreScanContext,
): StoreScanDecision {
  if (isMissingStatus(ticket.status)) {
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

/**
 * 售出之後的事件算不算「之後有異動」(`SaleUndoFacts.changedAfterSale`):對號不算(張數店規格 7.3「實作必須做到」、
 * 14.1 `saleUndoBlockOf`(改)),其他都算。給這張接手售出之後的事件類型。
 */
export function changedAfterSaleOf(
  laterTypes: readonly TicketEventType[],
): boolean {
  return laterTypes.some((type) => type !== TICKET_EVENT_TYPE.match);
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
