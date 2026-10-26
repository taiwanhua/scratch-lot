import { describe, expect, it } from "@jest/globals";

import { requiredSkipCountOf } from "./inventory";

describe("更正跳號(規格 7.3)", () => {
  it("改完的跳號張數要等於待標註張數 = 迄號 − 標準張數", () => {
    expect(requiredSkipCountOf(102, 100)).toBe(2);
    expect(requiredSkipCountOf(100, 100)).toBe(0);
  });
});
