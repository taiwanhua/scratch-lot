import { describe, expect, it } from "@jest/globals";

import type { CountPickBook } from "./count-mode";
import {
  type RenumberPresentTicket,
  type RenumberTicket,
  countModeAtOf,
  dailyCloseRenumberOptionOf,
  liveMovePausesOf,
  renumberApprovalOf,
  renumberCloseStatusOf,
  renumberDoneInPeriodOf,
  renumberMatchesOf,
  renumberStartBlockOf,
  renumberStoreDueAtOf,
} from "./renumber";
import {
  STOCKTAKE_DIFF_ACTION,
  stocktakeActionProblemsOf,
  stocktakeActionsOf,
} from "./stocktake";

const books = new Map<string, CountPickBook>([
  ["b1", { firstOpenedAt: new Date("2026-10-01T00:00:00Z"), bookNo: "000100" }],
  ["b2", { firstOpenedAt: new Date("2026-10-05T00:00:00Z"), bookNo: "000200" }],
]);

const ticket = (
  ticketId: string,
  bookId: string,
  place = "A",
  gameId = "g1",
): RenumberTicket => ({
  ticketId,
  ticketNo: ticketId.slice(-3),
  bookId,
  gameId,
  place,
});

const present = (
  ticketId: string,
  status: RenumberPresentTicket["status"],
  bookId = "b1",
  place = "A",
  gameId = "g1",
): RenumberPresentTicket => ({
  ...ticket(ticketId, bookId, place, gameId),
  status,
});

describe("renumberMatchesOf(RN1 自動對號)", () => {
  it("實際在的未對號張配實際不在的未售張,依挑張順序、可跨本", () => {
    const result = renumberMatchesOf(
      [present("b2-071", "sold", "b2"), present("b1-073", "investigating")],
      [ticket("b2-090", "b2"), ticket("b1-040", "b1")],
      books,
    );
    // 先拆的 b1 排前面:b1-073 ↔ b1-040、b2-071 ↔ b2-090
    expect(result.matches).toEqual([
      { ticketId: "b1-073", partnerId: "b1-040", gameId: "g1", place: "A" },
      { ticketId: "b2-071", partnerId: "b2-090", gameId: "g1", place: "A" },
    ]);
    expect(result.leftoverPresent).toEqual([]);
    expect(result.leftoverAbsent).toEqual([]);
  });

  it("只在同遊戲、同位置配;配不完的兩邊各自留下", () => {
    const result = renumberMatchesOf(
      [
        present("b1-071", "sold"),
        present("b1-072", "lost"),
        present("b1-080", "sold", "b1", "B"),
        present("x-001", "sold", "b1", "A", "g2"),
      ],
      [ticket("b1-040", "b1"), ticket("b1-041", "b1", "B", "g1")],
      books,
    );
    expect(result.matches).toEqual([
      { ticketId: "b1-071", partnerId: "b1-040", gameId: "g1", place: "A" },
      { ticketId: "b1-080", partnerId: "b1-041", gameId: "g1", place: "B" },
    ]);
    expect(
      result.leftoverPresent.toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["b1-072", "x-001"]);
    expect(result.leftoverAbsent).toEqual([]);
  });

  it("不是未對號狀態(未售)的張不配;沒有在的未對號張 → 不在的照編號差異", () => {
    const result = renumberMatchesOf(
      [present("b1-010", "unsold")],
      [ticket("b1-040", "b1")],
      books,
    );
    expect(result.matches).toEqual([]);
    expect(result.leftoverPresent).toEqual([]);
    expect(result.leftoverAbsent).toEqual(["b1-040"]);
  });
});

describe("renumberApprovalOf(RN2、SW3)", () => {
  it.each([
    ["converting", "numbered"],
    ["count", "count"],
    ["numbered", "numbered"],
  ] as const)("%s 核准後 → %s,每次都記一筆歷程", (current, mode) => {
    expect(renumberApprovalOf(current)).toEqual({
      mode,
      history: { from: current, to: mode, cause: "renumber_approved" },
    });
  });
});

describe("renumberStartBlockOf(8.5a B4)", () => {
  it("有任何全店重刷 → 擋;只有補點自己的暫停或沒有 → 不擋", () => {
    expect(renumberStartBlockOf([{ gameId: "g1" }])).toBe("rescan");
    expect(renumberStartBlockOf([{ gameId: null }])).toBeNull();
    expect(renumberStartBlockOf([])).toBeNull();
  });
});

describe("liveMovePausesOf", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const pauses = [
    { stocktakeId: "r1", gameId: "g1" },
    { stocktakeId: "p1", gameId: null },
    { stocktakeId: "p2", gameId: null },
    { stocktakeId: "p3", gameId: null },
  ];
  it("全店重刷照舊;補點編號只算登記有效的", () => {
    const live = liveMovePausesOf(
      pauses,
      [
        {
          renumberPauseId: "p1",
          lastActiveAt: new Date("2026-11-04T09:30:00Z"),
        },
        // 1 小時沒操作
        {
          renumberPauseId: "p2",
          lastActiveAt: new Date("2026-11-04T08:30:00Z"),
        },
        // 店長結束
        {
          renumberPauseId: "p3",
          lastActiveAt: new Date("2026-11-04T09:50:00Z"),
          endedAt: new Date("2026-11-04T09:55:00Z"),
        },
      ],
      now,
    );
    expect(live.map((pause) => pause.stocktakeId)).toEqual(["r1", "p1"]);
  });
});

describe("countModeAtOf", () => {
  const history = [
    {
      from: "numbered" as const,
      to: "count" as const,
      at: new Date("2026-09-10T00:00:00Z"),
    },
    {
      from: "count" as const,
      to: "converting" as const,
      at: new Date("2026-10-20T00:00:00Z"),
    },
  ];
  it.each([
    ["2026-09-01T00:00:00Z", "numbered"],
    ["2026-10-01T00:00:00Z", "count"],
    ["2026-11-01T00:00:00Z", "converting"],
  ] as const)("%s → %s", (at, mode) => {
    expect(countModeAtOf(history, "numbered", new Date(at))).toBe(mode);
  });
  it("沒有歷程 → 現在的制度", () => {
    expect(countModeAtOf([], "count", new Date())).toBe("count");
  });
});

describe("renumberCloseStatusOf(CL1)", () => {
  it.each([
    ["numbered", true, false, "none"],
    ["count", true, true, "pass"],
    ["count", true, false, "blocked"],
    ["converting", true, false, "blocked"],
    ["count", false, false, "warning"],
  ] as const)("%s 必須=%s 補點=%s → %s", (modeAtEnd, required, done, out) => {
    expect(renumberCloseStatusOf({ modeAtEnd, required, done })).toBe(out);
  });
});

describe("renumberDoneInPeriodOf", () => {
  const period = {
    start: new Date("2026-10-01T00:00:00Z"),
    end: new Date("2026-11-01T00:00:00Z"),
  };
  it("最後一次日結前(含同時送出)補點 → 有;之後或月外 → 沒有", () => {
    const daily = new Date("2026-10-31T13:00:00Z");
    expect(
      renumberDoneInPeriodOf(
        [{ submittedAt: daily }, { submittedAt: new Date("2026-09-30") }],
        period,
        daily,
      ),
    ).toEqual(daily);
    expect(
      renumberDoneInPeriodOf(
        [{ submittedAt: new Date("2026-10-31T14:00:00Z") }],
        period,
        daily,
      ),
    ).toBeNull();
    expect(
      renumberDoneInPeriodOf(
        [{ submittedAt: new Date("2026-10-31T14:00:00Z") }],
        period,
        null,
      ),
    ).toEqual(new Date("2026-10-31T14:00:00Z"));
  });
});

describe("dailyCloseRenumberOptionOf(13.2 日結第 ② 步)", () => {
  const base = {
    due: false,
    required: false,
    isMonthLastDay: false,
    renumberedThisMonth: false,
  };
  it("編號店沒有這個選項", () => {
    expect(dailyCloseRenumberOptionOf({ ...base, mode: "numbered" })).toEqual({
      available: false,
      suggested: false,
      monthEndWarning: false,
    });
  });
  it("轉換中或到期 → 預設選它", () => {
    expect(
      dailyCloseRenumberOptionOf({ ...base, mode: "converting" }).suggested,
    ).toBe(true);
    expect(
      dailyCloseRenumberOptionOf({ ...base, mode: "count", due: true })
        .suggested,
    ).toBe(true);
    expect(
      dailyCloseRenumberOptionOf({ ...base, mode: "count" }).suggested,
    ).toBe(false);
  });
  it("必須的店月底最後一天還沒補點 → 提示", () => {
    expect(
      dailyCloseRenumberOptionOf({
        ...base,
        mode: "count",
        required: true,
        isMonthLastDay: true,
      }).monthEndWarning,
    ).toBe(true);
    expect(
      dailyCloseRenumberOptionOf({
        ...base,
        mode: "count",
        required: true,
        isMonthLastDay: true,
        renumberedThisMonth: true,
      }).monthEndWarning,
    ).toBe(false);
  });
});

describe("補點編號的 [標跳號](RN3)", () => {
  const diffs = [
    {
      ticketId: "t1",
      ticketNo: "071",
      kind: "missing" as const,
      backfilled: false,
    },
    {
      ticketId: "t2",
      ticketNo: "072",
      kind: "missing" as const,
      backfilled: false,
    },
  ];
  it("有待標註才多一個 [標跳號]", () => {
    expect(stocktakeActionsOf("missing", "cp", { pendingSkip: true })).toEqual([
      "sale_backfill",
      "investigate",
      "skip",
    ]);
    expect(stocktakeActionsOf("missing", "cp")).not.toContain("skip");
    expect(stocktakeActionsOf("extra", "cp", { pendingSkip: true })).toEqual([
      "flag",
    ]);
  });
  it("最多標待標註張數;超過的 → stale", () => {
    const actions = [
      { ticketNo: "071", action: STOCKTAKE_DIFF_ACTION.skip },
      { ticketNo: "072", action: STOCKTAKE_DIFF_ACTION.skip },
    ];
    expect(stocktakeActionProblemsOf(diffs, actions, "cp", 1)).toEqual({
      stale: ["072"],
      unhandled: ["072"],
    });
    expect(stocktakeActionProblemsOf(diffs, actions, "cp", 2)).toEqual({
      stale: [],
      unhandled: [],
    });
    expect(stocktakeActionProblemsOf(diffs, actions, "cp", 0).stale).toEqual([
      "071",
      "072",
    ]);
  });
});

describe("renumberStoreDueAtOf(RN4 補點編號提醒)", () => {
  const last = new Date("2026-10-31T07:00:00Z");
  const since = new Date("2026-10-01T02:00:00Z");
  it.each([
    ["weekly", "2026-11-07T07:00:00.000Z"],
    ["biweekly", "2026-11-14T07:00:00.000Z"],
    ["monthly", "2026-11-30T07:00:00.000Z"],
  ])("%s → %s(月底照那個月最後一天)", (cycle, at) => {
    expect(
      renumberStoreDueAtOf(cycle, {
        lastRenumberAt: last,
        since,
      })?.toISOString(),
    ).toBe(at);
  });
  it("不設、讀不懂 → 不提醒;從沒補點過 → 進入張數店的時間", () => {
    expect(
      renumberStoreDueAtOf("none", { lastRenumberAt: last, since }),
    ).toBeNull();
    expect(
      renumberStoreDueAtOf("daily", { lastRenumberAt: last, since }),
    ).toBeNull();
    expect(
      renumberStoreDueAtOf("monthly", { lastRenumberAt: null, since }),
    ).toEqual(since);
  });
});
