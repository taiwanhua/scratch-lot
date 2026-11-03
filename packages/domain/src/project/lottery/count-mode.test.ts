import { describe, expect, it } from "@jest/globals";

import {
  type CountPickBook,
  type CountPickTicket,
  type MatchTicket,
  countDiffOf,
  countModeOf,
  countSaleLinesProblemOf,
  matchPartnerOf,
  matchPlacesOf,
  pickForCountSale,
  pickForReversal,
  renumberDueOf,
  shortSplitProblemOf,
} from "./count-mode";

const books = new Map<string, CountPickBook>([
  [
    "b-new",
    { firstOpenedAt: new Date("2026-10-10T00:00:00Z"), bookNo: "0056527" },
  ],
  [
    "b-old",
    { firstOpenedAt: new Date("2026-10-01T00:00:00Z"), bookNo: "0056531" },
  ],
  ["b-sealed", { firstOpenedAt: null, bookNo: "0056500" }],
]);

const ticket = (
  id: string,
  bookId: string,
  ticketNo: string,
  extra: Partial<CountPickTicket> = {},
): CountPickTicket => ({
  id,
  bookId,
  ticketNo,
  status: "unsold",
  locked: false,
  ...extra,
});

const sold = (id: string, at: string, extra = {}) => ({
  id,
  status: "sold" as const,
  unmatched: true,
  locked: false,
  soldAt: new Date(at),
  ...extra,
});

const at = (
  id: string,
  bookId: string,
  ticketNo: string,
  place: Pick<MatchTicket, "locationKind" | "cashPointId">,
  extra: Partial<MatchTicket> = {},
): MatchTicket => ({
  ...ticket(id, bookId, ticketNo),
  gameId: "5164",
  ...place,
  ...extra,
});

describe("挑張順序(規格 7.2、14.1 pickForCountSale)", () => {
  const tickets = [
    ticket("n2", "b-new", "002"),
    ticket("n1", "b-new", "001"),
    ticket("o9", "b-old", "009"),
    ticket("o3", "b-old", "003", { status: "sold" }),
    ticket("o4", "b-old", "004", { locked: true }),
    ticket("s1", "b-sealed", "001"),
  ];

  it.each([
    [1, ["o9"]],
    [3, ["o9", "n1", "n2"]],
    [4, ["o9", "n1", "n2", "s1"]],
  ])("挑 %i 張:先拆的本 → 本號 → 張號,跳過已售與鎖定", (n, expected) => {
    expect(pickForCountSale(tickets, books, n)).toEqual({
      ok: true,
      ticketIds: expected,
    });
  });

  it("不夠 → 回只有幾張可挑", () => {
    expect(pickForCountSale(tickets, books, 5)).toEqual({
      ok: false,
      available: 4,
    });
  });

  it("同一個拆本時間依本號", () => {
    const same = new Map<string, CountPickBook>([
      ["x", { firstOpenedAt: new Date(0), bookNo: "0000002" }],
      ["y", { firstOpenedAt: new Date(0), bookNo: "0000001" }],
    ]);
    expect(
      pickForCountSale(
        [ticket("x1", "x", "001"), ticket("y5", "y", "005")],
        same,
        1,
      ),
    ).toEqual({ ok: true, ticketIds: ["y5"] });
  });
});

describe("依張數撤銷挑張(規格 7.3、14.1 pickForReversal)", () => {
  const tickets = [
    sold("a", "2026-10-16T10:00:00Z"),
    sold("b", "2026-10-16T12:00:00Z"),
    sold("c", "2026-10-16T11:00:00Z", { unmatched: false }),
    sold("d", "2026-10-16T13:00:00Z", { locked: true }),
    sold("e", "2026-10-16T09:00:00Z"),
  ];

  it("最近的已售·未對號先挑,跳過已對號與鎖定", () => {
    expect(pickForReversal(tickets, 2)).toEqual({
      ok: true,
      ticketIds: ["b", "a"],
    });
  });

  it("不夠 → 回只有幾張可挑", () => {
    expect(pickForReversal(tickets, 4)).toEqual({ ok: false, available: 3 });
  });
});

describe("對號的配對張(規格 6.2、6.3、14.1 matchPartnerOf)", () => {
  const counterA = { locationKind: "counter" as const, cashPointId: "A" };
  const counterB = { locationKind: "counter" as const, cashPointId: "B" };
  const stock = { locationKind: "stock" as const, cashPointId: null };
  const scanned = { id: "scanned", gameId: "5164" };

  it("先找刷的那台,依挑張順序取第一張(可跨本)", () => {
    const candidates = [
      at("a2", "b-new", "002", counterA),
      at("a9", "b-old", "009", counterA),
      at("b1", "b-old", "001", counterB),
    ];
    expect(
      matchPartnerOf(scanned, candidates, books, [counterA, counterB]),
    ).toBe("a9");
  });

  it("刷的那台沒有 → 找下一個位置", () => {
    const candidates = [at("b1", "b-old", "001", counterB)];
    expect(
      matchPartnerOf(scanned, candidates, books, [counterA, counterB]),
    ).toBe("b1");
  });

  it.each([
    ["別的遊戲", { gameId: "5201" }],
    ["已售", { status: "sold" as const }],
    ["鎖定", { locked: true }],
  ])("%s不能當配對張", (_label, extra) => {
    const candidates = [at("a1", "b-old", "001", counterA, extra)];
    expect(matchPartnerOf(scanned, candidates, books, [counterA])).toBeNull();
  });

  it("本沒拆過、在途、刷到的那張自己 → 不算", () => {
    const candidates = [
      at("s1", "b-sealed", "001", stock),
      at("t1", "b-old", "001", {
        locationKind: "in_transit",
        cashPointId: null,
      }),
      at("scanned", "b-old", "002", stock),
    ];
    expect(
      matchPartnerOf(scanned, candidates, books, [
        stock,
        { locationKind: "in_transit", cashPointId: null },
      ]),
    ).toBeNull();
  });

  it("庫存位置不看收銀點", () => {
    const candidates = [at("k1", "b-old", "001", stock)];
    expect(matchPartnerOf(scanned, candidates, books, [stock])).toBe("k1");
  });
});

describe("改盤點制度後分店的制度(規格 9.1、9.2 countModeOf)", () => {
  it.each([
    ["count", 0, "numbered", "count"],
    ["count", 3, "converting", "count"],
    ["numbered", 0, "numbered", "numbered"],
    ["numbered", 3, "count", "converting"],
    ["numbered", 0, "count", "numbered"],
    ["numbered", 2, "converting", "converting"],
    ["numbered", 0, "converting", "numbered"],
  ] as const)(
    "設成 %s、未對號 %i 張、原本 %s → %s",
    (setting, unmatched, current, expected) => {
      expect(countModeOf(setting, unmatched, current)).toBe(expected);
    },
  );
});

describe("補點編號到期(規格 10 renumberDueOf)", () => {
  const last = new Date("2026-01-31T03:00:00Z");

  it.each([
    ["none", null, "2027-01-01T00:00:00Z", false],
    ["monthly", null, "2026-01-01T00:00:00Z", true],
    ["weekly", last, "2026-02-07T02:59:59Z", false],
    ["weekly", last, "2026-02-07T03:00:00Z", true],
    ["biweekly", last, "2026-02-14T03:00:00Z", true],
    ["monthly", last, "2026-02-27T03:00:00Z", false],
    ["monthly", last, "2026-02-28T03:00:00Z", true],
  ] as const)("%s、上次 %s、現在 %s → %s", (cycle, lastAt, now, expected) => {
    expect(renumberDueOf(cycle, lastAt, new Date(now))).toBe(expected);
  });
});

describe("張數盤點的差異(規格 8.2 countDiffOf)", () => {
  it.each([
    [12, 12, { kind: "match", count: 0, actions: [] }],
    [
      12,
      11,
      { kind: "short", count: 1, actions: ["count_sale", "investigate"] },
    ],
    [34, 35, { kind: "over", count: 1, actions: ["mark_abnormal"] }],
  ])("系統 %i、實際 %i", (system, present, expected) => {
    expect(countDiffOf(system, present)).toEqual(expected);
  });

  it.each([
    [3, 2, 1, null],
    [3, 3, 0, null],
    [3, 1, 1, "not_total"],
    [3, -1, 4, "invalid"],
    [3, 1.5, 1.5, "invalid"],
  ])(
    "少 %i 張拆成算售出 %d、待查 %d → %s",
    (short, sale, investigate, expected) => {
      expect(shortSplitProblemOf(short, sale, investigate)).toBe(expected);
    },
  );
});

describe("對號去哪裡找配對張(規格 6.3 matchPlacesOf;16.3 M2)", () => {
  const a = { locationKind: "counter" as const, cashPointId: "a" };
  const b = { locationKind: "counter" as const, cashPointId: "b" };
  const stock = { locationKind: "stock" as const, cashPointId: null };

  it.each([
    ["sale", { scanned: a, system: b }, [a, b]],
    ["sale", { scanned: a, system: a }, [a]],
    ["sale", { scanned: null, system: b }, [b]],
    ["recall", { source: a, scanned: b, system: b }, [a]],
    ["move", { source: b, system: a }, [b]],
    ["transfer", { system: a }, [stock]],
    ["scrap", { system: a }, [stock]],
    ["renumber", { counting: b, system: a }, [b]],
    ["rescan", { counting: stock, system: a }, [stock]],
  ] as const)("%s %o → %o", (operation, facts, expected) => {
    expect(matchPlacesOf(operation, facts)).toEqual(expected);
  });

  it("在途不能當配對的位置", () => {
    expect(
      matchPlacesOf("sale", {
        scanned: a,
        system: { locationKind: "in_transit", cashPointId: null },
      }),
    ).toEqual([a]);
  });
});

describe("依張數賣送出前的檢查(規格 7.2、13.1 countSaleLinesProblemOf;16.4 SA1)", () => {
  const available = new Map([
    ["g1", 3],
    ["g2", 1],
  ]);

  it("每列不超過剩餘 → 可以", () => {
    expect(
      countSaleLinesProblemOf(
        [
          { gameId: "g1", count: 3 },
          { gameId: "g2", count: 1 },
        ],
        available,
      ),
    ).toBeNull();
  });

  it("沒有列 / 同遊戲兩列 / 張數不是正整數 / 超過剩餘 → 不行", () => {
    expect(countSaleLinesProblemOf([], available)).toEqual({ kind: "empty" });
    expect(
      countSaleLinesProblemOf(
        [
          { gameId: "g1", count: 1 },
          { gameId: "g1", count: 1 },
        ],
        available,
      ),
    ).toEqual({ kind: "duplicate_game", gameId: "g1" });
    expect(
      countSaleLinesProblemOf([{ gameId: "g1", count: 0 }], available),
    ).toEqual({ kind: "invalid_count", gameId: "g1" });
    expect(
      countSaleLinesProblemOf([{ gameId: "g1", count: 1.5 }], available),
    ).toEqual({ kind: "invalid_count", gameId: "g1" });
    expect(
      countSaleLinesProblemOf([{ gameId: "g1", count: 4 }], available),
    ).toEqual({ kind: "exceeds", gameId: "g1", available: 3 });
    expect(
      countSaleLinesProblemOf([{ gameId: "g9", count: 1 }], available),
    ).toEqual({ kind: "exceeds", gameId: "g9", available: 0 });
  });
});
