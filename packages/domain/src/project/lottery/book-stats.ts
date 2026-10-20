import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 本的即時計算(專案規格 7.1「即時計算不存」;7.6 預計要給本數):api 讀取時算,不存進資料表。
 */

/** 計算用的一張:狀態、位置、目前所在分店。 */
export interface BookTicketSnapshot {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  storeOrgId: string;
}

/** 本的狀態:未拆 / 檯面中 / 售完(庫存分頁的篩選)。 */
export type BookState = "unopened" | "on_counter" | "sold_out";

/**
 * 待標註張數 = 迄號 − 標準張數 − 已標的跳號數(不會小於 0)。
 * 例:迄號 103、標準 100、還沒標 → 3。
 */
export function pendingSkipCountOf(
  lastTicketNo: number,
  standardTickets: number,
  skippedCount: number,
): number {
  return Math.max(0, lastTicketNo - standardTickets - skippedCount);
}

/** 剩餘張數 = 未售的張(庫存、檯面、在途都算)。 */
export function remainingCountOf(
  tickets: readonly BookTicketSnapshot[],
): number {
  return tickets.filter((ticket) => ticket.status === TICKET_STATUS.unsold)
    .length;
}

/**
 * 各分店持有張數(不算跳號:實體不存在)。依分店 id 回張數。
 * 讀取放行「分店持有某本任何一張,就能讀那一本」以這份的鍵為準。
 */
export function holdingsOf(
  tickets: readonly BookTicketSnapshot[],
): Map<string, number> {
  const holdings = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.status === TICKET_STATUS.skipped) {
      continue;
    }
    holdings.set(ticket.storeOrgId, (holdings.get(ticket.storeOrgId) ?? 0) + 1);
  }
  return holdings;
}

/**
 * 未拆 / 檯面中 / 售完:沒有未售的張 → 售完;未售的張全在庫存、且沒有任何一張售出、報廢、
 * 待查或遺失 → 未拆;其他 → 檯面中。
 */
export function bookStateOf(tickets: readonly BookTicketSnapshot[]): BookState {
  const usable = tickets.filter(
    (ticket) => ticket.status !== TICKET_STATUS.skipped,
  );
  if (!usable.some((ticket) => ticket.status === TICKET_STATUS.unsold)) {
    return "sold_out";
  }
  const untouched = usable.every(
    (ticket) =>
      ticket.status === TICKET_STATUS.unsold &&
      ticket.locationKind === TICKET_LOCATION_KIND.stock,
  );
  return untouched ? "unopened" : "on_counter";
}

/** 一本在某家店的淨張數(進貨 + 調入 − 調出,不算跳號)與這本的可用張數(標準張數)。 */
export interface AllocationBookNet {
  netTickets: number;
  usableTickets: number;
}

/** 已給本數:整本 N 本 + 零碎 N 張(零碎張數不會湊成一本)。 */
export interface AllocationGiven {
  books: number;
  extraTickets: number;
}

/**
 * 已給本數(規格 7.6):每本在這家店的淨張數 ≥ 可用張數算 1 本(還沒標跳號的本,淨張數會多出待標註的張),
 * 否則算「+N 張」;淨張數 ≤ 0 的本不算。例:進 2 本、調出 30 張 → 1 本 +70 張。
 */
export function allocationGivenOf(
  nets: readonly AllocationBookNet[],
): AllocationGiven {
  let books = 0;
  let extraTickets = 0;
  for (const { netTickets, usableTickets } of nets) {
    if (netTickets <= 0) {
      continue;
    }
    if (netTickets >= usableTickets) {
      books += 1;
    } else {
      extraTickets += netTickets;
    }
  }
  return { books, extraTickets };
}
