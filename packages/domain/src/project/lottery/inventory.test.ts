import { describe, expect, it } from "@jest/globals";

import { requiredSkipCountOf, skipCorrectionDiffOf } from "./inventory";

describe("更正跳號(規格 7.3)", () => {
  it("改完的跳號張數要等於待標註張數 = 迄號 − 標準張數", () => {
    expect(requiredSkipCountOf(102, 100)).toBe(2);
    expect(requiredSkipCountOf(100, 100)).toBe(0);
  });

  it("前後的差:取消原本的、新標改完才有的", () => {
    expect(skipCorrectionDiffOf(["037", "064"], ["037", "065"])).toEqual({
      unskip: ["064"],
      skip: ["065"],
    });
    expect(skipCorrectionDiffOf(["037"], ["037"])).toEqual({
      unskip: [],
      skip: [],
    });
  });
});
