import { describe, expect, it } from "@jest/globals";

import { compareCellValues } from "./compare-cell-values";

describe("compareCellValues", () => {
  it("文字固定依 zh-Hant 排:中文依筆畫,英文排在中文之後", () => {
    expect(
      ["陳大文", "Amy", "王小明", "李小華"].toSorted(compareCellValues),
    ).toEqual(["王小明", "李小華", "陳大文", "Amy"]);
  });

  it("文字裡的數字依數值排", () => {
    expect(["項目10", "項目2", "項目1"].toSorted(compareCellValues)).toEqual([
      "項目1",
      "項目2",
      "項目10",
    ]);
  });
});
