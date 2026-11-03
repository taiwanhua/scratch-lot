import { describe, expect, it } from "@jest/globals";

import type { CountPickBook, CountPlace, MatchTicket } from "./count-mode";
import {
  type RescanPlaceFacts,
  type RescanTicket,
  canCancelRescan,
  isRescanLive,
  rescanBlocksCountGroup,
  rescanMinutesLeftOf,
  rescanPlaceStartOf,
  rescanPlaceStateOf,
  rescanReminderGamesOf,
  rescanResultOf,
  rescanStartBlockOf,
} from "./rescan";

const X = "game-x";
const Y = "game-y";
const A = "cash-point-a";
const B = "cash-point-b";
const atA: CountPlace = { locationKind: "counter", cashPointId: A };
const stock: CountPlace = { locationKind: "stock", cashPointId: null };

const books = new Map<string, CountPickBook>([
  ["b1", { bookNo: "056528", firstOpenedAt: new Date("2026-11-01T00:00:00Z") }],
  ["b2", { bookNo: "056531", firstOpenedAt: new Date("2026-11-02T00:00:00Z") }],
  ["sealed", { bookNo: "056600", firstOpenedAt: null }],
]);

/** 系統記在 A 台的未售 #no(b1)。 */
const unsoldAt = (
  no: string,
  place: CountPlace = atA,
  bookId = "b1",
): MatchTicket => ({
  id: no,
  bookId,
  ticketNo: no,
  status: "unsold",
  locked: false,
  gameId: X,
  locationKind: place.locationKind,
  cashPointId: place.cashPointId,
});

const scanned = (
  no: string,
  facts: Partial<RescanTicket> = {},
): RescanTicket => ({
  id: no,
  gameId: X,
  bookId: "b1",
  inThisStore: true,
  status: "unsold",
  unmatched: false,
  locked: false,
  locationKind: "counter",
  cashPointId: A,
  ...facts,
});

describe("rescanResultOf:一個位置按「這裡刷完了」的處理(8.4 第 3–5 點、6.3、7.9)", () => {
  it("系統記在這裡、刷到的未售 → 沒問題;沒刷到的 → 待查", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [scanned("038")],
      candidates: [unsoldAt("038"), unsoldAt("039")],
      books,
    });
    expect(result.items).toEqual([
      { ticketId: "038", outcome: "ok", partnerId: null },
    ]);
    expect(result.investigate).toEqual(["039"]);
  });

  it("7.3 的例子:#038 已售·未對號配到 #040、#039 待查·未對號配到 #043(沒刷到的 #040、#043 被挑走,不再記待查)", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [
        scanned("038", { status: "sold", unmatched: true }),
        scanned("039", { status: "investigating", unmatched: true }),
        scanned("041"),
        scanned("042"),
      ],
      candidates: [
        unsoldAt("040"),
        unsoldAt("041"),
        unsoldAt("042"),
        unsoldAt("043"),
      ],
      books,
    });
    expect(result.items.map((item) => [item.ticketId, item.outcome])).toEqual([
      ["038", "matched"],
      ["039", "matched"],
      ["041", "ok"],
      ["042", "ok"],
    ]);
    expect(result.items[0]?.partnerId).toBe("040");
    expect(result.items[1]?.partnerId).toBe("043");
    expect(result.investigate).toEqual([]);
  });

  it("配對不挑已刷到的張;找不到配對:已售 → 記已售但還在、待查 → 尋回(留在這裡)", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [
        scanned("040"),
        scanned("041", { status: "sold", unmatched: true }),
        scanned("042", { status: "investigating", unmatched: true }),
      ],
      candidates: [unsoldAt("040")],
      books,
    });
    expect(result.items.map((item) => item.outcome)).toEqual([
      "ok",
      "sold_here",
      "recovered",
    ]);
    expect(result.investigate).toEqual([]);
  });

  it("確定的已售在這裡 → 記已售但還在(不對號);確定的待查在這裡 → 尋回", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [
        scanned("040", { status: "sold" }),
        scanned("041", { status: "investigating" }),
      ],
      candidates: [unsoldAt("042")],
      books,
    });
    expect(result.items.map((item) => item.outcome)).toEqual([
      "sold_here",
      "recovered",
    ]);
    expect(result.investigate).toEqual(["042"]);
  });

  it("系統位置記錯:記在 B 台的未售在 A 台刷到 → 和 A 台沒刷到的對號;A 台沒有可對號的 → 記到這裡", () => {
    const fromB = scanned("050", { cashPointId: B });
    const matched = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [fromB],
      candidates: [unsoldAt("051")],
      books,
    });
    expect(matched.items).toEqual([
      { ticketId: "050", outcome: "matched", partnerId: "051" },
    ]);
    expect(matched.investigate).toEqual([]);
    const moved = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [fromB],
      candidates: [],
      books,
    });
    expect(moved.items[0]?.outcome).toBe("moved");
  });

  it("記跳號、記報廢、鎖定中、在途 → 不動要先更正;不是這個遊戲、不是本店 → 不處理", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [
        scanned("001", { status: "skipped" }),
        scanned("002", { status: "scrapped" }),
        scanned("003", { locked: true }),
        scanned("004", { locationKind: "in_transit", cashPointId: null }),
        scanned("005", { gameId: Y }),
        scanned("006", { inThisStore: false }),
      ],
      candidates: [unsoldAt("010")],
      books,
    });
    expect(result.items.map((item) => item.outcome)).toEqual([
      "skipped",
      "scrapped",
      "locked",
      "locked",
      "other_game",
      "not_this_store",
    ]);
    expect(result.investigate).toEqual(["010"]);
  });

  it("配對與待查不挑鎖定的、未拆的本、別的遊戲與別的位置;照挑張順序挑", () => {
    const result = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [scanned("020", { status: "sold", unmatched: true })],
      candidates: [
        { ...unsoldAt("030"), locked: true },
        unsoldAt("031", atA, "sealed"),
        { ...unsoldAt("032"), gameId: Y },
        unsoldAt("033", { locationKind: "counter", cashPointId: B }),
        unsoldAt("002", atA, "b2"),
        unsoldAt("099", atA, "b1"),
      ],
      books,
    });
    // b1 先拆 → 先挑 b1 的 #099;b2 的 #002 沒刷到 → 待查
    expect(result.items[0]).toEqual({
      ticketId: "020",
      outcome: "matched",
      partnerId: "099",
    });
    expect(result.investigate).toEqual(["002"]);
  });

  it("庫存:刷到庫存裡未拆的本 → 沒問題;未拆的本在檯面刷到 → 不在範圍", () => {
    const inStock = rescanResultOf({
      gameId: X,
      place: stock,
      scanned: [
        scanned("001", {
          bookId: "sealed",
          locationKind: "stock",
          cashPointId: null,
        }),
      ],
      candidates: [],
      books,
    });
    expect(inStock.items[0]?.outcome).toBe("ok");
    const onCounter = rescanResultOf({
      gameId: X,
      place: atA,
      scanned: [
        scanned("001", {
          bookId: "sealed",
          locationKind: "stock",
          cashPointId: null,
        }),
      ],
      candidates: [],
      books,
    });
    expect(onCounter.items[0]?.outcome).toBe("unopened");
  });
});

describe("位置的狀態與誰能刷(8.4 第 1、6 點)", () => {
  const now = new Date("2026-11-06T10:30:00+08:00");
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000);
  const place = (facts: Partial<RescanPlaceFacts> = {}): RescanPlaceFacts => ({
    scanningBy: null,
    lastScanAt: null,
    doneAt: null,
    scannedCount: 0,
    ...facts,
  });

  it.each([
    ["還沒刷", place(), "pending"],
    [
      "刷到一半",
      place({
        scanningBy: "wang",
        lastScanAt: minutesAgo(10),
        scannedCount: 3,
      }),
      "scanning",
    ],
    [
      "1 小時沒刷 → 釋出(清單保留)",
      place({
        scanningBy: "wang",
        lastScanAt: minutesAgo(60),
        scannedCount: 3,
      }),
      "released",
    ],
    ["刷完", place({ doneAt: minutesAgo(5) }), "done"],
  ] as const)("%s", (_label, facts, state) => {
    expect(rescanPlaceStateOf(facts, now)).toBe(state);
  });

  it("別人刷到一半 → 擋;自己(換裝置)、釋出的 → 可以接著刷;刷完 → 不能再刷", () => {
    const scanning = place({ scanningBy: "wang", lastScanAt: minutesAgo(5) });
    expect(rescanPlaceStartOf(scanning, "lee", now)).toEqual({
      kind: "busy",
      by: "wang",
    });
    expect(rescanPlaceStartOf(scanning, "wang", now)).toEqual({ kind: "ok" });
    expect(
      rescanPlaceStartOf(
        place({ scanningBy: "wang", lastScanAt: minutesAgo(61) }),
        "lee",
        now,
      ),
    ).toEqual({ kind: "ok" });
    expect(
      rescanPlaceStartOf(place({ doneAt: minutesAgo(1) }), "wang", now),
    ).toEqual({ kind: "done" });
  });

  it("整次重刷 1 小時沒動作 → 自動取消;剩幾分鐘無條件進位", () => {
    expect(isRescanLive(minutesAgo(59), now)).toBe(true);
    expect(isRescanLive(minutesAgo(60), now)).toBe(false);
    expect(rescanMinutesLeftOf(minutesAgo(8), now)).toBe(52);
    expect(rescanMinutesLeftOf(minutesAgo(90), now)).toBe(0);
  });
});

describe("互斥、B5、提醒、取消(5.6、8.3、8.5a)", () => {
  it("B3:同一個遊戲同時只能一個重刷;補點編號中不能重刷;別的遊戲可以同時重刷", () => {
    expect(rescanStartBlockOf([], X)).toBeNull();
    expect(rescanStartBlockOf([{ gameId: X }], X)).toBe("rescan");
    expect(rescanStartBlockOf([{ gameId: Y }], X)).toBeNull();
    expect(rescanStartBlockOf([{ gameId: null }], X)).toBe("renumber");
  });

  it("B5:位置 P 的 X 已開始刷、還沒刷完 → 盤點那一組不能數;還沒刷、刷完、別的遊戲、別的位置照常", () => {
    const rescans = [
      {
        gameId: X,
        places: [
          { cashPointId: A, state: "scanning" as const },
          { cashPointId: B, state: "done" as const },
          { cashPointId: null, state: "released" as const },
        ],
      },
    ];
    expect(rescanBlocksCountGroup(rescans, A, X)).toBe(true);
    expect(rescanBlocksCountGroup(rescans, null, X)).toBe(true);
    expect(rescanBlocksCountGroup(rescans, B, X)).toBe(false);
    expect(rescanBlocksCountGroup(rescans, A, Y)).toBe(false);
    expect(
      rescanBlocksCountGroup(
        [{ gameId: X, places: [{ cashPointId: A, state: "pending" }] }],
        A,
        X,
      ),
    ).toBe(false);
  });

  it("8.3:有待查·未對號或標記異常、而且沒有重刷進行中的遊戲才提醒", () => {
    const rows = [
      { gameId: X, investigateCount: 1, flaggedCount: 0 },
      { gameId: Y, investigateCount: 0, flaggedCount: 2 },
      { gameId: "z", investigateCount: 0, flaggedCount: 0 },
    ];
    expect(
      rescanReminderGamesOf(rows, new Set()).map((row) => row.gameId),
    ).toEqual([X, Y]);
    expect(
      rescanReminderGamesOf(rows, new Set([X])).map((row) => row.gameId),
    ).toEqual([Y]);
  });

  it("[取消重刷]:開始重刷的人或店長", () => {
    expect(canCancelRescan("wang", "wang", false)).toBe(true);
    expect(canCancelRescan("wang", "lee", false)).toBe(false);
    expect(canCancelRescan("wang", "lee", true)).toBe(true);
  });
});
