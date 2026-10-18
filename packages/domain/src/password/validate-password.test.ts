import { describe, expect, it } from "@jest/globals";

import {
  PASSWORD_MIN_LENGTH,
  isPasswordValid,
  validatePassword,
} from "./validate-password";

describe("密碼規則(8 碼以上、非純數字;前後端同一份)", () => {
  it("最少 8 碼", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("8 碼以上且含非數字字元 → 通過(無違規)", () => {
    expect(validatePassword("abcdefg1")).toEqual([]);
    expect(validatePassword("correct horse battery")).toEqual([]);
    expect(isPasswordValid("abcdefg1")).toBe(true);
  });

  it("7 碼(邊界外)→ too-short;8 碼(邊界)→ 通過", () => {
    expect(validatePassword("abcdef1")).toEqual(["too-short"]);
    expect(validatePassword("abcdef12")).toEqual([]);
  });

  it("純數字(即使夠長)→ digits-only", () => {
    expect(validatePassword("12345678")).toEqual(["digits-only"]);
    expect(isPasswordValid("12345678")).toBe(false);
  });

  it("又短又純數字 → 兩條違規都列出(表單一次提示全部)", () => {
    expect(validatePassword("1234567")).toEqual(["too-short", "digits-only"]);
  });

  it("空字串 → too-short(不算純數字:沒有任何字元)", () => {
    expect(validatePassword("")).toEqual(["too-short"]);
  });

  it("全形數字不算純數字(規則只看 ASCII 0-9)", () => {
    expect(validatePassword("１２３４５６７８")).toEqual([]);
  });
});
