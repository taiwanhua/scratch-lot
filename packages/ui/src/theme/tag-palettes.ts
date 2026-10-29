import type { CSSObject, Theme } from "@mui/material/styles";

/** 一個模式下的一組顏色:底色與文字色(文字對底色達 WCAG AA,≥ 4.5:1)。 */
export interface TagPaletteSwatch {
  readonly bg: string;
  readonly text: string;
}

export interface TagPalette {
  readonly light: TagPaletteSwatch;
  readonly dark: TagPaletteSwatch;
}

/**
 * 標籤色票(`tagPalettes`,原始設計 token):10 組 × 淺色 / 深色模式的底色與文字色,順序即畫面上的排列順序。
 * 只用於分類標籤(例:欄位選項的顏色),與狀態色 `statusPalettes`(info / success / warning / error)分開(FIGMA-13)。
 * 品牌無關:換品牌不換這組顏色。
 *
 * 代號清單另有一份給 api 驗證寫入用的 `@repo/domain/tag-palette`(ui 不依賴 domain);
 * 兩邊一致由 admin 的 `components/base/TagPaletteChip/tag-palette-keys.test.ts` 把關。
 * 畫面取用:`Tag` 的 `palette`、本檔的 `tagPaletteBackground` / `tagPaletteColorOf`,不在別處寫色碼(STYLE-01)。
 */
export const tagPalettes = {
  blue: {
    light: { bg: "#E3F2FD", text: "#0D47A1" },
    dark: { bg: "#0B2A4A", text: "#90CAF9" },
  },
  cyan: {
    light: { bg: "#E0F7FA", text: "#006064" },
    dark: { bg: "#04363B", text: "#80DEEA" },
  },
  green: {
    light: { bg: "#E8F5E9", text: "#1B5E20" },
    dark: { bg: "#11331A", text: "#A5D6A7" },
  },
  lime: {
    light: { bg: "#F1F8E9", text: "#33691E" },
    dark: { bg: "#26330F", text: "#C5E1A5" },
  },
  yellow: {
    light: { bg: "#FFF8E1", text: "#7A5B00" },
    dark: { bg: "#3A2F05", text: "#FFE082" },
  },
  orange: {
    light: { bg: "#FFF3E0", text: "#9A3B00" },
    dark: { bg: "#3D2306", text: "#FFCC80" },
  },
  red: {
    light: { bg: "#FFEBEE", text: "#B71C1C" },
    dark: { bg: "#3E1214", text: "#EF9A9A" },
  },
  pink: {
    light: { bg: "#FCE4EC", text: "#880E4F" },
    dark: { bg: "#3D1028", text: "#F48FB1" },
  },
  purple: {
    light: { bg: "#F3E5F5", text: "#4A148C" },
    dark: { bg: "#2A1238", text: "#CE93D8" },
  },
  grey: {
    light: { bg: "#F5F5F5", text: "#424242" },
    dark: { bg: "#2E2E2E", text: "#E0E0E0" },
  },
} as const satisfies Record<string, TagPalette>;

/** 色票代號(`tagPalettes` 的 key)。 */
export type TagPaletteKey = keyof typeof tagPalettes;

/** 十個代號,依 `tagPalettes` 的排列順序。 */
export const TAG_PALETTE_ORDER = Object.keys(tagPalettes) as TagPaletteKey[];

/**
 * 一個色票的**代表色**(淺色模式的文字色,飽和度最高的那一個):給只收一個顏色值、自己淡化的元件用
 * (例:`MonthCalendar` 每日資訊的 `background`,以主題 alpha 淡化成格子底色)。
 */
export const tagPaletteColorOf = (key: TagPaletteKey): string =>
  tagPalettes[key].light.text;

const varName = (key: TagPaletteKey) => `--tag-palette-bg-${key}`;

/**
 * 只收得下一個顏色字串的地方(例:`ScheduleTimeline` 日期欄的 `background`)要用標籤色票底色時:
 * 在外層的 `sx` 疊上這一份(定義每個色票的底色 CSS 變數;深色模式以 `theme.applyStyles("dark")`
 * 換成深色那一組,和 `Tag` 的 `palette` 同一個切換點,STYLE-04),裡面用 `tagPaletteBackground(key)` 取。
 */
export const tagPaletteBackgroundVarsSx = (theme: Theme): CSSObject => ({
  ...Object.fromEntries(
    TAG_PALETTE_ORDER.map((key) => [varName(key), tagPalettes[key].light.bg]),
  ),
  ...theme.applyStyles(
    "dark",
    Object.fromEntries(
      TAG_PALETTE_ORDER.map((key) => [varName(key), tagPalettes[key].dark.bg]),
    ),
  ),
});

/** 某個色票的底色(要在 `tagPaletteBackgroundVarsSx` 底下用)。 */
export const tagPaletteBackground = (key: TagPaletteKey): string =>
  `var(${varName(key)})`;
