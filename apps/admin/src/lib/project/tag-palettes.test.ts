import { describe, expect, it } from "@jest/globals";

import { contrastRatio } from "@repo/ui/theme";

import { TAG_PALETTE_KEYS, tagPalettes } from "./tag-palettes";

describe("標籤色票 tagPalettes", () => {
  it("十組,與前後端共用的代號清單一一對應", () => {
    expect(Object.keys(tagPalettes)).toEqual([...TAG_PALETTE_KEYS]);
  });

  it.each(
    TAG_PALETTE_KEYS.flatMap((key) =>
      (["light", "dark"] as const).map((mode) => [key, mode] as const),
    ),
  )("%s / %s:文字對底色 ≥ 4.5:1(WCAG AA)", (key, mode) => {
    const { bg, text } = tagPalettes[key][mode];
    expect(contrastRatio(bg, text)).toBeGreaterThanOrEqual(4.5);
  });
});
