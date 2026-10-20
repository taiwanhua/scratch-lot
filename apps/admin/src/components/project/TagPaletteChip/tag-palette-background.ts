import type { BoxProps } from "@repo/ui/box";

import {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
  tagPalettes,
} from "@/lib/project/tag-palettes";

/** 單一樣式(物件或函式),不是陣列:呼叫端用 `sx={[這個, 其他]}` 疊加。 */
type Sx = Exclude<NonNullable<BoxProps["sx"]>, readonly unknown[]>;

const varName = (key: TagPaletteKey) => `--tag-palette-bg-${key}`;

/**
 * 只收得下一個顏色字串的地方(例:底座時間軸日期欄的 `background`)要用標籤色票底色時:
 * 在外層用 `tagPaletteBackgroundVarsSx` 定義每個色票的底色變數(深色模式以 `theme.applyStyles("dark")`
 * 換成深色那一組,和 `TagPaletteChip` 同一個切換點,STYLE-04),裡面用 `tagPaletteBackground(key)` 取。
 */
export const tagPaletteBackgroundVarsSx: Sx = (theme) => ({
  ...Object.fromEntries(
    TAG_PALETTE_KEYS.map((key) => [varName(key), tagPalettes[key].light.bg]),
  ),
  ...theme.applyStyles(
    "dark",
    Object.fromEntries(
      TAG_PALETTE_KEYS.map((key) => [varName(key), tagPalettes[key].dark.bg]),
    ),
  ),
});

/** 某個色票的底色(要在 `tagPaletteBackgroundVarsSx` 底下用)。 */
export const tagPaletteBackground = (key: TagPaletteKey): string =>
  `var(${varName(key)})`;
