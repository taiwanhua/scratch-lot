import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 張數店的規則(張數店規格第 4、6、8.2、9、10 節、14.1):挑張順序、對號的配對張、盤點制度的轉換、
 * 補點編號到期、張數盤點的差異。只放純函式,api 讀寫、admin 顯示都引用這裡。
 */

/** 分店實際的盤點制度:編號 / 張數 / 轉換中(張數 → 編號,等補點編號)。 */
export const COUNT_MODES = ["numbered", "count", "converting"] as const;
export type CountMode = (typeof COUNT_MODES)[number];

export const COUNT_MODE = {
  numbered: "numbered",
  count: "count",
  converting: "converting",
} as const satisfies Record<string, CountMode>;

/** 「盤點制度」設定的值(設定只有兩種;轉換中是分店的狀態,不是設定值)。 */
export type CountModeSetting = Exclude<CountMode, "converting">;

/** 補點編號提醒的週期:不設 / 每週 / 雙週 / 每月(程式預設每月)。 */
export const RENUMBER_CYCLES = [
  "none",
  "weekly",
  "biweekly",
  "monthly",
] as const;
export type RenumberCycle = (typeof RENUMBER_CYCLES)[number];

/** 挑張用的一張(id 由呼叫端決定格式)。 */
export interface CountPickTicket {
  id: string;
  bookId: string;
  ticketNo: string;
  status: TicketStatus;
  locked: boolean;
}

/** 挑張用的本:第一次拆本時間(null = 沒拆過)、本號。 */
export interface CountPickBook {
  firstOpenedAt: Date | null;
  bookNo: string;
}

/** 挑張結果:夠 → 挑到的張(依挑張順序);不夠 → 只有幾張可挑。 */
export type CountPickResult =
  { ok: true; ticketIds: string[] } | { ok: false; available: number };

/** 依本的第一次拆本時間(沒拆過的排最後)→ 本號 → 張號排序。 */
function pickOrder(
  books: ReadonlyMap<string, CountPickBook>,
): (left: CountPickTicket, right: CountPickTicket) => number {
  const openedAt = (ticket: CountPickTicket): number =>
    books.get(ticket.bookId)?.firstOpenedAt?.getTime() ??
    Number.POSITIVE_INFINITY;
  return (left, right) => {
    const byOpened = openedAt(left) - openedAt(right);
    if (byOpened !== 0 && !Number.isNaN(byOpened)) {
      return byOpened;
    }
    const byBook = (books.get(left.bookId)?.bookNo ?? "").localeCompare(
      books.get(right.bookId)?.bookNo ?? "",
    );
    return byBook === 0 ? left.ticketNo.localeCompare(right.ticketNo) : byBook;
  };
}

/**
 * 依張數賣、盤點 [算售出] / [待查]、依張數移櫃要挑哪幾張(規格 7.2、14.1):呼叫端給同遊戲、同位置的張,
 * 只挑未售、沒被鎖的,依本的第一次拆本時間 → 本號 → 張號;不夠 n 張 → 回只有幾張可挑。
 */
export function pickForCountSale(
  tickets: readonly CountPickTicket[],
  books: ReadonlyMap<string, CountPickBook>,
  n: number,
): CountPickResult {
  const candidates = tickets
    .filter(
      (ticket) => ticket.status === TICKET_STATUS.unsold && !ticket.locked,
    )
    .toSorted(pickOrder(books));
  if (candidates.length < n) {
    return { ok: false, available: candidates.length };
  }
  return {
    ok: true,
    ticketIds: candidates.slice(0, n).map((ticket) => ticket.id),
  };
}

/** 撤銷依張數售出時挑的一張:已售·未對號、售出時間。 */
export interface ReversalPickTicket {
  id: string;
  status: TicketStatus;
  unmatched: boolean;
  locked: boolean;
  soldAt: Date | null;
}

/**
 * 「依遊戲 + 張數」撤銷要挑哪幾張(規格 7.3、14.1):最近的已售·未對號(售出時間新到舊),沒被鎖的;
 * 不夠 n 張 → 回只有幾張可挑。
 */
export function pickForReversal(
  tickets: readonly ReversalPickTicket[],
  n: number,
): CountPickResult {
  const candidates = tickets
    .filter(
      (ticket) =>
        ticket.status === TICKET_STATUS.sold &&
        ticket.unmatched &&
        !ticket.locked,
    )
    .toSorted(
      (left, right) =>
        (right.soldAt?.getTime() ?? 0) - (left.soldAt?.getTime() ?? 0),
    );
  if (candidates.length < n) {
    return { ok: false, available: candidates.length };
  }
  return {
    ok: true,
    ticketIds: candidates.slice(0, n).map((ticket) => ticket.id),
  };
}

/** 位置:庫存 / 檯面(哪個收銀點)。在途不能當配對張。 */
export interface CountPlace {
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/** 對號用的一張。 */
export interface MatchTicket extends CountPickTicket, CountPlace {
  gameId: string;
}

function samePlace(ticket: CountPlace, place: CountPlace): boolean {
  return (
    ticket.locationKind === place.locationKind &&
    (place.locationKind !== TICKET_LOCATION_KIND.counter ||
      ticket.cashPointId === place.cashPointId)
  );
}

/**
 * 刷到的張要和哪一張互換(規格 6.2、6.3、14.1):依呼叫端給的位置順序(6.3 的「先找 → 找不到再找」),
 * 在每個位置找同遊戲、未售、沒被鎖、不在途、本已拆過的張,照挑張順序取第一張(可跨本);都沒有 → null。
 * 刷到的那張自己不算。
 */
export function matchPartnerOf(
  scanned: Pick<MatchTicket, "id" | "gameId">,
  candidates: readonly MatchTicket[],
  books: ReadonlyMap<string, CountPickBook>,
  places: readonly CountPlace[],
): string | null {
  for (const place of places) {
    if (place.locationKind === TICKET_LOCATION_KIND.inTransit) {
      continue;
    }
    const picked = pickForCountSale(
      candidates.filter(
        (ticket) =>
          ticket.id !== scanned.id &&
          ticket.gameId === scanned.gameId &&
          (books.get(ticket.bookId)?.firstOpenedAt ?? null) !== null &&
          samePlace(ticket, place),
      ),
      books,
      1,
    );
    if (picked.ok) {
      return picked.ticketIds[0] ?? null;
    }
  }
  return null;
}

/**
 * 改「盤點制度」設定後,分店實際要變成哪一種(規格 9.1、9.2、14.1):
 * 設成張數 → 張數(當下生效);設成編號 → 原本是編號就照舊,原本是張數或轉換中 → 還有未對號的張就進轉換中、
 * 沒有就直接改成編號。
 */
export function countModeOf(
  setting: CountModeSetting,
  unmatchedCount: number,
  current: CountMode,
): CountMode {
  if (setting === COUNT_MODE.count) {
    return COUNT_MODE.count;
  }
  if (current === COUNT_MODE.numbered) {
    return COUNT_MODE.numbered;
  }
  return unmatchedCount > 0 ? COUNT_MODE.converting : COUNT_MODE.numbered;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 加 n 個月(日期超過那個月的天數 → 那個月最後一天;以 UTC 計)。 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * 補點編號是否到期(規格 10「補點編號提醒」、14.1):不設 → 不到期;從沒補點過 → 到期;
 * 每週 / 雙週 = 上次補點後滿 7 / 14 天;每月 = 上次補點後滿一個月(同一天,月底照那個月最後一天)。
 */
export function renumberDueOf(
  cycle: RenumberCycle,
  lastRenumberAt: Date | null,
  now: Date,
): boolean {
  if (cycle === "none") {
    return false;
  }
  if (lastRenumberAt === null) {
    return true;
  }
  const days = cycle === "weekly" ? 7 : 14;
  const dueAt =
    cycle === "monthly"
      ? addMonths(lastRenumberAt, 1)
      : new Date(lastRenumberAt.getTime() + days * DAY_MS);
  return now.getTime() >= dueAt.getTime();
}

/** 張數盤點一組(收銀點 × 遊戲)差異的處理(規格 8.2)。 */
export const COUNT_DIFF_ACTIONS = [
  "count_sale",
  "investigate",
  "mark_abnormal",
] as const;
export type CountDiffAction = (typeof COUNT_DIFF_ACTIONS)[number];

/** 一組的差異:沒差 / 少 N 張 / 多 N 張,與可用的處理。 */
export type CountDiff =
  | { kind: "match"; count: 0; actions: [] }
  | { kind: "short"; count: number; actions: ["count_sale", "investigate"] }
  | { kind: "over"; count: number; actions: ["mark_abnormal"] };

/**
 * 張數盤點一組的差異(規格 8.2、14.1):系統未售張數 vs 實際數到的。少 → [算售出]、[待查](可拆開);
 * 多 → [標記異常](只做記號,張的狀態不動)。
 */
export function countDiffOf(
  systemCount: number,
  presentCount: number,
): CountDiff {
  if (presentCount < systemCount) {
    return {
      kind: "short",
      count: systemCount - presentCount,
      actions: ["count_sale", "investigate"],
    };
  }
  if (presentCount > systemCount) {
    return {
      kind: "over",
      count: presentCount - systemCount,
      actions: ["mark_abnormal"],
    };
  }
  return { kind: "match", count: 0, actions: [] };
}

/**
 * 少 N 張拆成「算售出 x、待查 y」時的問題(規格 8.2):要是 0 以上的整數、加起來剛好 N;沒問題 → null。
 */
export function shortSplitProblemOf(
  short: number,
  sale: number,
  investigate: number,
): "invalid" | "not_total" | null {
  if (
    ![sale, investigate].every((value) => Number.isInteger(value) && value >= 0)
  ) {
    return "invalid";
  }
  return sale + investigate === short ? null : "not_total";
}
