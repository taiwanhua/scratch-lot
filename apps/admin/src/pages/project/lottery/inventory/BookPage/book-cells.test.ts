import { describe, expect, it } from "@jest/globals";

import {
  BOOK_SELECTABLE,
  bookCellsOf,
  bookLegendOf,
  markSkipCellsOf,
} from "./book-cells";

const ticket = (
  ticketNo: string,
  overrides: Partial<{
    status: string;
    locked: boolean;
    operable: boolean;
    lockRefType: string | null;
  }> = {},
) => ({
  ticketNo,
  status: "unsold",
  locked: false,
  operable: true,
  locationKind: "stock",
  org: { id: "a", name: "中山店" },
  ...overrides,
});

describe("本的詳情頁格子(使用者 10/27 定案:調貨中格子)", () => {
  it("被調貨單鎖住的未售 → 調貨中,圖例才放「調貨中」;鎖住的已售(撤銷審核中)仍是已售", () => {
    const tickets = [
      ticket("001"),
      ticket("002", { locked: true }),
      ticket("003", { status: "sold", locked: true }),
    ];
    expect(bookCellsOf(tickets).map((cell) => cell.state)).toEqual([
      "unsold",
      "transferring",
      "sold",
    ]);
    expect(bookLegendOf(tickets)).toContain("transferring");
    expect(bookLegendOf([ticket("001")])).not.toContain("transferring");
  });

  it("別店的張(不能操作)鎖住也是其他分店", () => {
    const tickets = [ticket("001", { locked: true, operable: false })];
    expect(bookCellsOf(tickets).map((cell) => cell.state)).toEqual([
      "otherStore",
    ]);
    expect(bookLegendOf(tickets)).not.toContain("transferring");
  });
});

describe("批售的格子(規格 21.5、Figma IN-03-4a / 4b)", () => {
  it("被批售單鎖住的未售 → 批售中、已批售 → 已批售;混在一起時圖例接在後面", () => {
    const tickets = [
      ticket("001"),
      ticket("002", { locked: true, lockRefType: "transfer" }),
      ticket("003", { locked: true, lockRefType: "wholesale" }),
      ticket("004", { status: "wholesaled" }),
    ];
    expect(bookCellsOf(tickets).map((cell) => cell.state)).toEqual([
      "unsold",
      "transferring",
      "wholesaling",
      "wholesaled",
    ]);
    const legend = bookLegendOf(tickets);
    expect(legend).toContain("transferring");
    expect(legend).toContain("wholesaling");
    expect(legend).toContain("wholesaled");
    expect(BOOK_SELECTABLE).not.toContain("wholesaling");
    expect(BOOK_SELECTABLE).not.toContain("wholesaled");
  });

  it("整本都是同一種 → 圖例只放那一種(有跳號加跳號)", () => {
    expect(
      bookLegendOf([
        ticket("001", { locked: true, lockRefType: "wholesale" }),
        ticket("002", { locked: true, lockRefType: "wholesale" }),
      ]),
    ).toEqual(["wholesaling"]);
    expect(
      bookLegendOf([
        ticket("001", { status: "wholesaled" }),
        ticket("002", { status: "skipped" }),
      ]),
    ).toEqual(["wholesaled", "skipped"]);
  });
});

describe("標跳號的格子(使用者 10/27 定案 M1)", () => {
  it("只能選自己範圍內、沒被鎖的未售張;已標的跳號是跳號", () => {
    const tickets = [
      ticket("001"),
      ticket("002", { locked: true }),
      ticket("003", { status: "skipped" }),
      ticket("004", { status: "investigating" }),
      ticket("005", { operable: false }),
    ];
    expect(markSkipCellsOf(tickets).map((cell) => cell.state)).toEqual([
      "unsold",
      "sold",
      "skipped",
      "sold",
      "otherStore",
    ]);
  });
});
