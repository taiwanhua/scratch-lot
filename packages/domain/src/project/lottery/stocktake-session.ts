import {
  STOCKTAKE_SESSION_IDLE_MS,
  isStocktakeSessionActive,
} from "./count-mode";
import type { StocktakeType } from "./stocktake";

/**
 * 盤點中登記(張數店規格 5.6 `stocktakeSessions[]`、8.5a;兩種店統一做法):按進入盤點(交班、日結、臨時盤點)時
 * 伺服器登記「這些位置盤點中」,別人要盤同一個位置被擋;進度存在登記上,重新整理可 [繼續];1 小時沒操作自動失效
 * (進度保留,本人回來仍可繼續);店長可 [結束這個盤點]。api 讀寫、admin 顯示共用這裡的規則。
 *
 * 位置:單一收銀點 = 那台;全店 = 全部收銀點與庫存(庫存以 `null` 表示)。
 */

/** 登記裡的一筆(api 存在分店那一筆的 `stocktakeSessions[]`)。 */
export interface StocktakeSessionEntry {
  sessionId: string;
  type: StocktakeType;
  /** 登記的位置(收銀點 id;`null` = 庫存,只有全店盤點才有) */
  cashPointIds: readonly (string | null)[];
  by: string;
  startedAt: Date;
  lastActiveAt: Date;
  /** 店長 [結束這個盤點] 的時間;null = 沒被結束 */
  endedAt: Date | null;
}

/** 登記的位置:單一收銀點 = 那台;全店 = 全部收銀點與庫存(`null`)。 */
export function stocktakeSessionPlacesOf(
  scopeCashPointId: string | null,
  allCashPointIds: readonly string[],
): (string | null)[] {
  return scopeCashPointId === null
    ? [...allCashPointIds, null]
    : [scopeCashPointId];
}

/** 這筆登記是全店盤點(含庫存)。 */
export const isWholeStoreSession = (
  entry: Pick<StocktakeSessionEntry, "cashPointIds">,
): boolean => entry.cashPointIds.includes(null);

/** 這筆登記現在還有效:沒被店長結束、最後一次操作後還沒滿 1 小時。 */
export const isSessionLive = (
  entry: Pick<StocktakeSessionEntry, "lastActiveAt" | "endedAt">,
  now: Date,
): boolean =>
  entry.endedAt === null && isStocktakeSessionActive(entry.lastActiveAt, now);

/** 自動失效的時間(最後一次操作 + 1 小時)。 */
export const sessionExpiresAtOf = (
  entry: Pick<StocktakeSessionEntry, "lastActiveAt">,
): Date => new Date(entry.lastActiveAt.getTime() + STOCKTAKE_SESSION_IDLE_MS);

/** 剩幾分鐘自動結束(無條件進位;失效 = 0)。 */
export const sessionMinutesLeftOf = (
  entry: Pick<StocktakeSessionEntry, "lastActiveAt">,
  now: Date,
): number =>
  Math.max(
    0,
    Math.ceil((sessionExpiresAtOf(entry).getTime() - now.getTime()) / 60_000),
  );

const overlaps = (
  left: readonly (string | null)[],
  right: readonly (string | null)[],
): boolean => left.some((place) => right.includes(place));

/** 要登記的盤點。 */
export interface StocktakeSessionRequest {
  type: StocktakeType;
  cashPointIds: readonly (string | null)[];
  by: string;
  /** [繼續] 這一筆(重新整理後接續、失效後回來);沒給 = 新的盤點 */
  sessionId?: string | null;
}

/** 登記的結果:新登記 / 接續這一筆 / 被擋(哪一筆;`own` = 自己另一個進行中的盤點)。 */
export type StocktakeSessionStart =
  | { kind: "new" }
  | { kind: "resume"; sessionId: string }
  | { kind: "blocked"; entry: StocktakeSessionEntry; own: boolean }
  | { kind: "missing" };

/**
 * 能不能登記(張數店規格 8.5a):有效的登記裡,位置重疊的那一筆 → 擋下(別人的 = 「A 台正在由 OO 盤點」;
 * 自己的 = 先 [繼續] 或 [放棄])。[繼續] 一筆:要還在(送出 / 放棄後不在了 → `missing`)、是自己的,
 * 位置跟別人有效的登記不重疊(失效後被別人接手 → 擋下)。
 */
export function stocktakeSessionStartOf(
  entries: readonly StocktakeSessionEntry[],
  request: StocktakeSessionRequest,
  now: Date,
): StocktakeSessionStart {
  const resume =
    request.sessionId == null
      ? null
      : (entries.find(
          (entry) =>
            entry.sessionId === request.sessionId && entry.by === request.by,
        ) ?? null);
  if (request.sessionId != null && resume === null) {
    return { kind: "missing" };
  }
  const places = resume?.cashPointIds ?? request.cashPointIds;
  const blocking = entries.find(
    (entry) =>
      entry.sessionId !== resume?.sessionId &&
      isSessionLive(entry, now) &&
      overlaps(entry.cashPointIds, places),
  );
  if (blocking !== undefined) {
    return {
      kind: "blocked",
      entry: blocking,
      own: blocking.by === request.by,
    };
  }
  return resume === null
    ? { kind: "new" }
    : { kind: "resume", sessionId: resume.sessionId };
}

/**
 * 交班被全店盤點擋下(張數店規格 8.5a,使用者定維持):有效的全店登記 → 那一筆(「全店盤點中(OO,10:05 開始),
 * 請等送出後再交班」);沒有 → null。
 */
export function wholeStoreSessionOf(
  entries: readonly StocktakeSessionEntry[],
  now: Date,
): StocktakeSessionEntry | null {
  return (
    entries.find(
      (entry) => isWholeStoreSession(entry) && isSessionLive(entry, now),
    ) ?? null
  );
}
