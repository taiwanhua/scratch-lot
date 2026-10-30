import { COLLATION_LOCALE } from "../../collation/compare-display-name";
import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 本的計算(專案規格 7.1:張數由帳本服務維護在本上,狀態由張數算出;7.6 預計要給本數)。
 */

/** 計算用的一張:狀態、位置、目前所在分店。 */
export interface BookTicketSnapshot {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  storeOrgId: string;
}

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

/**
 * 各分店持有的未售張數(庫存分頁「所在分店」;已售、報廢、待查、遺失、跳號都不算,使用者 10/27 定案)。
 * 依分店 id 回張數;沒有未售的分店不列。讀取放行看本的 `holderOrgIds`(持有任何一張),不看這份。
 */
export function holdingsOf(
  tickets: readonly BookTicketSnapshot[],
): Map<string, number> {
  const holdings = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.status !== TICKET_STATUS.unsold) {
      continue;
    }
    holdings.set(ticket.storeOrgId, (holdings.get(ticket.storeOrgId) ?? 0) + 1);
  }
  return holdings;
}

/**
 * 本上存的各狀態張數(帳本服務在同一個交易依本 `$inc` 維護;跳號不算)。未售分三格(庫存 / 檯面 / 在途)。
 * 待標註的跳號(拆本前還沒標的)實體不存在,但帳本分不出是哪幾張:存的是紀錄張數,讀取時用
 * `remainingOfCounts` / `totalOfCounts` 扣(使用者 10/27 定案甲)。
 */
export interface BookTicketCounts {
  stock: number;
  counter: number;
  inTransit: number;
  sold: number;
  scrapped: number;
  investigating: number;
  lost: number;
}

/** 本上張數欄位的 key(固定順序;帳本依它算增減、api 依它組篩選)。 */
export const BOOK_COUNT_KEYS = [
  "stock",
  "counter",
  "inTransit",
  "sold",
  "scrapped",
  "investigating",
  "lost",
] as const satisfies readonly (keyof BookTicketCounts)[];
export type BookCountKey = (typeof BOOK_COUNT_KEYS)[number];

/** 全部 0 的張數(建本、舊資料防禦)。 */
export function emptyBookCounts(): BookTicketCounts {
  return {
    stock: 0,
    counter: 0,
    inTransit: 0,
    sold: 0,
    scrapped: 0,
    investigating: 0,
    lost: 0,
  };
}

/** 一張算在哪一格;跳號 = null(不算)。 */
export function bookCountKeyOf(
  status: TicketStatus,
  locationKind: TicketLocationKind,
): BookCountKey | null {
  switch (status) {
    case TICKET_STATUS.skipped: {
      return null;
    }
    case TICKET_STATUS.unsold: {
      if (locationKind === TICKET_LOCATION_KIND.counter) {
        return "counter";
      }
      return locationKind === TICKET_LOCATION_KIND.inTransit
        ? "inTransit"
        : "stock";
    }
    case TICKET_STATUS.sold: {
      return "sold";
    }
    case TICKET_STATUS.scrapped: {
      return "scrapped";
    }
    case TICKET_STATUS.investigating: {
      return "investigating";
    }
    case TICKET_STATUS.lost: {
      return "lost";
    }
  }
}

/** 一批張重數成張數(核對測試與舊資料重建用)。 */
export function bookCountsOf(
  tickets: readonly Pick<BookTicketSnapshot, "status" | "locationKind">[],
): BookTicketCounts {
  const counts = emptyBookCounts();
  for (const ticket of tickets) {
    const key = bookCountKeyOf(ticket.status, ticket.locationKind);
    if (key !== null) {
      counts[key] += 1;
    }
  }
  return counts;
}

/** 未售張數(庫存 + 檯面 + 在途;紀錄張數,含還沒標的跳號)。 */
export function unsoldOfCounts(counts: BookTicketCounts): number {
  return counts.stock + counts.counter + counts.inTransit;
}

/**
 * 還沒標的跳號算在哪一組(一本合計只扣一次;使用者 10/27 定案):它們沒有實體、不會被逐張處理,所以在
 * 「還沒確認實體的那一組」——有待查 / 遺失的張 → 那一組(`missing`;確認遺失、待查列、報表扣);
 * 沒有 → 未售(`unsold`;剩餘、所在分店、拆本清單扣)。沒有待標註 → null。
 */
export type PendingSkipPlacement = "unsold" | "missing";

export function pendingPlacementOf(
  counts: BookTicketCounts,
  pendingSkipCount: number,
): PendingSkipPlacement | null {
  if (pendingSkipCount <= 0) {
    return null;
  }
  return counts.investigating + counts.lost > 0 ? "missing" : "unsold";
}

/**
 * 剩餘張數 = 未售的張(庫存、檯面、在途都算),待標註算在未售時扣掉(還沒標的跳號實體不存在;不會小於 0)。
 * 例:迄號 103、標準 100、還沒標跳號 → 103 張未售 − 3 = 100;整本待查後尋回 3 張 → 3(待標註在待查那一組)。
 */
export function remainingOfCounts(
  counts: BookTicketCounts,
  pendingSkipCount: number,
): number {
  const unsold = unsoldOfCounts(counts);
  return pendingPlacementOf(counts, pendingSkipCount) === "unsold"
    ? Math.max(0, unsold - pendingSkipCount)
    : unsold;
}

/**
 * 各分店的未售張數扣掉待標註:待標註算在未售時,只扣一家店(未售最多的那家;同樣多取 id 小的),一本只扣一次。
 */
export function holdingsWithoutPendingSkips(
  holdings: ReadonlyMap<string, number>,
  counts: BookTicketCounts,
  pendingSkipCount: number,
): Map<string, number> {
  const result = new Map(holdings);
  if (pendingPlacementOf(counts, pendingSkipCount) !== "unsold") {
    return result;
  }
  const store = pendingStoreOf(holdings);
  if (store !== null) {
    result.set(store, Math.max(0, (result.get(store) ?? 0) - pendingSkipCount));
  }
  return result;
}

/** 一本分在幾家店時,待標註扣在哪一家:張數最多的那家,同樣多取 id 小的;沒有 → null。 */
export function pendingStoreOf(
  countsByStore: ReadonlyMap<string, number>,
): string | null {
  let picked: string | null = null;
  let most = 0;
  for (const [store, count] of [...countsByStore].toSorted(([a], [b]) =>
    a.localeCompare(b, COLLATION_LOCALE),
  )) {
    if (count > most) {
      picked = store;
      most = count;
    }
  }
  return picked;
}

/**
 * 總張數(不算跳號)= 紀錄張數 − 待標註:還沒標的跳號一定還是紀錄裡的張(未售、待查…),實體不存在
 * (使用者 10/27 定案:還有待標註就扣,不看拆過沒有)。
 */
export function totalOfCounts(
  counts: BookTicketCounts,
  pendingSkipCount: number,
): number {
  const total = BOOK_COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);
  return Math.max(0, total - pendingSkipCount);
}

/**
 * 本的顯示狀態(庫存分頁、篩選、本的詳情頁首;使用者 10/27 定案 B,依序判斷):
 * 已撤銷 → 有未售:檯面上有 = 檯面中;庫存有 = 未拆(從沒拆過、而且沒有任何一張離開未售 / 庫存)或庫存中;
 * 只剩在途 = 在途 → 沒有未售:有待查 = 待查;有遺失 = 遺失;只有報廢(沒有已售)= 已報廢;其他 = 售完。
 */
export const BOOK_DISPLAY_STATES = [
  "revoked",
  "unopened",
  "on_counter",
  "in_stock",
  "in_transit",
  "investigating",
  "lost",
  "scrapped",
  "sold_out",
] as const;
export type BookDisplayState = (typeof BOOK_DISPLAY_STATES)[number];

/** 判斷顯示狀態要的本上事實。 */
export interface BookStateFacts {
  counts: BookTicketCounts;
  /** 第一次拆本時間;null = 從沒拆過。 */
  firstOpenedAt: Date | null;
  /** 本被撤銷(進貨單作廢)。 */
  revoked: boolean;
}

/** 「原封不動」:從沒拆過、未售的張全在庫存、沒有任何一張售出 / 報廢 / 待查 / 遺失。 */
export function isBookSealed(facts: Omit<BookStateFacts, "revoked">): boolean {
  const { counts } = facts;
  return (
    facts.firstOpenedAt === null &&
    counts.stock > 0 &&
    counts.counter === 0 &&
    counts.inTransit === 0 &&
    counts.sold === 0 &&
    counts.scrapped === 0 &&
    counts.investigating === 0 &&
    counts.lost === 0
  );
}

/**
 * 一家店的這本原封不動:整本原封不動(`isBookSealed`),而且整本都在這家店(這家店持有的張數 = 整本庫存張數)。
 * 只尋回到別家店的幾張、或分在兩家店都不算(使用者 10/27 定案 M1:這家店原封不動才在拆本時標跳號)。
 * `storeTicketCount` = 這家店持有這本的張數(不算跳號)。
 */
export function isSealedInStore(
  facts: Omit<BookStateFacts, "revoked">,
  storeTicketCount: number,
): boolean {
  return isBookSealed(facts) && storeTicketCount === facts.counts.stock;
}

export function bookDisplayStateOf(facts: BookStateFacts): BookDisplayState {
  const { counts } = facts;
  if (facts.revoked) {
    return "revoked";
  }
  if (counts.counter > 0) {
    return "on_counter";
  }
  if (counts.stock > 0) {
    return isBookSealed(facts) ? "unopened" : "in_stock";
  }
  if (counts.inTransit > 0) {
    return "in_transit";
  }
  if (counts.investigating > 0) {
    return "investigating";
  }
  if (counts.lost > 0) {
    return "lost";
  }
  return counts.scrapped > 0 && counts.sold === 0 ? "scrapped" : "sold_out";
}

/**
 * 一家店的這本「未拆」(拆本精靈標跳號、刷到時問拆本、盤點頁「未拆的本」):這本從沒拆過,而且這家店持有的張
 * (不算跳號)都是未售、在庫存。拆過一次就永遠不算未拆(使用者 10/27 定案 D)。
 */
export function isUnopenedInStore(
  firstOpenedAt: Date | null,
  storeTickets: readonly Pick<BookTicketSnapshot, "status" | "locationKind">[],
): boolean {
  const usable = storeTickets.filter(
    (ticket) => ticket.status !== TICKET_STATUS.skipped,
  );
  return (
    firstOpenedAt === null &&
    usable.length > 0 &&
    usable.every(
      (ticket) =>
        ticket.status === TICKET_STATUS.unsold &&
        ticket.locationKind === TICKET_LOCATION_KIND.stock,
    )
  );
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
