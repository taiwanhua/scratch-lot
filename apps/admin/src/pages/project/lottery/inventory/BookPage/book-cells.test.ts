import { describe, expect, it } from "@jest/globals";

import { daysSince } from "../inventory-config";
import { bookCellsOf, bookLegendOf } from "./book-cells";

const ticket = (
  ticketNo: string,
  overrides: Partial<{
    status: string;
    locked: boolean;
    operable: boolean;
  }> = {},
) => ({
  ticketNo,
  status: "unsold",
  locked: false,
  operable: true,
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

describe("待查·遺失的天數", () => {
  it("登記到現在過了幾天(不滿一天 = 0)", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(daysSince("2026-11-05T12:00:00Z", now)).toBe(5);
    expect(daysSince("2026-11-10T01:00:00Z", now)).toBe(0);
  });
});
