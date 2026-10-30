import { describe, expect, it } from "@jest/globals";

import { TAG_PALETTE_KEYS, isTagPaletteKey } from "./keys";

describe("標籤色票代號", () => {
  it("十組,順序固定(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰)", () => {
    expect(TAG_PALETTE_KEYS).toEqual([
      "blue",
      "cyan",
      "green",
      "lime",
      "yellow",
      "orange",
      "red",
      "pink",
      "purple",
      "grey",
    ]);
  });

  it("只認清單裡的代號;色碼、大小寫不同、非字串都不是", () => {
    expect(isTagPaletteKey("orange")).toBe(true);
    expect(isTagPaletteKey("Orange")).toBe(false);
    expect(isTagPaletteKey("#FFA500")).toBe(false);
    expect(isTagPaletteKey("")).toBe(false);
    expect(isTagPaletteKey(null)).toBe(false);
  });
});
