import { COUNT_MODE, type CountMode, type CountPlace } from "./count-mode";
import { isMatchingCountMode } from "./store-sales";
import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 收回、移櫃、報廢、撤銷報廢、拆本實際張數的規則(張數店規格 6.3、7.5–7.8、8.5a、9.2;正本
 * `docs/modules/project/store.md`「收回與移櫃」、`docs/modules/project/inventory.md`「報廢」)。
 * api 判斷能不能做、admin 決定顯示哪個按鈕與提示都用這裡。
 */

// ---- 收回、刷條碼移櫃(7.6、7.7) ----

/** [收回]、[刷條碼移櫃] 刷到一張的用途。 */
export const COUNTER_SCAN_PURPOSES = ["recall", "move"] as const;
export type CounterScanPurpose = (typeof COUNTER_SCAN_PURPOSES)[number];

/** 看板 [收回] / [刷條碼移櫃] 視窗的掃描用途(B10;開著時優先於看板的銷售)。 */
export const STORE_COUNTER_SCAN_PURPOSE = "store-counter-move";

/**
 * 刷到的張不能收回 / 移櫃的原因(當下顯示、不加進清單;張數店規格 13.1「不能移的當下顯示原因」):
 * 不是本店 / 已售 / 已售·未對號但來源台沒有可對號的張 / 跳號 / 報廢 / 被鎖定 / 在途 / 在庫存 /
 * 待查或遺失(請先尋回)/ 已經在要移到的收銀點 / 不是這張卡片的收銀點(編號店只收回、移櫃這台的張)。
 */
export const COUNTER_SCAN_PROBLEMS = [
  "not_this_store",
  "sold",
  "unmatched_no_partner",
  "skipped",
  "scrapped",
  "locked",
  "in_transit",
  "in_stock",
  "missing",
  "already_there",
  "not_on_source",
] as const;
export type CounterScanProblem = (typeof COUNTER_SCAN_PROBLEMS)[number];

/** 刷到的張的事實。 */
export interface CounterScanTicketFacts {
  inThisStore: boolean;
  status: TicketStatus;
  unmatched: boolean;
  locked: boolean;
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/** 視窗的條件:這家店的盤點制度、從哪台(卡片的收銀點)、移到哪台(收回 = null)。 */
export interface CounterScanContext {
  countMode: CountMode;
  sourceCashPointId: string;
  targetCashPointId: string | null;
}

/** 刷到一張的判斷:能不能收回 / 移櫃、要不要先對號、實際從哪個收銀點移出。 */
export interface CounterScanDecision {
  problem: CounterScanProblem | null;
  /** 先和來源台的配對張互換「狀態 + 位置」(張數店規格 6.3「收回、刷條碼移櫃」) */
  match: boolean;
  /** 收回 / 移櫃時這張實際從哪個收銀點離開(事件記的原收銀點);不能做 = null */
  fromCashPointId: string | null;
}

const isMissing = (status: TicketStatus): boolean =>
  status === TICKET_STATUS.investigating || status === TICKET_STATUS.lost;

/**
 * 張數店(含轉換中)刷到的張要不要在來源台找配對張(張數店規格 6.3「收回、刷條碼移櫃 → 那個收銀點(來源台)」、7.6、7.7):
 * 未對號(已售 / 待查 / 遺失·未對號)或系統記未售、在別的收銀點檯面 → 找來源台;編號店、不是本店、鎖定、
 * 跳號 / 報廢、確定的狀態(不是未對號)、在庫存或在途 → 不找(null)。庫存的張號一定正確(3 第 1 點),不拿來對號。
 */
export function counterScanMatchPlacesOf(
  ticket: CounterScanTicketFacts,
  context: CounterScanContext,
): CountPlace[] | null {
  if (
    !isMatchingCountMode(context.countMode) ||
    !ticket.inThisStore ||
    ticket.locked
  ) {
    return null;
  }
  const source: CountPlace = {
    locationKind: TICKET_LOCATION_KIND.counter,
    cashPointId: context.sourceCashPointId,
  };
  if (
    ticket.unmatched &&
    (ticket.status === TICKET_STATUS.sold || isMissing(ticket.status))
  ) {
    return [source];
  }
  if (
    ticket.status === TICKET_STATUS.unsold &&
    ticket.locationKind === TICKET_LOCATION_KIND.counter &&
    ticket.cashPointId !== context.sourceCashPointId
  ) {
    return [source];
  }
  return null;
}

const decision = (
  problem: CounterScanProblem | null,
  fromCashPointId: string | null = null,
  match = false,
): CounterScanDecision => ({ problem, match, fromCashPointId });

/** 張本身(不對號時)能不能收回 / 移櫃:只能是檯面上、未售、沒被鎖的張(7.6、7.7「現況」)。 */
function plainProblemOf(
  ticket: CounterScanTicketFacts,
): CounterScanProblem | null {
  if (!ticket.inThisStore) {
    return "not_this_store";
  }
  switch (ticket.status) {
    case TICKET_STATUS.sold: {
      return ticket.unmatched ? "unmatched_no_partner" : "sold";
    }
    case TICKET_STATUS.skipped: {
      return "skipped";
    }
    case TICKET_STATUS.scrapped: {
      return "scrapped";
    }
    case TICKET_STATUS.investigating:
    case TICKET_STATUS.lost: {
      return "missing";
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
  return ticket.locationKind === TICKET_LOCATION_KIND.stock ? "in_stock" : null;
}

/**
 * [收回] / [刷條碼移櫃] 刷到一張(張數店規格 6.3、6.4、6.5、7.6、7.7、13.1):
 *
 * - 張數店與轉換中:不是本店 → 擋;鎖定 → `locked`;跳號 / 報廢 → 擋(先更正);未對號或系統記在別台
 *   (`counterScanMatchPlacesOf`)→ 來源台有配對張(`partnerFound`)就先對號、從來源台移出;沒有配對:
 *   已售·未對號 → `unmatched_no_partner`、待查 / 遺失 → `missing`(照現況提示尋回)、系統記在別台的未售 →
 *   照現況從系統記的那台移出(來源台這個遊戲在系統裡已沒有未售的張)。其餘照現況。
 * - 編號店:只收回 / 移櫃這台檯面上的未售(視窗是卡片的收銀點;不對號)。
 * - 移櫃:實際移出的收銀點就是要移到的那台 → `already_there`。
 */
export function counterScanDecisionOf(
  ticket: CounterScanTicketFacts,
  context: CounterScanContext,
  partnerFound: boolean,
): CounterScanDecision {
  const finish = (from: string | null, match: boolean): CounterScanDecision =>
    from !== null && from === context.targetCashPointId
      ? decision("already_there")
      : decision(null, from, match);
  if (!isMatchingCountMode(context.countMode)) {
    const problem = plainProblemOf(ticket);
    if (problem !== null) {
      return decision(problem);
    }
    return ticket.cashPointId === context.sourceCashPointId
      ? finish(ticket.cashPointId, false)
      : decision("not_on_source");
  }
  if (!ticket.inThisStore) {
    return decision("not_this_store");
  }
  if (ticket.locked) {
    return decision("locked");
  }
  if (
    ticket.status === TICKET_STATUS.skipped ||
    ticket.status === TICKET_STATUS.scrapped
  ) {
    return decision(ticket.status);
  }
  const places = counterScanMatchPlacesOf(ticket, context);
  if (places !== null && partnerFound) {
    return finish(context.sourceCashPointId, true);
  }
  const problem = plainProblemOf(ticket);
  return problem === null
    ? finish(ticket.cashPointId, false)
    : decision(problem);
}

// ---- 移櫃暫停(8.5、8.5a B1 / B2) ----

/** 進行中的全店重刷(gameId = 那個遊戲)或補點編號(gameId = null)。 */
export interface MovePause {
  gameId: string | null;
}

/** 移櫃被擋的原因:那個遊戲全店重刷中 / 補點編號中(暫停全部遊戲)。 */
export type MovePauseBlock =
  { kind: "rescan"; gameId: string } | { kind: "renumber" };

/**
 * 要移的遊戲是不是暫停移櫃(張數店規格 5.6 `movePauses`、7.7、8.5a B1 / B2):清單裡有補點編號(gameId = null)
 * → 全部遊戲暫停;有這個遊戲的重刷 → 暫停。依 `gameIds` 順序回第一個擋到的;都沒擋 → null。
 */
export function movePauseBlockOf(
  pauses: readonly MovePause[],
  gameIds: readonly string[],
): MovePauseBlock | null {
  if (pauses.some((pause) => pause.gameId === null)) {
    return { kind: "renumber" };
  }
  for (const gameId of gameIds) {
    if (pauses.some((pause) => pause.gameId === gameId)) {
      return { kind: "rescan", gameId };
    }
  }
  return null;
}

// ---- 依張數移櫃(7.7、9.2、13.1) ----

/** 依張數移櫃不能做的原因。 */
export type MoveByCountProblem =
  | { kind: "not_count_store"; countMode: CountMode }
  | { kind: "same_cash_point" }
  | { kind: "invalid_count" }
  | { kind: "exceeds"; available: number };

/**
 * 依張數移櫃送出前的檢查(張數店規格 7.7、9.2、13.1):只有張數店(編號店照現況、轉換中不顯示也擋);
 * 移到的不能是來源台;張數是 1 以上的整數,上限 = 來源台這個遊戲的未售張數(不限一本)。
 */
export function moveByCountProblemOf(
  countMode: CountMode,
  fromCashPointId: string,
  toCashPointId: string,
  count: number,
  available: number,
): MoveByCountProblem | null {
  if (countMode !== COUNT_MODE.count) {
    return { kind: "not_count_store", countMode };
  }
  if (fromCashPointId === toCashPointId) {
    return { kind: "same_cash_point" };
  }
  if (!Number.isInteger(count) || count < 1) {
    return { kind: "invalid_count" };
  }
  return count > available ? { kind: "exceeds", available } : null;
}

// ---- 拆本:手上實際張數(7.5) ----

/**
 * 拆本精靈要不要先問「手上這本實際有幾張」(張數店規格 7.5):張數店與轉換中、而且這本不是原封不動
 * (拆過又收回、尋回過、報廢過…)。原封不動的本張數固定,不用輸入;編號店照現況。
 */
export function splitNeedsActualCount(
  countMode: string,
  sealed: boolean,
): boolean {
  return (
    (countMode === COUNT_MODE.count || countMode === COUNT_MODE.converting) &&
    !sealed
  );
}

/** 手上實際張數對不上時不能拆的原因:比系統多 / 少太多(超過待標註)/ 輸入不是 0 以上的整數。 */
export type SplitActualCountProblem =
  | { kind: "over"; count: number }
  | { kind: "short"; count: number }
  | { kind: "invalid" };

/**
 * 「手上這本實際有幾張」之後要標幾張跳號(張數店規格 7.5,模型 final_check_sim.py「差幾張標幾張」):
 * 系統在本店庫存的張數比實際多 d 張 → 要從庫存的張號標 d 張跳號(手上沒有的那幾個號碼)才能拆;
 * d 超過待標註(沒有待標註時 d > 0 就擋)→ 擋「少了 N 張」;實際比系統多 → 擋「多了 N 張」。不要求標滿待標註。
 */
export function splitSkipCountOf(
  systemCount: number,
  actualCount: number,
  pendingSkipCount: number,
):
  | { ok: true; skipCount: number }
  | { ok: false; problem: SplitActualCountProblem } {
  if (!Number.isInteger(actualCount) || actualCount < 0) {
    return { ok: false, problem: { kind: "invalid" } };
  }
  const short = systemCount - actualCount;
  if (short < 0) {
    return { ok: false, problem: { kind: "over", count: -short } };
  }
  if (short > pendingSkipCount) {
    return { ok: false, problem: { kind: "short", count: short } };
  }
  return { ok: true, skipCount: short };
}

// ---- 報廢與撤銷報廢(7.8) ----

/** 不能報廢的原因:不是未售 / 被鎖定 / 不在庫存(檯面上的張請先收回)/ 這本還沒拆(請先拆本)。 */
export const SCRAP_BLOCKS = [
  "not_unsold",
  "locked",
  "not_in_stock",
  "book_unopened",
] as const;
export type ScrapBlock = (typeof SCRAP_BLOCKS)[number];

/** 報廢要看的一張與它的本。 */
export interface ScrapTicketFacts {
  /** `TicketStatus`(畫面讀到的是字串) */
  status: string;
  /** `TicketLocationKind` */
  locationKind: string;
  locked: boolean;
  /** 這本第一次拆本的時間(null = 從沒拆過) */
  bookFirstOpenedAt: Date | string | null;
}

/**
 * 這張能不能報廢(張數店規格 7.8,兩種店一樣;使用者 11/01 定):只能報庫存裡、未售、沒被鎖的張,
 * 而且這本拆過(`firstOpenedAt` ≠ null;未拆的本有膠封套包著,不可能還沒拆就報廢)。可以 = null。
 */
export function scrapBlockOf(ticket: ScrapTicketFacts): ScrapBlock | null {
  if (ticket.status !== TICKET_STATUS.unsold) {
    return "not_unsold";
  }
  if (ticket.bookFirstOpenedAt === null) {
    return "book_unopened";
  }
  if (ticket.locked) {
    return "locked";
  }
  return ticket.locationKind === TICKET_LOCATION_KIND.stock
    ? null
    : "not_in_stock";
}
