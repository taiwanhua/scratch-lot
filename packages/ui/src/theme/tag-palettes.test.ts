import { describe, expect, it } from "@jest/globals";

import { contrastRatio } from "./brand";
import { defaultBrand } from "./brands/default";
import { createAppTheme } from "./create-theme";
import {
  TAG_PALETTE_ORDER,
  tagPaletteBackground,
  tagPaletteBackgroundVarsSx,
  tagPaletteColorOf,
  tagPalettes,
} from "./tag-palettes";

describe("標籤色票 tagPalettes", () => {
  it("十組,順序固定(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰)", () => {
    expect(TAG_PALETTE_ORDER).toEqual([
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

  it.each(
    TAG_PALETTE_ORDER.flatMap((key) =>
      (["light", "dark"] as const).map((mode) => [key, mode] as const),
    ),
  )("%s / %s:文字對底色 ≥ 4.5:1(WCAG AA)", (key, mode) => {
    const { bg, text } = tagPalettes[key][mode];
    expect(contrastRatio(bg, text)).toBeGreaterThanOrEqual(4.5);
  });

  it("代表色是淺色模式的文字色", () => {
    expect(tagPaletteColorOf("orange")).toBe(tagPalettes.orange.light.text);
  });

  it("底色變數:每組一個 CSS 變數,取用端以 var() 引用", () => {
    const theme = createAppTheme(defaultBrand);
    const vars = tagPaletteBackgroundVarsSx(theme);
    for (const key of TAG_PALETTE_ORDER) {
      expect(vars[`--tag-palette-bg-${key}`]).toBe(tagPalettes[key].light.bg);
    }
    expect(tagPaletteBackground("cyan")).toBe("var(--tag-palette-bg-cyan)");
  });
});
