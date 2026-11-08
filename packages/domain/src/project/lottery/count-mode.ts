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

/** 兩個位置是同一個(庫存 = 庫存;檯面要同一個收銀點)。 */
export function samePlace(ticket: CountPlace, place: CountPlace): boolean {
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
  const dueAt = renumberDueAtOf(cycle, lastRenumberAt);
  return dueAt !== null && now.getTime() >= dueAt.getTime();
}

/**
 * 補點編號到期的時間(第 10 節「補點編號提醒」;排程的「逾期後每天」從這天起算):不設 → null;
 * 每週 / 雙週 = 上次補點後 7 / 14 天;每月 = 上次補點後一個月(同一天,月底照那個月最後一天)。
 * 從沒補點過 → 呼叫端給的起算時間(例:進入張數店的時間)就是到期。
 */
export function renumberDueAtOf(
  cycle: RenumberCycle,
  lastRenumberAt: Date,
): Date | null {
  if (cycle === "none") {
    return null;
  }
  if (cycle === "monthly") {
    return addMonths(lastRenumberAt, 1);
  }
  const days = cycle === "weekly" ? 7 : 14;
  return new Date(lastRenumberAt.getTime() + days * DAY_MS);
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

/**
 * 分店盤點制度歷程的「為什麼變」(規格 5.6 `history[].cause`):改設定 / 補點編號核准 / 取消轉換。
 */
export const COUNT_MODE_CHANGE_CAUSES = [
  "setting",
  "renumber_approved",
  "convert_cancelled",
] as const;
export type CountModeChangeCause = (typeof COUNT_MODE_CHANGE_CAUSES)[number];

/** 盤點中登記的自動失效:從最後一次操作算起 1 小時(規格 8.5a)。 */
export const STOCKTAKE_SESSION_IDLE_MS = 60 * 60 * 1000;

/** 盤點中登記還有沒有效(最後一次操作後還沒滿 1 小時;規格 8.5a)。 */
export function isStocktakeSessionActive(
  lastActiveAt: Date,
  now: Date,
): boolean {
  return now.getTime() - lastActiveAt.getTime() < STOCKTAKE_SESSION_IDLE_MS;
}

/** 分店那一筆上的進行中工作(規格 5.6 `movePauses`、`stocktakeSessions`)。 */
export interface StoreWorkInProgress {
  /** 進行中的全店重刷(gameId = 那個遊戲)或補點編號(gameId = null) */
  movePauses: readonly { gameId: string | null }[];
  /** 盤點中登記(只看最後一次操作時間;失效、被店長結束的不算) */
  stocktakeSessions: readonly { lastActiveAt: Date; endedAt?: Date | null }[];
}

/** 這家店進行中的工作:有效的盤點中登記、全店重刷、補點編號。 */
export interface StoreBusy {
  stocktake: boolean;
  rescan: boolean;
  renumber: boolean;
}

/**
 * 這家店有沒有進行中的盤點、全店重刷或補點編號(規格 9.1:有的話兩個方向都不能改盤點制度)。
 * 盤點中登記超過 1 小時沒操作就失效、不算(8.5a);重刷 = `movePauses` 有指定遊戲的、補點 = 有 `gameId: null` 的。
 * 都沒有 → null。
 */
export function storeBusyOf(
  work: StoreWorkInProgress,
  now: Date,
): StoreBusy | null {
  const busy: StoreBusy = {
    stocktake: work.stocktakeSessions.some(
      (session) =>
        (session.endedAt ?? null) === null &&
        isStocktakeSessionActive(session.lastActiveAt, now),
    ),
    rescan: work.movePauses.some((pause) => pause.gameId !== null),
    renumber: work.movePauses.some((pause) => pause.gameId === null),
  };
  return busy.stocktake || busy.rescan || busy.renumber ? busy : null;
}

/**
 * 對號發生在哪一種操作(張數店規格 6.3 表的列):看板刷條碼賣與 [標記售出] / 收回 / 刷條碼移櫃 / 調貨 / 報廢 /
 * 補點編號 / 全店重刷。撤銷售出(刷退的票)不找未售的配對張,另見 `pickForReversal`(7.3)。
 */
export const MATCH_OPERATIONS = [
  "sale",
  "recall",
  "move",
  "transfer",
  "scrap",
  "renumber",
  "rescan",
] as const;
export type MatchOperation = (typeof MATCH_OPERATIONS)[number];

/** 找配對張要用到的位置(呼叫端有的才給)。 */
export interface MatchPlaceFacts {
  /** 刷的那台(看板的本機收銀點) */
  scanned?: CountPlace | null;
  /** 刷到的張系統記的位置 */
  system?: CountPlace | null;
  /** 收回、刷條碼移櫃的來源台 */
  source?: CountPlace | null;
  /** 補點編號、全店重刷正在盤的位置 */
  counting?: CountPlace | null;
}

const STOCK_PLACE: CountPlace = {
  locationKind: TICKET_LOCATION_KIND.stock,
  cashPointId: null,
};

/**
 * 對號時依序去哪裡找配對張(張數店規格 6.3):看板賣 → 刷的那台、找不到再找系統記的位置;收回、刷條碼移櫃 →
 * 來源台;調貨、報廢 → 庫存;補點編號、全店重刷 → 正在盤的位置。沒給的位置略過、同一個位置只列一次。
 */
export function matchPlacesOf(
  operation: MatchOperation,
  facts: MatchPlaceFacts,
): CountPlace[] {
  const listed: (CountPlace | null | undefined)[] = {
    sale: [facts.scanned, facts.system],
    recall: [facts.source],
    move: [facts.source],
    transfer: [STOCK_PLACE],
    scrap: [STOCK_PLACE],
    renumber: [facts.counting],
    rescan: [facts.counting],
  }[operation];
  const places: CountPlace[] = [];
  for (const place of listed) {
    if (
      place != null &&
      place.locationKind !== TICKET_LOCATION_KIND.inTransit &&
      !places.some((other) => samePlace(other, place))
    ) {
      places.push(place);
    }
  }
  return places;
}

/** 依張數賣的一列:遊戲 × 張數(張數店規格 7.2、13.1)。 */
export interface CountSaleLine {
  gameId: string;
  count: number;
}

/** 依張數賣的檢查結果;可以賣 = null。 */
export type CountSaleLinesProblem =
  | { kind: "empty" }
  | { kind: "duplicate_game"; gameId: string }
  | { kind: "invalid_count"; gameId: string }
  | { kind: "exceeds"; gameId: string; available: number };

/**
 * 依張數賣送出前的檢查(張數店規格 7.2、13.1):至少一列;同一個遊戲不能兩列;張數是 1 以上的整數;
 * 不超過這個收銀點這個遊戲的未售張數(`available`,沒列到 = 0)。
 */
export function countSaleLinesProblemOf(
  lines: readonly CountSaleLine[],
  available: ReadonlyMap<string, number>,
): CountSaleLinesProblem | null {
  if (lines.length === 0) {
    return { kind: "empty" };
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.gameId)) {
      return { kind: "duplicate_game", gameId: line.gameId };
    }
    seen.add(line.gameId);
    if (!Number.isInteger(line.count) || line.count < 1) {
      return { kind: "invalid_count", gameId: line.gameId };
    }
    const left = available.get(line.gameId) ?? 0;
    if (line.count > left) {
      return { kind: "exceeds", gameId: line.gameId, available: left };
    }
  }
  return null;
}

// ---- 張數盤點一組的比對(規格 8.1、8.2、8.5a B6) ----

/** 張在某一刻的狀態(張數事件的 from / to)。 */
export interface CountLineSnapshot {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/** 這一組開始數之後的一筆張數事件(同遊戲、同店;`at` 晚於 `countedAt`)。 */
export interface CountLineEvent {
  eventId: string;
  type: string;
  from: CountLineSnapshot | null;
  to: CountLineSnapshot;
  refType: string | null;
  refId: string | null;
}

/** 盤點寫的事件(盤點的 [算售出] / 核准的待查;之後的全店重刷、補點編號也記成盤點)。 */
export const STOCKTAKE_REF_TYPE = "stocktake";

const isUnsoldAt = (
  snapshot: CountLineSnapshot | null,
  cashPointId: string,
): boolean =>
  snapshot !== null &&
  snapshot.status === TICKET_STATUS.unsold &&
  snapshot.locationKind === TICKET_LOCATION_KIND.counter &&
  snapshot.cashPointId === cashPointId;

const touches = (event: CountLineEvent, cashPointId: string): boolean =>
  [event.from, event.to].some(
    (snapshot) =>
      snapshot?.locationKind === TICKET_LOCATION_KIND.counter &&
      snapshot.cashPointId === cashPointId,
  );

/** 張數盤點一組的事實(與開始數那一刻比對)。 */
export interface CountLineFacts {
  /** 開始數那一刻這個收銀點這個遊戲的未售張數(8.1「系統數字」) */
  systemCount: number;
  /** 這次盤點自己 [算售出] 的張數(`saleRefIds` 的售出事件) */
  ownSaleCount: number;
  /**
   * 開始數之後,這個收銀點的這個遊戲已有別張盤點、重刷或補點寫入的事件(8.5a B6)→ 這一組退回重數。
   * 一般的銷售、移櫃不算(盤點以開始數那一刻的系統數字比對)。
   */
  touchedByOther: boolean;
}

/**
 * 張數盤點一組的事實(規格 8.1、8.5a B6;14.1 張數盤點):由「現在的未售張數」與開始數之後的事件倒推那一刻:
 * 每筆事件之後進到這裡(to 是這台未售)的減回去、離開的加回來。
 */
export function countLineFactsOf(
  currentUnsold: number,
  eventsAfter: readonly CountLineEvent[],
  cashPointId: string,
  ownSaleRefIds: ReadonlySet<string>,
): CountLineFacts {
  let systemCount = currentUnsold;
  let ownSaleCount = 0;
  let touchedByOther = false;
  for (const event of eventsAfter) {
    systemCount +=
      (isUnsoldAt(event.from, cashPointId) ? 1 : 0) -
      (isUnsoldAt(event.to, cashPointId) ? 1 : 0);
    if (event.refType !== STOCKTAKE_REF_TYPE || !touches(event, cashPointId)) {
      continue;
    }
    if (event.refId !== null && ownSaleRefIds.has(event.refId)) {
      ownSaleCount += event.type === "sale_stocktake" ? 1 : 0;
    } else {
      touchedByOther = true;
    }
  }
  return { systemCount, ownSaleCount, touchedByOther };
}

/** 張數盤點一組的處理(畫面送來的)。 */
export interface CountLineChoice {
  presentCount: number;
  saleCount: number;
  investigateCount: number;
  flagged: boolean;
}

/**
 * 張數盤點一組送出前的檢查(規格 8.2、8.5a B6):
 *
 * - `stale`(這一組退回重數):開始數之後被別張盤點 / 重刷 / 補點處理過;或處理對不上目前的差異
 *   (算售出的張數和這次真的寫的不同、沒差異卻有處理、少的卻標記異常、多的卻算售出 / 待查、拆開加起來超過)
 * - `unhandled`:少 N 張還沒分完(算售出 + 待查 < N)、多出還沒 [標記異常]
 */
export function countLineProblemOf(
  facts: CountLineFacts,
  choice: CountLineChoice,
): "stale" | "unhandled" | null {
  if (facts.touchedByOther || facts.ownSaleCount !== choice.saleCount) {
    return "stale";
  }
  const diff = countDiffOf(facts.systemCount, choice.presentCount);
  const assigned = choice.saleCount + choice.investigateCount;
  switch (diff.kind) {
    case "match": {
      return assigned > 0 || choice.flagged ? "stale" : null;
    }
    case "short": {
      if (choice.flagged || assigned > diff.count) {
        return "stale";
      }
      return assigned < diff.count ? "unhandled" : null;
    }
    case "over": {
      if (assigned > 0) {
        return "stale";
      }
      return choice.flagged ? null : "unhandled";
    }
  }
}
