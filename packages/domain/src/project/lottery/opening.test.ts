import { describe, expect, it } from "@jest/globals";

import {
  isOpeningBookOpened,
  openingPlanProblemOf,
  openingPresoldOf,
  openingSoldPlaceOf,
} from "./opening";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

describe("期初建檔的計畫檢查(期初建檔規格 3.1、3.2)", () => {
  const base = { lastTicketNo: 101, standardTickets: 100 };

  it("拆過的本:導入前已賣出 001–046、跳號 078、其餘 54 張在檯面 A → 可以建", () => {
    const plan = {
      ...base,
      soldTicketNos: range(1, 46),
      skippedTicketNos: ["078"],
      placements: [
        {
          cashPointId: "A",
          ticketNos: range(47, 101).filter((no) => no !== "078"),
        },
      ],
    };
    expect(isOpeningBookOpened(plan)).toBe(true);
    expect(openingPlanProblemOf(plan)).toBeNull();
  });

  it("拆過的本沒標跳號 → skip_count_mismatch", () => {
    expect(
      openingPlanProblemOf({
        ...base,
        soldTicketNos: range(1, 46),
        skippedTicketNos: [],
        placements: [{ cashPointId: "A", ticketNos: range(47, 101) }],
      }),
    ).toBe("skip_count_mismatch");
  });

  it("原封在庫存:可以不標跳號,也可以標滿;只標一部分不行", () => {
    const sealed = {
      lastTicketNo: 102,
      standardTickets: 100,
      soldTicketNos: [] as string[],
    };
    expect(
      openingPlanProblemOf({
        ...sealed,
        skippedTicketNos: [],
        placements: [{ cashPointId: null, ticketNos: range(1, 102) }],
      }),
    ).toBeNull();
    expect(
      openingPlanProblemOf({
        ...sealed,
        skippedTicketNos: ["010", "020"],
        placements: [
          {
            cashPointId: null,
            ticketNos: range(1, 102).filter(
              (no) => no !== "010" && no !== "020",
            ),
          },
        ],
      }),
    ).toBeNull();
    expect(
      openingPlanProblemOf({
        ...sealed,
        skippedTicketNos: ["010"],
        placements: [
          {
            cashPointId: null,
            ticketNos: range(1, 102).filter((no) => no !== "010"),
          },
        ],
      }),
    ).toBe("skip_count_mismatch");
  });

  it("全部標成導入前已賣出 → all_sold(E3)", () => {
    expect(
      openingPlanProblemOf({
        lastTicketNo: 100,
        standardTickets: 100,
        soldTicketNos: range(1, 100),
        skippedTicketNos: [],
        placements: [],
      }),
    ).toBe("all_sold");
  });

  it("張號超出、重複、沒分放", () => {
    const plan = { lastTicketNo: 100, standardTickets: 100 };
    expect(
      openingPlanProblemOf({
        ...plan,
        soldTicketNos: ["101"],
        skippedTicketNos: [],
        placements: [{ cashPointId: null, ticketNos: range(1, 100) }],
      }),
    ).toBe("ticket_out_of_range");
    expect(
      openingPlanProblemOf({
        ...plan,
        soldTicketNos: ["001"],
        skippedTicketNos: [],
        placements: [{ cashPointId: null, ticketNos: range(1, 100) }],
      }),
    ).toBe("ticket_repeated");
    expect(
      openingPlanProblemOf({
        ...plan,
        soldTicketNos: range(1, 10),
        skippedTicketNos: [],
        placements: [{ cashPointId: "A", ticketNos: range(11, 99) }],
      }),
    ).toBe("unplaced");
  });

  it("期初已售放在張號最小那組的位置;刷到 047 → 001–046 預先標好", () => {
    expect(
      openingSoldPlaceOf([
        { cashPointId: null, ticketNos: range(80, 100) },
        { cashPointId: "A", ticketNos: range(47, 79) },
      ]),
    ).toBe("A");
    expect(openingPresoldOf("047")).toEqual(range(1, 46));
    expect(openingPresoldOf("005", ["002"])).toEqual(["001", "003", "004"]);
    expect(openingPresoldOf("001")).toEqual([]);
  });
});
