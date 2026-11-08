import {
  type CountPickBook,
  type CountPlace,
  type MatchTicket,
  STOCKTAKE_SESSION_IDLE_MS,
  isStocktakeSessionActive,
  matchPartnerOf,
  samePlace,
} from "./count-mode";
import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
} from "./ticket-events";

/**
 * 全店重刷(張數店規格 8.3–8.5a、14.1 `rescanResultOf`;正本 `docs/modules/project/store.md`「全店重刷」):
 * 把全店(各收銀台與庫存已拆的本)某一個遊戲還在的張一個位置一個位置刷一遍,找出系統猜錯的張。
 * api 讀寫、admin 顯示共用這裡的規則。
 *
 * 位置 = 收銀點檯面或庫存(`cashPointId: null`);全部位置按「這裡刷完了」這次重刷才結束。
 */

/** 全店重刷頁的掃描用途(B10;開著時條碼槍刷到的碼交給重刷頁,不走看板的銷售)。 */
export const STORE_RESCAN_SCAN_PURPOSE = "store-rescan";

/** 重刷的自動失效:某個位置「刷到一半」、整次重刷都是 1 小時沒有動作(8.4 第 6 點,同盤點 8.5a)。 */
export const RESCAN_IDLE_MS = STOCKTAKE_SESSION_IDLE_MS;

/**
 * 刷到一張的結果(13.1 全店重刷頁「刷到的每張標結果」):
 *
 * - `ok` 沒問題(系統記在這裡、未售)
 * - `matched` 已對號(和這個位置一張還沒刷到的未售互換「狀態 + 位置」,6.3)
 * - `recovered` 已尋回(記待查 / 遺失、找不到配對 → 未售、留在刷到的位置,7.9)
 * - `moved` 位置已更正(系統記在別的位置的未售、這個位置已沒有可對號的張 → 記到這裡;規格沒寫到的情況,見模組文件)
 * - `sold_here` 記已售但還在(找不到配對;提供 [送撤銷售出申請],7.3 第 4 點)
 * - `skipped` / `scrapped` / `locked` 記跳號 / 記報廢 / 鎖定中(含調貨在途):不動,要先更正(8.4 第 5 點)
 * - `unopened` 這本還沒拆(重刷只涵蓋已拆的本)
 * - `other_game` 不是重刷的遊戲;`not_this_store` 不是本店的張(都不處理)
 */
export const RESCAN_OUTCOMES = [
  "ok",
  "matched",
  "recovered",
  "moved",
  "sold_here",
  "skipped",
  "scrapped",
  "locked",
  "unopened",
  "other_game",
  "not_this_store",
] as const;
export type RescanOutcome = (typeof RESCAN_OUTCOMES)[number];

/** 要先更正(不動)的結果(8.4 第 5 點)。 */
export const RESCAN_FIX_OUTCOMES: readonly RescanOutcome[] = [
  "skipped",
  "scrapped",
  "locked",
  "unopened",
];

/** 刷到的一張。 */
export interface RescanTicket {
  id: string;
  gameId: string;
  bookId: string;
  inThisStore: boolean;
  status: TicketStatus;
  unmatched: boolean;
  locked: boolean;
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/** 一個位置的處理要用到的事實(都在交易裡一次讀完)。 */
export interface RescanPlaceInput {
  /** 重刷的遊戲 */
  gameId: string;
  /** 正在刷的位置 */
  place: CountPlace;
  /** 這個位置刷到的張(依刷的順序、不重複) */
  scanned: readonly RescanTicket[];
  /** 這個位置這個遊戲的未售張(配對張與「沒刷到 → 待查」都從這裡挑) */
  candidates: readonly MatchTicket[];
  /** 本(第一次拆本時間、本號;刷到的張與候選的本都要有) */
  books: ReadonlyMap<string, CountPickBook>;
}

/** 刷到的一張的處理。 */
export interface RescanItemResult {
  ticketId: string;
  outcome: RescanOutcome;
  /** `matched`:互換的配對張 */
  partnerId: string | null;
}

/** 一個位置的處理:刷到的每張的結果、系統記在這裡但沒刷到的未售(→ 待查)。 */
export interface RescanPlaceResult {
  items: RescanItemResult[];
  investigate: string[];
}

const isMissing = (status: TicketStatus): boolean =>
  status === TICKET_STATUS.investigating || status === TICKET_STATUS.lost;

/**
 * 不用找配對就定的結果:不是本店 / 不是這個遊戲 → 不處理;鎖定(含在途)、記跳號、記報廢 → 要先更正;
 * 本還沒拆 → 不在範圍(庫存裡刷到的未售 = 沒問題)。其他 → null(照對號規則處理)。
 */
function fixedOutcomeOf(
  ticket: RescanTicket,
  gameId: string,
  place: CountPlace,
  opened: boolean,
): RescanOutcome | null {
  if (!ticket.inThisStore) {
    return "not_this_store";
  }
  if (ticket.gameId !== gameId) {
    return "other_game";
  }
  if (ticket.locked || ticket.locationKind === TICKET_LOCATION_KIND.inTransit) {
    return "locked";
  }
  if (
    ticket.status === TICKET_STATUS.skipped ||
    ticket.status === TICKET_STATUS.scrapped
  ) {
    return ticket.status;
  }
  if (opened) {
    return null;
  }
  return ticket.status === TICKET_STATUS.unsold &&
    samePlace(ticket, place) &&
    place.locationKind === TICKET_LOCATION_KIND.stock
    ? "ok"
    : "unopened";
}

/** 沒有對號(不用或找不到配對)時的結果:未售 → 在這裡沒問題 / 記到這裡;待查 / 遺失 → 尋回;已售 → 記已售但還在。 */
function unpairedOutcomeOf(status: TicketStatus, here: boolean): RescanOutcome {
  if (status === TICKET_STATUS.unsold) {
    return here ? "ok" : "moved";
  }
  return isMissing(status) ? "recovered" : "sold_here";
}

/**
 * 全店重刷一個位置的處理(張數店規格 8.4 第 3–5 點、6.3「補點編號、全店重刷 → 正在盤的位置」、6.7、7.9、14.1):
 *
 * 1. 不是本店 / 不是重刷的遊戲 → 不處理;鎖定中(含在途)、記跳號、記報廢 → 不動、要先更正;本還沒拆 → 不在範圍
 *    (庫存裡未拆的本刷到 → 沒問題)
 * 2. 要對號的張(6.7 ④):系統記未售但在別的位置;已售 / 待查 / 遺失而未對號或位置不同 →
 *    在這個位置照挑張順序找配對張(未售、沒被鎖、本已拆過,**不挑已刷到的張**,同一個位置不重複挑)
 * 3. 找不到配對:已售 → 記已售但還在(提供 [送撤銷售出申請],重刷不直接改回未售);待查 / 遺失 → 尋回、留在刷到的位置;
 *    系統記在別的位置的未售 → 記到這裡(這個位置實體比系統多,規格沒寫到的情況)
 * 4. 確定的已售(不是未對號、在這裡)→ 記已售但還在;確定的待查 / 遺失、在這裡 → 尋回
 * 5. 系統記在這裡、沒刷到也沒被挑去配對的未售(本已拆過、沒被鎖)→ 待查(8.4 第 4 點)
 */
export function rescanResultOf(input: RescanPlaceInput): RescanPlaceResult {
  const { gameId, place, books } = input;
  const opened = (bookId: string): boolean =>
    (books.get(bookId)?.firstOpenedAt ?? null) !== null;
  const pool = input.candidates.filter(
    (ticket) =>
      ticket.gameId === gameId &&
      ticket.status === TICKET_STATUS.unsold &&
      !ticket.locked &&
      opened(ticket.bookId) &&
      samePlace(ticket, place),
  );
  // 已刷到的張不當配對;挑過的配對不再挑
  const used = new Set(input.scanned.map((ticket) => ticket.id));
  const items: RescanItemResult[] = input.scanned.map((ticket) => {
    const result = (
      outcome: RescanOutcome,
      partnerId: string | null = null,
    ): RescanItemResult => ({ ticketId: ticket.id, outcome, partnerId });
    const here = samePlace(ticket, place);
    const fixed = fixedOutcomeOf(ticket, gameId, place, opened(ticket.bookId));
    if (fixed !== null) {
      return result(fixed);
    }
    const needsMatch =
      ticket.status === TICKET_STATUS.unsold
        ? !here
        : ticket.unmatched || !here;
    if (needsMatch) {
      const partnerId = matchPartnerOf(
        { id: ticket.id, gameId },
        pool.filter((candidate) => !used.has(candidate.id)),
        books,
        [place],
      );
      if (partnerId !== null) {
        used.add(partnerId);
        return result("matched", partnerId);
      }
    }
    return result(unpairedOutcomeOf(ticket.status, here));
  });
  return {
    items,
    investigate: pool
      .filter((ticket) => !used.has(ticket.id))
      .map((ticket) => ticket.id),
  };
}

// ---- 位置的狀態(8.4 第 1、6 點) ----

/** 一個位置在重刷裡的狀態:還沒刷 / 刷到一半(有人在刷)/ 刷到一半但 1 小時沒刷(已釋出,別人可接手)/ 刷完。 */
export type RescanPlaceState = "pending" | "scanning" | "released" | "done";

/** 一個位置的事實(重刷盤點單 `rescan.places[]`)。 */
export interface RescanPlaceFacts {
  /** 刷到一半的人;null = 沒人在刷 */
  scanningBy: string | null;
  /** 這個位置最後一次刷到(或開始刷)的時間 */
  lastScanAt: Date | null;
  doneAt: Date | null;
  /** 已刷的張數(釋出後清單保留) */
  scannedCount: number;
}

/** 一個位置現在的狀態。 */
export function rescanPlaceStateOf(
  place: RescanPlaceFacts,
  now: Date,
): RescanPlaceState {
  if (place.doneAt !== null) {
    return "done";
  }
  if (
    place.scanningBy !== null &&
    place.lastScanAt !== null &&
    isStocktakeSessionActive(place.lastScanAt, now)
  ) {
    return "scanning";
  }
  return place.scanningBy !== null || place.scannedCount > 0
    ? "released"
    : "pending";
}

/** 這個位置已開始刷、還沒按「這裡刷完了」(8.5a B5 擋盤點那一組;釋出的也算,清單還在)。 */
export const isRescanPlaceStarted = (state: RescanPlaceState): boolean =>
  state === "scanning" || state === "released";

/** 開始(或接著)刷一個位置:可以 / 已刷完 / 別人正在刷(誰)。 */
export type RescanPlaceStart =
  { kind: "ok" } | { kind: "done" } | { kind: "busy"; by: string };

/**
 * 能不能在這個位置刷(8.4 第 1、6 點):刷完的不能再刷;別人正在刷(1 小時內有刷)→ 擋;
 * 自己刷到一半(換裝置也算)、釋出的、還沒刷的 → 可以。盤點中登記另由呼叫端檢查(8.5a)。
 */
export function rescanPlaceStartOf(
  place: RescanPlaceFacts,
  by: string,
  now: Date,
): RescanPlaceStart {
  const state = rescanPlaceStateOf(place, now);
  if (state === "done") {
    return { kind: "done" };
  }
  if (
    state === "scanning" &&
    place.scanningBy !== null &&
    place.scanningBy !== by
  ) {
    return { kind: "busy", by: place.scanningBy };
  }
  return { kind: "ok" };
}

// ---- 整次重刷(8.4 第 6 點、8.5a B3) ----

/** 整次重刷還沒自動取消:最後一次有位置刷到或按刷完之後還沒滿 1 小時。 */
export const isRescanLive = (lastActiveAt: Date, now: Date): boolean =>
  isStocktakeSessionActive(lastActiveAt, now);

/** 整次重刷自動取消的時間。 */
export const rescanExpiresAtOf = (lastActiveAt: Date): Date =>
  new Date(lastActiveAt.getTime() + RESCAN_IDLE_MS);

/** 剩幾分鐘自動取消(無條件進位;已失效 = 0)。 */
export const rescanMinutesLeftOf = (lastActiveAt: Date, now: Date): number =>
  Math.max(
    0,
    Math.ceil(
      (rescanExpiresAtOf(lastActiveAt).getTime() - now.getTime()) / 60_000,
    ),
  );

/** 開始重刷被擋的原因(8.5a B3):這個遊戲已在重刷中 / 補點編號中。 */
export type RescanStartBlock = "rescan" | "renumber";

/**
 * 能不能開始重刷遊戲 X(5.6、8.5a B3):補點編號中(`gameId: null`)→ 擋;同一個遊戲已有重刷 → 擋;
 * 其他遊戲的重刷不影響(可以多個遊戲同時重刷)。
 */
export function rescanStartBlockOf(
  pauses: readonly { gameId: string | null }[],
  gameId: string,
): RescanStartBlock | null {
  if (pauses.some((pause) => pause.gameId === null)) {
    return "renumber";
  }
  return pauses.some((pause) => pause.gameId === gameId) ? "rescan" : null;
}

/** 進行中的重刷(B5 用):遊戲、各位置的狀態。 */
export interface ActiveRescan {
  gameId: string;
  places: readonly { cashPointId: string | null; state: RescanPlaceState }[];
}

/**
 * 盤點這一組(位置 P × 遊戲 X)能不能數(8.5a B5):P 的 X 已開始刷、還沒按「這裡刷完了」→ 不能數
 * (「這裡正在重刷 X,刷完再數」)。
 */
export function rescanBlocksCountGroup(
  rescans: readonly ActiveRescan[],
  cashPointId: string | null,
  gameId: string,
): boolean {
  return rescans.some(
    (rescan) =>
      rescan.gameId === gameId &&
      rescan.places.some(
        (place) =>
          place.cashPointId === cashPointId &&
          isRescanPlaceStarted(place.state),
      ),
  );
}

/** 一個遊戲的重刷提醒的事實(8.3)。 */
export interface RescanReminderFacts {
  gameId: string;
  /** 待查·未對號(上次重刷完成後才記的) */
  investigateCount: number;
  /** [標記異常] 的張數(上次重刷完成後送出的盤點) */
  flaggedCount: number;
}

/**
 * 要提醒全店重刷的遊戲(8.3):有「待查·未對號未確認」或「標記異常」,而且這個遊戲現在沒有重刷進行中
 * (重刷中改顯示重刷的橫幅;重刷完成後,完成前記的不再提醒)。
 */
export function rescanReminderGamesOf<T extends RescanReminderFacts>(
  rows: readonly T[],
  activeGameIds: ReadonlySet<string>,
): T[] {
  return rows.filter(
    (row) =>
      (row.investigateCount > 0 || row.flaggedCount > 0) &&
      !activeGameIds.has(row.gameId),
  );
}

/** [取消重刷](8.4 第 6 點、12):開始重刷的人或店長。 */
export const canCancelRescan = (
  startedBy: string,
  operatorId: string | null,
  isManager: boolean,
): boolean => isManager || (operatorId !== null && startedBy === operatorId);

/**
 * 全店重刷的錯誤原因(GQL-04 的 `extensions.reason`;正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export const RESCAN_REASONS = {
  /** 只有張數店與轉換中可以重刷 */
  notCountStore: "RESCAN_NOT_COUNT_STORE",
  /** B3:這個遊戲已在重刷中 / 補點編號中(`extensions.block`) */
  startBlocked: "RESCAN_START_BLOCKED",
  /** 這個位置有人登記盤點中(`extensions.session`;8.5a) */
  placeStocktaking: "RESCAN_PLACE_STOCKTAKING",
  /** 這個位置正在由別人刷(`extensions.byName`) */
  placeBusy: "RESCAN_PLACE_BUSY",
  /** 這個位置已按「這裡刷完了」 */
  placeDone: "RESCAN_PLACE_DONE",
  /** 這次重刷已結束(完成、取消或 1 小時沒動作自動取消) */
  ended: "RESCAN_ENDED",
  /** 刷到的碼找不到張 */
  notFound: "RESCAN_TICKET_NOT_FOUND",
} as const;
