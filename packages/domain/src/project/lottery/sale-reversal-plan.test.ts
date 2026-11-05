import { describe, expect, it } from "@jest/globals";

import {
  type ReversalPlanTicket,
  saleReversalPlanOf,
  saleReversalReturnPlaceOf,
} from "./sale-reversal-plan";

const at = (time: string) => new Date(`2026-11-05T${time}:00+08:00`);

const ticket = (
  id: string,
  extra: Partial<ReversalPlanTicket> = {},
): ReversalPlanTicket => ({
  id,
  gameId: "game-x",
  inStore: true,
  status: "unsold",
  unmatched: false,
  locked: false,
  locationKind: "counter",
  cashPointId: "cp-a",
  soldAt: null,
  soldSource: null,
  ...extra,
});

/** A 台依張數賣出的已售·未對號(帶著依張數售出)。 */
const countSold = (id: string, time: string, extra = {}) =>
  ticket(id, {
    status: "sold",
    unmatched: true,
    soldAt: at(time),
    soldSource: "count",
    ...extra,
  });

describe("撤銷售出申請送出時的計畫(張數店規格 7.3 第 1、3 點;16.4 U2、U7)", () => {
  const carriers = [
    countSold("c-0900", "09:00"),
    countSold("c-1000", "10:00"),
    countSold("c-b", "10:30", { cashPointId: "cp-b" }),
    countSold("c-y", "10:40", { gameId: "game-y" }),
    countSold("c-locked", "11:00", { locked: true }),
    // 盤點算售出挑到的已售·未對號:依張數挑得到,刷的票不和它對號(不是依張數售出)
    countSold("c-stocktake", "08:00", { soldSource: "stocktake" }),
  ];

  it.each([
    {
      name: "確定張號的已售(刷條碼賣出)→ 照張號",
      scanned: ticket("t", {
        status: "sold",
        soldSource: "scan",
        soldAt: at("09:30"),
      }),
      expected: { byNumber: ["t"], matches: [] },
    },
    {
      name: "未售(客人帶回沒刷就賣的票)→ 和這台同遊戲最近一筆依張數售出對號",
      scanned: ticket("t"),
      expected: {
        byNumber: [],
        matches: [{ scannedId: "t", partnerId: "c-1000" }],
      },
    },
    {
      name: "待查(7.3 例子 #043)→ 一樣先對號",
      scanned: ticket("t", { status: "investigating", unmatched: true }),
      expected: {
        byNumber: [],
        matches: [{ scannedId: "t", partnerId: "c-1000" }],
      },
    },
    {
      name: "已售·未對號 → 一樣先和這台最近一筆依張數售出對號(規則同第 1 點)",
      scanned: countSold("t", "08:30"),
      expected: {
        byNumber: [],
        matches: [{ scannedId: "t", partnerId: "c-1000" }],
      },
    },
  ])("$name", ({ scanned, expected }) => {
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [{ rowId: "r1", ticket: scanned, cashPointId: "cp-a" }],
        carriers,
        countLines: [],
      }),
    ).toEqual({ ok: true, picked: [], ...expected });
  });

  it("兩張刷到的票對到不同的張(同一張只用一次)", () => {
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [
          { rowId: "r1", ticket: ticket("t1"), cashPointId: "cp-a" },
          { rowId: "r1", ticket: ticket("t2"), cashPointId: "cp-a" },
        ],
        carriers,
        countLines: [],
      }),
    ).toMatchObject({
      ok: true,
      matches: [
        { scannedId: "t1", partnerId: "c-1000" },
        { scannedId: "t2", partnerId: "c-0900" },
      ],
    });
  });

  it("這台沒有依張數售出可對號:自己是已售 → 照張號;未售 → count_sale_not_found;沒有收銀點也一樣", () => {
    const none = { matching: true, carriers: [], countLines: [] };
    expect(
      saleReversalPlanOf({
        ...none,
        scans: [
          {
            rowId: "r1",
            ticket: countSold("t", "08:30"),
            cashPointId: "cp-a",
          },
        ],
      }),
    ).toEqual({ ok: true, byNumber: ["t"], matches: [], picked: [] });
    expect(
      saleReversalPlanOf({
        ...none,
        scans: [{ rowId: "r1", ticket: ticket("t"), cashPointId: null }],
        carriers,
      }),
    ).toEqual({
      ok: false,
      problem: { kind: "count_sale_not_found", rowId: "r1", ticketId: "t" },
    });
  });

  it.each([
    ["被別的單鎖住(照現況擋 locked)", { status: "sold", locked: true }],
    ["跳號", { status: "skipped" }],
    ["報廢", { status: "scrapped" }],
    ["在途", { locationKind: "in_transit" }],
    ["不是本店", { status: "sold", inStore: false }],
  ] as const)("%s → not_reversible", (_name, extra) => {
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [
          { rowId: "r1", ticket: ticket("t", extra), cashPointId: "cp-a" },
        ],
        carriers,
        countLines: [],
      }),
    ).toEqual({
      ok: false,
      problem: { kind: "not_reversible", rowId: "r1", ticketId: "t" },
    });
  });

  it("編號店:只收已售、不對號", () => {
    const base = { matching: false, carriers, countLines: [] };
    expect(
      saleReversalPlanOf({
        ...base,
        scans: [{ rowId: "r1", ticket: ticket("t"), cashPointId: "cp-a" }],
      }),
    ).toMatchObject({ ok: false, problem: { kind: "not_reversible" } });
    expect(
      saleReversalPlanOf({
        ...base,
        scans: [
          {
            rowId: "r1",
            ticket: ticket("t", { status: "sold", soldSource: "manual" }),
            cashPointId: null,
          },
        ],
      }),
    ).toEqual({ ok: true, byNumber: ["t"], matches: [], picked: [] });
  });

  it("U7 依遊戲 + 張數:挑這台這個遊戲最近的已售·未對號(跳過鎖定、別台、別的遊戲);不夠 → 告訴還有幾張", () => {
    const line = { rowId: "r2", gameId: "game-x", cashPointId: "cp-a" };
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [],
        carriers,
        countLines: [{ ...line, count: 3 }],
      }),
    ).toEqual({
      ok: true,
      byNumber: [],
      matches: [],
      picked: [{ rowId: "r2", ticketIds: ["c-1000", "c-0900", "c-stocktake"] }],
    });
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [],
        carriers,
        countLines: [{ ...line, count: 4 }],
      }),
    ).toEqual({
      ok: false,
      problem: { kind: "count_exceeds", rowId: "r2", available: 3 },
    });
  });

  it("依張號對號用掉的張不再被依遊戲 + 張數挑到", () => {
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [{ rowId: "r1", ticket: ticket("t"), cashPointId: "cp-a" }],
        carriers,
        countLines: [
          { rowId: "r2", gameId: "game-x", cashPointId: "cp-a", count: 2 },
        ],
      }),
    ).toEqual({
      ok: true,
      byNumber: [],
      matches: [{ scannedId: "t", partnerId: "c-1000" }],
      picked: [{ rowId: "r2", ticketIds: ["c-0900", "c-stocktake"] }],
    });
  });
});

describe("撤銷售出申請核准後張回到哪裡(張數店規格 7.3 第 5 點;16.4 U2、U6)", () => {
  it.each([
    {
      name: "一般申請 → 回售出的收銀點",
      input: {
        saleCashPointId: "cp-a",
        lineCashPointId: null,
        rescanPlace: null,
      },
      expected: { locationKind: "counter", cashPointId: "cp-a" },
    },
    {
      name: "重刷進來(列記的位置 = 重刷刷到的收銀點)→ 回重刷刷到的位置",
      input: {
        saleCashPointId: "cp-a",
        lineCashPointId: "cp-b",
        rescanPlace: { cashPointId: "cp-b" },
      },
      expected: { locationKind: "counter", cashPointId: "cp-b" },
    },
    {
      name: "重刷在庫存刷到 → 回庫存",
      input: {
        saleCashPointId: "cp-a",
        lineCashPointId: null,
        rescanPlace: { cashPointId: null },
      },
      expected: { locationKind: "stock", cashPointId: null },
    },
    {
      name: "重刷記過但這張單不是從那個位置送的 → 照現況回售出的收銀點",
      input: {
        saleCashPointId: "cp-a",
        lineCashPointId: "cp-c",
        rescanPlace: { cashPointId: "cp-b" },
      },
      expected: { locationKind: "counter", cashPointId: "cp-a" },
    },
    {
      name: "沒有售出的收銀點 → 位置不變",
      input: {
        saleCashPointId: null,
        lineCashPointId: null,
        rescanPlace: null,
      },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(saleReversalReturnPlaceOf(input)).toEqual(expected);
  });
});
