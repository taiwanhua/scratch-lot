import {
  COUNT_MODE,
  type CountMode,
  type CountModeChangeCause,
  type CountPickBook,
  RENUMBER_CYCLES,
  type RenumberCycle,
  isStocktakeSessionActive,
  pickForCountSale,
  renumberDueAtOf,
} from "./count-mode";
import { TICKET_STATUS, type TicketStatus } from "./ticket-events";

/**
 * 補點編號(張數店規格 9.2、9.3、10、16.8):自動對號、移櫃暫停跟著登記走、月底補點編號的關帳檢查、
 * 日結第 ② 步的預設選項。只放純函式,api 讀寫、admin 顯示都引用這裡。
 */

// ---- 自動對號(9.3 第 2 點) ----

/** 補點編號比對的一張(位置 = 收銀點 id;庫存 = `"stock"`)。 */
export interface RenumberTicket {
  ticketId: string;
  ticketNo: string;
  bookId: string;
  gameId: string;
  place: string;
}

/** 實際在、系統是未對號(已售 / 待查 / 遺失)的張。 */
export interface RenumberPresentTicket extends RenumberTicket {
  status: TicketStatus;
}

/** 自動對號的一組:實際在的未對號張 ↔ 實際不在、系統未售的張(配對張)。 */
export interface RenumberMatch {
  ticketId: string;
  partnerId: string;
  gameId: string;
  place: string;
}

export interface RenumberMatchResult {
  matches: RenumberMatch[];
  /** 實際在、系統是未對號,但同遊戲同位置已沒有「實際不在、系統未售」可配的張 */
  leftoverPresent: string[];
  /** 實際不在、系統未售,沒有被配走的張(照編號盤點的差異處理) */
  leftoverAbsent: string[];
}

const UNMATCHED_STATUSES: ReadonlySet<TicketStatus> = new Set([
  TICKET_STATUS.sold,
  TICKET_STATUS.investigating,
  TICKET_STATUS.lost,
]);

const groupKeyOf = (ticket: RenumberTicket): string =>
  `${ticket.gameId}@${ticket.place}`;

/** 依挑張順序排(本的第一次拆本時間 → 本號 → 張號;`pickForCountSale` 同一個順序)。 */
function sortByPickOrder<T extends RenumberTicket>(
  tickets: readonly T[],
  books: ReadonlyMap<string, CountPickBook>,
): T[] {
  const picked = pickForCountSale(
    tickets.map((ticket) => ({
      id: ticket.ticketId,
      bookId: ticket.bookId,
      ticketNo: ticket.ticketNo,
      status: TICKET_STATUS.unsold,
      locked: false,
    })),
    books,
    tickets.length,
  );
  const byId = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  return picked.ok
    ? picked.ticketIds.flatMap((id) => {
        const ticket = byId.get(id);
        return ticket === undefined ? [] : [ticket];
      })
    : [...tickets];
}

/**
 * 補點編號比對時的自動對號(張數店規格 9.3 第 2 點、16.8 RN1):每個「遊戲 × 位置」,實際在、系統是未對號
 * (已售 / 待查 / 遺失)的張,依挑張順序配實際不在、系統未售的張(可跨同遊戲的不同本);不算差異、不動現金。
 * 配不完的兩邊各自留下:實際不在的照編號盤點的差異處理,實際在的見 `RenumberMatchResult.leftoverPresent`。
 * 不是未對號狀態的張不配。
 */
export function renumberMatchesOf(
  present: readonly RenumberPresentTicket[],
  absent: readonly RenumberTicket[],
  books: ReadonlyMap<string, CountPickBook>,
): RenumberMatchResult {
  const presentOf = new Map<string, RenumberPresentTicket[]>();
  for (const ticket of present) {
    if (!UNMATCHED_STATUSES.has(ticket.status)) {
      continue;
    }
    const key = groupKeyOf(ticket);
    presentOf.set(key, [...(presentOf.get(key) ?? []), ticket]);
  }
  const absentOf = new Map<string, RenumberTicket[]>();
  for (const ticket of absent) {
    const key = groupKeyOf(ticket);
    absentOf.set(key, [...(absentOf.get(key) ?? []), ticket]);
  }
  const matches: RenumberMatch[] = [];
  const leftoverPresent: string[] = [];
  const leftoverAbsent: string[] = [];
  const keys = new Set([...presentOf.keys(), ...absentOf.keys()]);
  for (const key of keys) {
    const here = sortByPickOrder(presentOf.get(key) ?? [], books);
    const missing = sortByPickOrder(absentOf.get(key) ?? [], books);
    const pairs = Math.min(here.length, missing.length);
    for (let index = 0; index < pairs; index += 1) {
      const ticket = here[index];
      const partner = missing[index];
      if (ticket !== undefined && partner !== undefined) {
        matches.push({
          ticketId: ticket.ticketId,
          partnerId: partner.ticketId,
          gameId: ticket.gameId,
          place: ticket.place,
        });
      }
    }
    leftoverPresent.push(...here.slice(pairs).map((ticket) => ticket.ticketId));
    leftoverAbsent.push(
      ...missing.slice(pairs).map((ticket) => ticket.ticketId),
    );
  }
  return { matches, leftoverPresent, leftoverAbsent };
}

// ---- 核准(9.3 第 4 點) ----

/** 補點編號核准後分店那一筆要寫什麼(歷程的一筆、新的制度)。 */
export interface RenumberApprovalOutcome {
  /** 核准後的盤點制度:轉換中 → 編號;其他不變 */
  mode: CountMode;
  history: {
    from: CountMode;
    to: CountMode;
    cause: CountModeChangeCause;
  };
}

/**
 * 補點編號核准後的盤點制度(9.3 第 4 點、16.8 RN2、16.2 SW3):轉換中的店改成編號;生效設定已是張數
 * (含核准前 [取消轉換] 回到張數)→ 照樣對號、清記號、記上次補點,只是不改制度。每次核准都記一筆歷程
 * (`renumber_approved`;沒改制度時 from = to,報表的「補點編號次數」靠它算)。
 */
export function renumberApprovalOf(
  current: CountMode,
): RenumberApprovalOutcome {
  const mode =
    current === COUNT_MODE.converting ? COUNT_MODE.numbered : current;
  return {
    mode,
    history: { from: current, to: mode, cause: "renumber_approved" },
  };
}

/** 能不能做補點編號:張數店與轉換中可以;編號店沒有未對號,不用(9.3「張數店不切制度、只做補點編號也可以」)。 */
export const canRenumber = (mode: CountMode): boolean =>
  mode === COUNT_MODE.count || mode === COUNT_MODE.converting;

/** 開始補點編號被擋的原因(8.5a B4):有任何遊戲正在全店重刷。 */
export type RenumberStartBlock = "rescan";

/** 能不能開始補點編號(8.5a B4):有任何全店重刷進行中(`gameId` 不是 null 的暫停)→ 擋。 */
export function renumberStartBlockOf(
  pauses: readonly { gameId: string | null }[],
): RenumberStartBlock | null {
  return pauses.some((pause) => pause.gameId !== null) ? "rescan" : null;
}

// ---- 補點編號的移櫃暫停跟著盤點中登記走(5.6、8.5) ----

/** 盤點中登記裡和補點編號暫停有關的欄位。 */
export interface RenumberPauseSession {
  /** 這次補點編號在 `movePauses` 的那一筆(一般盤點 = null) */
  renumberPauseId?: string | null;
  lastActiveAt: Date;
  endedAt?: Date | null;
}

/**
 * 有效的移櫃暫停(5.6、8.5、8.5a):全店重刷的照舊(另有自己的自動取消);補點編號(`gameId: null`)只有它的
 * 盤點中登記還有效時才算 —— 補點中 = 盤點中登記有效到送出、放棄或失效為止(1 小時沒操作、店長結束後不再暫停;
 * 本人 [繼續] 時恢復)。送出後的審核期間不暫停(9.3 第 5 點:審核中的補點在取消轉換後照樣可以核准)。
 */
export function liveMovePausesOf<
  T extends { stocktakeId: string; gameId: string | null },
>(
  pauses: readonly T[],
  sessions: readonly RenumberPauseSession[],
  now: Date,
): T[] {
  const live = new Set(
    sessions
      .filter(
        (session) =>
          (session.renumberPauseId ?? null) !== null &&
          (session.endedAt ?? null) === null &&
          isStocktakeSessionActive(session.lastActiveAt, now),
      )
      .map((session) => session.renumberPauseId ?? ""),
  );
  return pauses.filter(
    (pause) => pause.gameId !== null || live.has(pause.stocktakeId),
  );
}

// ---- 月底補點編號(第 10 節、16.8 CL1) ----

/** 歷程的一筆(依時間;只看 at、from、to)。 */
export interface CountModeHistoryPoint {
  from: CountMode | null;
  to: CountMode;
  at: Date;
}

/**
 * 某個時間點這家店的盤點制度(第 10 節「那個月底是張數或轉換中」):那之前最後一筆歷程的 `to`;
 * 那之前沒有歷程 → 之後第一筆的 `from`(沒有 = 編號);完全沒有歷程 → 現在的制度。
 */
export function countModeAtOf(
  history: readonly CountModeHistoryPoint[],
  current: CountMode,
  at: Date,
): CountMode {
  if (history.length === 0) {
    return current;
  }
  const sorted = history.toSorted(
    (left, right) => left.at.getTime() - right.at.getTime(),
  );
  const before = sorted.filter((entry) => entry.at.getTime() < at.getTime());
  const last = before.at(-1);
  if (last !== undefined) {
    return last.to;
  }
  return sorted[0]?.from ?? COUNT_MODE.numbered;
}

/** 關帳第四項一家店的結果:不用列(月底是編號)/ 通過 / 擋下(必須)/ 警告(只提醒)。 */
export type RenumberCloseStatus = "none" | "pass" | "blocked" | "warning";

/**
 * 關帳第四項「張數店月底補點編號」一家店的結果(第 10 節、16.8 CL1):月底是編號 → 不列;張數或轉換中且
 * 該月最後一次日結前補點過 → 通過;沒補點 → 設「必須」擋下、「只提醒」警告。「必須」看現在的設定
 * (總部改成只提醒後重新檢查就能關)。
 */
export function renumberCloseStatusOf(store: {
  modeAtEnd: CountMode;
  required: boolean;
  done: boolean;
}): RenumberCloseStatus {
  if (!canRenumber(store.modeAtEnd)) {
    return "none";
  }
  if (store.done) {
    return "pass";
  }
  return store.required ? "blocked" : "warning";
}

/**
 * 該月補點過沒有(第 10 節「該月最後一次日結前沒做補點編號」):核准完成的補點編號盤點單,送出時間在這個月、
 * 而且不晚於該月最後一次日結的送出時間(該月沒有日結 → 月底前)。補點跟日結一起送出時兩者同時,算補點過。
 */
export function renumberDoneInPeriodOf(
  renumbers: readonly { submittedAt: Date }[],
  period: { start: Date; end: Date },
  lastDailyCloseAt: Date | null,
): Date | null {
  const cutoff = lastDailyCloseAt ?? period.end;
  const inPeriod = renumbers
    .filter(
      (item) =>
        item.submittedAt.getTime() >= period.start.getTime() &&
        item.submittedAt.getTime() < period.end.getTime() &&
        item.submittedAt.getTime() <= cutoff.getTime(),
    )
    .map((item) => item.submittedAt.getTime());
  return inPeriod.length === 0 ? null : new Date(Math.max(...inPeriod));
}

// ---- 補點編號提醒(第 10 節、16.8 RN4) ----

const isRenumberCycle = (value: string): value is RenumberCycle =>
  (RENUMBER_CYCLES as readonly string[]).includes(value);

/**
 * 一家張數店的補點編號到期時間(第 10 節「補點編號提醒」):依週期從上次補點編號核准起算;從沒補點過 →
 * 進入現在制度的時間(`since`;沒有 = 不提醒)。不設或週期讀不懂 → null。
 */
export function renumberStoreDueAtOf(
  cycle: string,
  record: { lastRenumberAt: Date | null; since: Date | null },
): Date | null {
  if (!isRenumberCycle(cycle) || cycle === "none") {
    return null;
  }
  return record.lastRenumberAt === null
    ? record.since
    : renumberDueAtOf(cycle, record.lastRenumberAt);
}

// ---- 日結第 ② 步(13.2) ----

/** 日結第 ② 步的補點編號選項:能不能選、預設選它、月底提示。 */
export interface DailyCloseRenumberOption {
  available: boolean;
  suggested: boolean;
  monthEndWarning: boolean;
}

/**
 * 日結第 ② 步「這次做補點編號」(張數店規格 13.2):張數店與轉換中才有;轉換中或補點編號提醒週期到了就預設選它;
 * 設「必須」的店在月底最後一天、這個月還沒補點時,上方提示「本月還沒補點編號,關帳會被擋」。
 */
export function dailyCloseRenumberOptionOf(input: {
  mode: CountMode;
  due: boolean;
  required: boolean;
  isMonthLastDay: boolean;
  renumberedThisMonth: boolean;
}): DailyCloseRenumberOption {
  const available = canRenumber(input.mode);
  return {
    available,
    suggested: available && (input.mode === COUNT_MODE.converting || input.due),
    monthEndWarning:
      available &&
      input.required &&
      input.isMonthLastDay &&
      !input.renumberedThisMonth,
  };
}
