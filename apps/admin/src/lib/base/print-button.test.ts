import { describe, expect, it } from "@jest/globals";

import { blobToBase64, resolvePrinterId } from "./print-button";

const printer = (id: string, available = true) => ({
  id,
  name: id,
  available,
});

describe("resolvePrinterId(預設:使用處 → 分店預設 → 第一台)", () => {
  const printers = [printer("a"), printer("b"), printer("off", false)];

  it("使用處傳入的預設可選 → 用它", () => {
    expect(resolvePrinterId(printers, "b", "a")).toBe("b");
  });

  it("使用處沒給或不可選 → 分店預設", () => {
    expect(resolvePrinterId(printers, null, "b")).toBe("b");
    expect(resolvePrinterId(printers, "off", "b")).toBe("b");
    expect(resolvePrinterId(printers, "gone", "b")).toBe("b");
  });

  it("分店預設也不可選 → 第一台可選的", () => {
    expect(resolvePrinterId(printers, null, "off")).toBe("a");
    expect(resolvePrinterId(printers, null, null)).toBe("a");
  });

  it("沒有可選的 → null(按鈕灰色)", () => {
    expect(resolvePrinterId([printer("off", false)], "off", "off")).toBeNull();
    expect(resolvePrinterId([], null, null)).toBeNull();
  });
});

describe("blobToBase64", () => {
  it("轉成不帶 data: 前綴的 base64", async () => {
    const blob = new Blob([Uint8Array.of(137, 80, 78, 71)], {
      type: "image/png",
    });
    expect(await blobToBase64(blob)).toBe("iVBORw==");
  });
});
