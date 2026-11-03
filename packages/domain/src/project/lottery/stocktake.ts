import { COLLATION_LOCALE } from "../../collation/compare-display-name";
import { SALE_REVERSAL_LOCK_REF_TYPE } from "./store-forms";
import type { TicketLocationKind, TicketStatus } from "./ticket-events";

/**
 * 盤點 `lottery_stocktakes` 與盤點確認申請(專案規格 6.8、8.6、7.4;正本 `docs/modules/project/store.md`「盤點」)。
 * api 的比對 / 送出檢查與 admin 的盤點頁共用這裡的規則,不另寫字面值。
 *
 * - **沒有「盤點中」**:盤點過程只在畫面上,[送出] 時才建立盤點單(待核准)
 * - **每本與 `countedAt` 那一刻的系統數字比對**:那一刻的狀態由張數事件倒推(之後的第一筆事件的 `from`)
 * - **不鎖**:兩人可以同時盤;送出時再檢查一次每筆差異,已被其他盤點或操作處理掉的 → 「這幾張已被處理」
 */

/** 盤點確認申請的表單代號(B9b 權限 `store.create-stocktake_confirm`;底線,底座 `FORM_KEY_PATTERN` 不收 `-`)。 */
export const STOCKTAKE_CONFIRM_FORM_KEY = "stocktake_confirm";

/** 盤點確認申請的欄位 key(受管表單 `seeds/project/revisions/stocktake_confirm.r3.seed.ts`)。 */
export const STOCKTAKE_FIELD_KEYS = {
  /** 分店(reference org) */
  branch: "branch",
  /** 盤點範圍:全店 / 收銀點名稱(文字,顯示用) */
  scope: "scope_label",
  /** 彙總(文字,顯示用;盤點頁組好帶入;`summary` 是底座保留字) */
  totals: "totals",
  /** 說明 */
  note: "note",
  /** 盤點內容(系統;`serializeStocktakeDraft` 的 JSON,唯讀時不顯示) */
  draft: "draft",
} as const;

/** 盤點類型:交班 / 日結 / 臨時。 */
export const STOCKTAKE_TYPES = ["shift", "daily", "adhoc"] as const;
export type StocktakeType = (typeof STOCKTAKE_TYPES)[number];

/** 盤點單狀態:待核准 → 已確認 / 已駁回;退回 → 已退回(沒有「盤點中」)。 */
export const STOCKTAKE_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "returned",
] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export const STOCKTAKE_STATUS = {
  pending: "pending",
  confirmed: "confirmed",
  rejected: "rejected",
  returned: "returned",
} as const satisfies Record<string, StocktakeStatus>;

/** 盤點方式:點格子 / 掃描(不用數量)。 */
export const STOCKTAKE_METHODS = ["grid", "scan"] as const;
export type StocktakeMethod = (typeof STOCKTAKE_METHODS)[number];

/** 差異:系統未售、實際不在(`missing`)/ 系統已售、實際還在(`extra`)。 */
export const STOCKTAKE_DIFF_KINDS = ["missing", "extra"] as const;
export type StocktakeDiffKind = (typeof STOCKTAKE_DIFF_KINDS)[number];

/** 差異的處理:補登售出(立即生效)/ 待查 / 標記異常(只做記號)。 */
export const STOCKTAKE_DIFF_ACTIONS = [
  "sale_backfill",
  "investigate",
  "flag",
] as const;
export type StocktakeDiffAction = (typeof STOCKTAKE_DIFF_ACTIONS)[number];

export const STOCKTAKE_DIFF_ACTION = {
  saleBackfill: "sale_backfill",
  investigate: "investigate",
  flag: "flag",
} as const satisfies Record<string, StocktakeDiffAction>;

/** 每種差異可用的處理(規格 6.8):未售不在 → [補登售出] / [待查];已售還在 → [標記異常]。 */
export const STOCKTAKE_ACTIONS_OF: Record<
  StocktakeDiffKind,
  readonly StocktakeDiffAction[]
> = {
  missing: ["sale_backfill", "investigate"],
  extra: ["flag"],
};

/**
 * 盤點「拆過、在庫存的張」那一區的行用的收銀點 id(一本 × 位置;使用者 10/27 要求:拆過的本收回、尋回、
 * 調回的庫存張也要盤)。盤點單紀錄存 `cashPointId: null`。
 */
export const STOCKTAKE_STOCK_LINE = "stock";

/** 這一行盤的是拆過、在庫存的張(不是收銀點檯面)。 */
export const isStocktakeStockLine = (cashPointId: string | null): boolean =>
  cashPointId === null || cashPointId === STOCKTAKE_STOCK_LINE;

/** 庫存的張不在:只能 [待查](庫存的張不能賣,沒有 [補登售出]);庫存不會有已售的張。 */
export const STOCKTAKE_STOCK_ACTIONS_OF: Record<
  StocktakeDiffKind,
  readonly StocktakeDiffAction[]
> = {
  missing: ["investigate"],
  extra: [],
};

/** 一行的差異可用的處理(檯面 / 庫存)。 */
export function stocktakeActionsOf(
  kind: StocktakeDiffKind,
  cashPointId: string | null,
): readonly StocktakeDiffAction[] {
  return isStocktakeStockLine(cashPointId)
    ? STOCKTAKE_STOCK_ACTIONS_OF[kind]
    : STOCKTAKE_ACTIONS_OF[kind];
}

/** 待查清單的處理:找到了(要刷條碼)/ 確認遺失(`store.confirm-lost`,原因必填)/ 繼續待查。 */
export const STOCKTAKE_LOST_ACTIONS = ["found", "lost", "keep"] as const;
export type StocktakeLostAction = (typeof STOCKTAKE_LOST_ACTIONS)[number];

/** 盤點頁宣告的掃描用途(刷到的碼當作「在」,不會被當成售出)。 */
export const STOCKTAKE_SCAN_PURPOSE = "store-stocktake";

/** 距離上次盤點超過這麼多小時,看板頂部提醒「建議盤點一次」(規格 6.2)。 */
export const STOCKTAKE_REMINDER_HOURS = 24;

/** 盤點確認申請擋下的原因(api 的 `extensions.reason`)。 */
export const STOCKTAKE_REASONS = {
  /** 送出時再檢查:這幾張已被處理(請重新核對) */
  stale: "STOCKTAKE_DIFF_STALE",
  /** 還有差異沒有處理 */
  unhandled: "STOCKTAKE_DIFF_UNHANDLED",
  /** 盤點內容看不懂 / 分店不一致 */
  invalid: "STOCKTAKE_DRAFT_INVALID",
  /** 沒有盤點(或確認遺失)權限 */
  forbidden: "STOCKTAKE_FORBIDDEN",
  /** 盤點確認申請不能作廢(待查錯誤刷到時尋回) */
  voidForbidden: "STOCKTAKE_VOID_FORBIDDEN",
  /** 補登售出:這幾張已被處理(帳本的條件更新失敗;`extensions.tickets`) */
  alreadyProcessed: "STOCKTAKE_ALREADY_PROCESSED",
  /** 補登售出:那個收銀點從來沒有開過班,沒有班可以記 */
  noShift: "STOCKTAKE_NO_SHIFT",
  /** 交班盤點(張數店)沒盤完不能送出(張數店規格 8.1;`extensions.groups`) */
  incomplete: "STOCKTAKE_INCOMPLETE",
  /** [算售出]:這一組可以挑的未售張不夠(`extensions.available`) */
  countSaleUnavailable: "STOCKTAKE_COUNT_SALE_UNAVAILABLE",
  /** 盤點中登記:這個位置正在由別人盤點(`extensions.session`;張數店規格 8.5a) */
  sessionBusy: "STOCKTAKE_SESSION_BUSY",
  /** 盤點中登記:自己已有一個進行中的盤點(先 [繼續] 或 [放棄];`extensions.session`) */
  sessionOwn: "STOCKTAKE_SESSION_OWN",
  /** 盤點中登記已解除(送出、放棄或店長結束)或已失效被別人接手 */
  sessionEnded: "STOCKTAKE_SESSION_ENDED",
  /** 這一組的位置正在全店重刷這個遊戲,刷完再數(張數店規格 8.5a B5;`extensions.groups`) */
  rescanning: "STOCKTAKE_RESCANNING",
} as const;

/** 盤點內容的盤點制度(沒給 = 編號盤點)。 */
export const stocktakeCountModeOf = (
  draft: Pick<StocktakeDraft, "countMode">,
): StocktakeCountMode => draft.countMode ?? "numbered";

/** 盤點內容的張數盤點組(沒給 = 空)。 */
export const stocktakeCountLinesOf = (
  draft: Pick<StocktakeDraft, "countLines">,
): StocktakeDraftCountLine[] => draft.countLines ?? [];

// ---- [上一本] [下一本](張數店規格 13.3) ----

/** 盤點頁 [下一本] / [下一組] 要去哪裡:下一個還沒盤的;都盤完了 → 差異核對。 */
export type StocktakeNextStep =
  { kind: "item"; index: number } | { kind: "review" };

/**
 * 盤點頁的 [上一本] [下一本](張數店規格 13.3;本清單、張數盤點的組、全店重刷的位置清單同一個規則):
 *
 * - [上一本]:第一本時停用(`prev = null`)、不隱藏
 * - [下一本]:把這一本算成已盤後,跳到之後下一本還沒盤的;之後都盤了 → 從頭找還沒盤的;
 *   全部盤完 → `{ kind: "review" }`(按鈕改成 [盤完,前往差異核對])
 *
 * `counted` = 已盤的 key(不用含目前這本)。
 */
export function stocktakeNavOf(
  keys: readonly string[],
  current: number,
  counted: ReadonlySet<string>,
): { prev: number | null; next: StocktakeNextStep } {
  const isOpen = (index: number) =>
    index !== current && !counted.has(keys[index] ?? "");
  const after = keys.findIndex((_, index) => index > current && isOpen(index));
  const before = keys.findIndex((_, index) => index < current && isOpen(index));
  const target = after === -1 ? before : after;
  return {
    prev: current > 0 ? current - 1 : null,
    next: target === -1 ? { kind: "review" } : { kind: "item", index: target },
  };
}

// ---- 盤點內容(畫面狀態;送出時才寫進盤點單) ----

export interface StocktakeDraftDiff {
  ticketNo: string;
  action: StocktakeDiffAction;
  /** 補登售出時這次盤點寫的售出事件 id(送出時核對「是自己補登的」);其他 = null。 */
  eventId?: string | null;
}

/** 一本 × 收銀點(或庫存 `STOCKTAKE_STOCK_LINE`)的盤點。 */
export interface StocktakeDraftLine {
  bookId: string;
  cashPointId: string;
  /** 開始盤這一本的時間(ISO);和那一刻的系統數字比對。 */
  countedAt: string;
  method: StocktakeMethod;
  /** 實際在(點到 / 刷到)的張號。 */
  presentTicketNos: string[];
  diffs: StocktakeDraftDiff[];
}

export interface StocktakeDraftUnopened {
  bookId: string;
  present: boolean;
}

export interface StocktakeDraftLostReview {
  ticketId: string;
  action: StocktakeLostAction;
  reasonKey?: string | null;
  reasonNote?: string | null;
}

/**
 * 盤點單的盤點制度(張數店規格 5.4 `countMode`):編號盤點(檯面逐張)/ 張數盤點(檯面數張數)。
 * 送出時定;轉換中的店仍是張數盤點(9.2)。不叫 `mode`,避開結帳單的 `stocktakeMode`。
 */
export const STOCKTAKE_COUNT_MODES = ["numbered", "count"] as const;
export type StocktakeCountMode = (typeof STOCKTAKE_COUNT_MODES)[number];

/** 盤點的用途(張數店規格 5.4 `purpose`):一般 / 補點編號(T8)/ 全店重刷(T6);交班 / 日結 / 臨時是入口(`type`)。 */
export const STOCKTAKE_PURPOSES = ["normal", "renumber", "rescan"] as const;
export type StocktakePurpose = (typeof STOCKTAKE_PURPOSES)[number];

/**
 * 張數盤點的一組「遊戲 × 收銀點」(張數店規格 5.4 `countLines[]`、8.1、8.2、13.1):開始數這一組的時間、
 * 實際剩幾張(最後一次輸入)、之前的每次輸入(`recounts`,[重數] 前的數字)、差異的處理 ——
 * 少 N 張:[算售出](立即生效,`saleRefIds` = 這次盤點寫的算售出 id)、[待查](核准時才挑張);多出:[標記異常]。
 */
export interface StocktakeDraftCountLine {
  gameId: string;
  cashPointId: string;
  /** 開始數這一組的時間(ISO);和那一刻的系統數字比對(8.1)。 */
  countedAt: string;
  presentCount: number;
  /** 之前的每次輸入(依時間;按 [重數] 時把上一次的數字放進來)。 */
  recounts: number[];
  /** [算售出] 的張數(這次盤點真的寫了幾張)。 */
  saleCount: number;
  /** [算售出] 寫的售出事件的 `refId`(送出時核對「是自己算售出的」)。 */
  saleRefIds: string[];
  /** [待查] 的張數(核准時照挑張順序挑張記待查·未對號)。 */
  investigateCount: number;
  /** 多出時 [標記異常](只做記號,張的狀態不動)。 */
  flagged: boolean;
}

/** 盤點內容(盤點確認申請的 `draft` 欄位 / 交班、日結的結帳確認申請帶來的)。 */
export interface StocktakeDraft {
  version: 1;
  orgId: string;
  /** 只盤一個收銀點(臨時盤點的單一收銀點、交班);全店 = null。 */
  scopeCashPointId: string | null;
  startedAt: string;
  lines: StocktakeDraftLine[];
  unopened: StocktakeDraftUnopened[];
  lostReview: StocktakeDraftLostReview[];
  /** 盤點制度;沒給 = 編號盤點(張數店以前的盤點內容;讀取用 `stocktakeCountModeOf`)。 */
  countMode?: StocktakeCountMode;
  /** 用途;沒給 = 一般。 */
  purpose?: StocktakePurpose;
  /** 張數盤點的「遊戲 × 收銀點」;編號盤點 = 空。 */
  countLines?: StocktakeDraftCountLine[];
}

export type ParsedStocktakeDraft =
  { ok: true; draft: StocktakeDraft } | { ok: false; problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const isTicketNo = (value: unknown): value is string =>
  typeof value === "string" && /^\d{3}$/.test(value);

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const isIso = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function parseList<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: T[] = [];
  for (const raw of value as unknown[]) {
    const item = parse(raw);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return items;
}

function parseDiff(value: unknown): StocktakeDraftDiff | null {
  if (
    !isRecord(value) ||
    !isTicketNo(value.ticketNo) ||
    !isOneOf(STOCKTAKE_DIFF_ACTIONS, value.action)
  ) {
    return null;
  }
  return {
    ticketNo: value.ticketNo,
    action: value.action,
    eventId: optionalText(value.eventId),
  };
}

function parseLine(value: unknown): StocktakeDraftLine | null {
  if (
    !isRecord(value) ||
    !isText(value.bookId) ||
    !isText(value.cashPointId) ||
    !isIso(value.countedAt) ||
    !isOneOf(STOCKTAKE_METHODS, value.method) ||
    !Array.isArray(value.presentTicketNos) ||
    !value.presentTicketNos.every(isTicketNo) ||
    !Array.isArray(value.diffs)
  ) {
    return null;
  }
  const diffs = parseList(value.diffs, parseDiff);
  if (diffs === null) {
    return null;
  }
  return {
    bookId: value.bookId,
    cashPointId: value.cashPointId,
    countedAt: value.countedAt,
    method: value.method,
    presentTicketNos: [...new Set(value.presentTicketNos)].toSorted((a, b) =>
      a.localeCompare(b, COLLATION_LOCALE),
    ),
    diffs,
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function parseCountLine(value: unknown): StocktakeDraftCountLine | null {
  if (
    !isRecord(value) ||
    !isText(value.gameId) ||
    !isText(value.cashPointId) ||
    !isIso(value.countedAt) ||
    !isCount(value.presentCount) ||
    !isCount(value.saleCount) ||
    !isCount(value.investigateCount) ||
    typeof value.flagged !== "boolean" ||
    !Array.isArray(value.recounts) ||
    !value.recounts.every(isCount) ||
    !Array.isArray(value.saleRefIds) ||
    !value.saleRefIds.every(isText)
  ) {
    return null;
  }
  return {
    gameId: value.gameId,
    cashPointId: value.cashPointId,
    countedAt: value.countedAt,
    presentCount: value.presentCount,
    recounts: [...value.recounts],
    saleCount: value.saleCount,
    saleRefIds: [...new Set(value.saleRefIds)],
    investigateCount: value.investigateCount,
    flagged: value.flagged,
  };
}

function parseUnopened(value: unknown): StocktakeDraftUnopened | null {
  return isRecord(value) &&
    isText(value.bookId) &&
    typeof value.present === "boolean"
    ? { bookId: value.bookId, present: value.present }
    : null;
}

function parseLostReview(value: unknown): StocktakeDraftLostReview | null {
  if (
    !isRecord(value) ||
    !isText(value.ticketId) ||
    !isOneOf(STOCKTAKE_LOST_ACTIONS, value.action)
  ) {
    return null;
  }
  return {
    ticketId: value.ticketId,
    action: value.action,
    reasonKey: optionalText(value.reasonKey),
    reasonNote: optionalText(value.reasonNote),
  };
}

/** 讀盤點內容(表單欄位的 JSON 文字或物件);形狀不對 → `{ ok: false }`。 */
export function parseStocktakeDraft(raw: unknown): ParsedStocktakeDraft {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, problem: "not_json" };
    }
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isText(value.orgId) ||
    !isIso(value.startedAt) ||
    !(value.scopeCashPointId === null || isText(value.scopeCashPointId))
  ) {
    return { ok: false, problem: "header" };
  }
  const lines = parseList(value.lines, parseLine);
  const unopened = parseList(value.unopened, parseUnopened);
  const lostReview = parseList(value.lostReview, parseLostReview);
  const countLines =
    value.countLines === undefined
      ? []
      : parseList(value.countLines, parseCountLine);
  const countMode = value.countMode ?? "numbered";
  const purpose = value.purpose ?? "normal";
  if (
    lines === null ||
    unopened === null ||
    lostReview === null ||
    countLines === null
  ) {
    return { ok: false, problem: "lines" };
  }
  if (
    !isOneOf(STOCKTAKE_COUNT_MODES, countMode) ||
    !isOneOf(STOCKTAKE_PURPOSES, purpose)
  ) {
    return { ok: false, problem: "header" };
  }
  return {
    ok: true,
    draft: {
      version: 1,
      orgId: value.orgId,
      scopeCashPointId: value.scopeCashPointId,
      startedAt: value.startedAt,
      lines,
      unopened,
      lostReview,
      // 沒給的欄位照沒給(序列化來回一致);讀的時候用 `stocktakeCountModeOf` 等補預設
      ...(value.countMode === undefined ? {} : { countMode }),
      ...(value.purpose === undefined ? {} : { purpose }),
      ...(value.countLines === undefined ? {} : { countLines }),
    },
  };
}

/** 盤點內容 → 表單欄位的 JSON 文字。 */
export function serializeStocktakeDraft(draft: StocktakeDraft): string {
  return JSON.stringify(draft);
}

// ---- 比對 ----

/** 張的狀態快照(張數事件的 from / to 與目前的張共用的那幾項)。 */
export interface StocktakeTicketSnapshot {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/** 一張在盤點那一刻與之後的事實(比對用)。 */
export interface StocktakeTicketFacts {
  ticketId: string;
  ticketNo: string;
  /** 盤點那一刻:在這個收銀點檯面、未售 / 已售;其他(不在這個收銀點、跳號、待查、被調貨鎖定…)= absent */
  atCount: "unsold" | "sold" | "absent";
  /** 盤點之後這張有異動(有事件) */
  changedSince: boolean;
  /** 之後的異動全是這次盤點自己補登的售出 */
  ownBackfillOnly: boolean;
  /** 撤銷售出申請鎖定中(「撤銷審核中」,不算差異) */
  pendingReversal: boolean;
}

/**
 * 由目前的張與盤點之後的事件(依時間)倒推盤點那一刻:之後的第一筆事件的 `from` = 那一刻的狀態;
 * 沒有之後的事件 = 目前的狀態。被調貨單鎖定的張(調貨中)不比對;撤銷售出申請鎖定 = 撤銷審核中。
 * 庫存那一行(`STOCKTAKE_STOCK_LINE`)比對那一刻在庫存的未售張。
 */
export function stocktakeTicketFactsOf(
  ticket: {
    ticketId: string;
    ticketNo: string;
    current: StocktakeTicketSnapshot;
    lockRefType: string | null;
  },
  eventsAfter: readonly {
    eventId: string;
    at: Date;
    from: StocktakeTicketSnapshot | null;
  }[],
  cashPointId: string,
  countedAt: Date,
  ownBackfillEventIds: ReadonlySet<string>,
): StocktakeTicketFacts {
  const after = eventsAfter
    .filter((event) => event.at.getTime() > countedAt.getTime())
    .toSorted((a, b) => a.at.getTime() - b.at.getTime());
  const first = after.at(0);
  const snapshot = first === undefined ? ticket.current : first.from;
  const onCounter =
    snapshot !== null &&
    (isStocktakeStockLine(cashPointId)
      ? snapshot.locationKind === "stock" && snapshot.status === "unsold"
      : snapshot.locationKind === "counter" &&
        snapshot.cashPointId === cashPointId &&
        (snapshot.status === "unsold" || snapshot.status === "sold"));
  const lockedByTransfer =
    ticket.lockRefType !== null &&
    ticket.lockRefType !== SALE_REVERSAL_LOCK_REF_TYPE;
  return {
    ticketId: ticket.ticketId,
    ticketNo: ticket.ticketNo,
    atCount:
      !onCounter || lockedByTransfer
        ? "absent"
        : (snapshot.status as "unsold" | "sold"),
    changedSince: after.length > 0,
    ownBackfillOnly:
      after.length > 0 &&
      after.every((event) => ownBackfillEventIds.has(event.eventId)),
    pendingReversal: ticket.lockRefType === SALE_REVERSAL_LOCK_REF_TYPE,
  };
}

export interface StocktakeDiff {
  ticketId: string;
  ticketNo: string;
  kind: StocktakeDiffKind;
  /** 這次盤點已補登售出(之後的異動全是自己補登的)。 */
  backfilled: boolean;
}

/**
 * 一本 × 收銀點的差異(規格 6.8、第 17 章第 1、2、6 題):
 *
 * - 盤點那一刻未售、實際不在 → `missing`;那一刻已售、實際還在 → `extra`
 * - 盤點之後這張被別人處理(售出、移櫃、待查…)→ 不再是差異(自己補登的售出照列)
 * - 撤銷審核中的張、不在這個收銀點的張不比對
 */
export function stocktakeDiffsOf(
  facts: readonly StocktakeTicketFacts[],
  presentTicketNos: readonly string[],
): StocktakeDiff[] {
  const present = new Set(presentTicketNos);
  const diffs: StocktakeDiff[] = [];
  for (const item of facts) {
    if (item.pendingReversal || item.atCount === "absent") {
      continue;
    }
    const untouched = !item.changedSince || item.ownBackfillOnly;
    if (!untouched) {
      continue;
    }
    const isHere = present.has(item.ticketNo);
    if (item.atCount === "unsold" && !isHere) {
      diffs.push({
        ticketId: item.ticketId,
        ticketNo: item.ticketNo,
        kind: "missing",
        backfilled: item.changedSince,
      });
    } else if (item.atCount === "sold" && isHere && !item.changedSince) {
      diffs.push({
        ticketId: item.ticketId,
        ticketNo: item.ticketNo,
        kind: "extra",
        backfilled: false,
      });
    }
  }
  return diffs.toSorted((a, b) =>
    a.ticketNo.localeCompare(b.ticketNo, COLLATION_LOCALE),
  );
}

/**
 * 這筆差異能不能這樣處理:補登售出要這次盤點真的補登過;其他處理則不能已補登。`cashPointId` = 這一行的
 * 收銀點(庫存那一行只能待查)。
 */
export function isStocktakeActionValid(
  diff: Pick<StocktakeDiff, "kind" | "backfilled">,
  action: StocktakeDiffAction,
  cashPointId: string | null = "",
): boolean {
  if (!stocktakeActionsOf(diff.kind, cashPointId).includes(action)) {
    return false;
  }
  return (action === "sale_backfill") === diff.backfilled;
}

/**
 * 送出前檢查差異的處理:畫面上的處理對不到目前的差異(已被其他盤點或操作處理掉、或處理方式不合、
 * 按了補登售出卻沒有補登成功)→ `stale`(「這幾張已被處理,請重新核對」);目前的差異沒有處理 → `unhandled`。
 */
export function stocktakeActionProblemsOf(
  diffs: readonly StocktakeDiff[],
  actions: readonly { ticketNo: string; action: StocktakeDiffAction }[],
  cashPointId: string | null = "",
): { stale: string[]; unhandled: string[] } {
  const byNo = new Map(diffs.map((diff) => [diff.ticketNo, diff]));
  const handled = new Set<string>();
  const stale: string[] = [];
  for (const item of actions) {
    const diff = byNo.get(item.ticketNo);
    if (
      diff === undefined ||
      !isStocktakeActionValid(diff, item.action, cashPointId)
    ) {
      stale.push(item.ticketNo);
    } else {
      handled.add(item.ticketNo);
    }
  }
  return {
    stale: stale.toSorted((a, b) => a.localeCompare(b, COLLATION_LOCALE)),
    unhandled: diffs
      .filter((diff) => !handled.has(diff.ticketNo))
      .map((diff) => diff.ticketNo),
  };
}
