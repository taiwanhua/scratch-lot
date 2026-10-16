import { describe, expect, it } from "@jest/globals";

import { code128Modules, moduleDots, qrModules } from "./symbol-modules";

describe("code128Modules", () => {
  it("以 Code128 的起始碼開頭、終止碼結尾,只有 0 / 1", () => {
    const modules = code128Modules("TEST-0123456789");

    expect(modules).toMatch(/^[01]+$/);
    // Start A / B / C 的圖樣(11 模組)與終止碼(13 模組)
    expect(["11010000100", "11010010000", "11010011100"]).toContain(
      modules.slice(0, 11),
    );
    expect(modules.endsWith("1100011101011")).toBe(true);
  });

  it("不同內容產生不同條紋", () => {
    expect(code128Modules("A1")).not.toBe(code128Modules("A2"));
  });
});

describe("qrModules", () => {
  it("回傳正方形矩陣,左上角是定位圖樣(第一列前 7 格全黑)", () => {
    const matrix = qrModules("https://example.test/system/printers");

    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix[0]?.slice(0, 7)).toEqual(
      Array.from({ length: 7 }, () => true),
    );
  });
});

describe("moduleDots", () => {
  it("取放得下的最大整數模組寬,至少 1", () => {
    expect(moduleDots(33, 160)).toBe(4);
    expect(moduleDots(500, 352)).toBe(1);
  });
});
