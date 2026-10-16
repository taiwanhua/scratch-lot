import { describe, expect, it } from "@jest/globals";

import { countDistinct, formatNumberRanges } from "./number-range";

describe("formatNumberRanges", () => {
  it("連號以 ~ 連起來、不連號以「、」分隔(Figma 範例)", () => {
    expect(
      formatNumberRanges([12, 13, 14, 15, 16, 20], { prefix: "#", digits: 3 }),
    ).toBe("#012~016、#020");
  });

  it("亂序、重複的號碼先排序去重", () => {
    expect(formatNumberRanges([5, 3, 4, 4, 9, 1])).toBe("1、3~5、9");
  });

  it("分隔字可換;空陣列回空字串", () => {
    expect(formatNumberRanges([1, 2, 4], { separator: ", " })).toBe("1~2, 4");
    expect(formatNumberRanges([])).toBe("");
  });

  it("筆數以去重後計算", () => {
    expect(countDistinct([12, 13, 13, 20])).toBe(3);
  });
});
