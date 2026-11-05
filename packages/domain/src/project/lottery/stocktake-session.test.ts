import { describe, expect, it } from "@jest/globals";

import {
  type StocktakeSessionEntry,
  isSessionLive,
  sessionMinutesLeftOf,
  stocktakeSessionPlacesOf,
  stocktakeSessionStartOf,
  wholeStoreSessionOf,
} from "./stocktake-session";

const now = new Date("2026-11-05T10:57:00+08:00");
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000);

const entry = (
  sessionId: string,
  by: string,
  cashPointIds: (string | null)[],
  extra: Partial<StocktakeSessionEntry> = {},
): StocktakeSessionEntry => ({
  sessionId,
  type: "adhoc",
  cashPointIds,
  by,
  startedAt: minutesAgo(52),
  lastActiveAt: minutesAgo(8),
  endedAt: null,
  ...extra,
});

describe("盤點中登記(張數店規格 8.5a、16.7 S9)", () => {
  it("位置:單一收銀點 = 那台;全店 = 全部收銀點與庫存", () => {
    expect(stocktakeSessionPlacesOf("A", ["A", "B"])).toEqual(["A"]);
    expect(stocktakeSessionPlacesOf(null, ["A", "B"])).toEqual([
      "A",
      "B",
      null,
    ]);
  });

  it("S9 同位置第二張盤點被擋(別人的 / 自己另一個);不重疊的位置照常登記", () => {
    const entries = [entry("s1", "wang", ["A"])];
    expect(
      stocktakeSessionStartOf(
        entries,
        { type: "shift", cashPointIds: ["A"], by: "li" },
        now,
      ),
    ).toEqual({ kind: "blocked", entry: entries[0], own: false });
    expect(
      stocktakeSessionStartOf(
        entries,
        { type: "adhoc", cashPointIds: ["A", "B", null], by: "wang" },
        now,
      ),
    ).toMatchObject({ kind: "blocked", own: true });
    expect(
      stocktakeSessionStartOf(
        entries,
        { type: "shift", cashPointIds: ["B"], by: "li" },
        now,
      ),
    ).toEqual({ kind: "new" });
  });

  it("S9 1 小時沒操作自動失效(不擋);店長結束的不擋;[繼續] 自己的(失效後也可以)", () => {
    const expired = entry("s1", "wang", ["A"], {
      lastActiveAt: minutesAgo(61),
    });
    const ended = entry("s2", "chen", ["B"], { endedAt: minutesAgo(1) });
    expect(isSessionLive(expired, now)).toBe(false);
    expect(isSessionLive(ended, now)).toBe(false);
    expect(
      stocktakeSessionStartOf(
        [expired, ended],
        { type: "adhoc", cashPointIds: ["A", "B", null], by: "li" },
        now,
      ),
    ).toEqual({ kind: "new" });
    expect(
      stocktakeSessionStartOf(
        [expired],
        { type: "adhoc", cashPointIds: [], by: "wang", sessionId: "s1" },
        now,
      ),
    ).toEqual({ kind: "resume", sessionId: "s1" });
  });

  it("[繼續]:別人的、已解除的 → missing;失效後被別人接手同位置 → 擋下", () => {
    const mine = entry("s1", "wang", ["A"], { lastActiveAt: minutesAgo(61) });
    const other = entry("s2", "li", ["A"]);
    expect(
      stocktakeSessionStartOf(
        [mine],
        { type: "adhoc", cashPointIds: [], by: "li", sessionId: "s1" },
        now,
      ),
    ).toEqual({ kind: "missing" });
    expect(
      stocktakeSessionStartOf(
        [mine, other],
        { type: "adhoc", cashPointIds: [], by: "wang", sessionId: "s1" },
        now,
      ),
    ).toEqual({ kind: "blocked", entry: other, own: false });
  });

  it("剩幾分鐘自動結束(進位);全店盤點中的那一筆(交班被擋)", () => {
    expect(sessionMinutesLeftOf(entry("s1", "wang", ["A"]), now)).toBe(52);
    const whole = entry("s2", "wang", ["A", "B", null]);
    expect(wholeStoreSessionOf([entry("s1", "li", ["A"]), whole], now)).toBe(
      whole,
    );
    expect(
      wholeStoreSessionOf(
        [entry("s2", "wang", ["A", null], { lastActiveAt: minutesAgo(70) })],
        now,
      ),
    ).toBeNull();
  });
});
