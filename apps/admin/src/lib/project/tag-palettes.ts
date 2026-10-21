import type { TagPaletteKey } from "@repo/domain/project/tag-palette";

export {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
  isTagPaletteKey,
} from "@repo/domain/project/tag-palette";

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
 * 標籤色票(`tagPalettes`,規格 18.5):10 組 × 淺色 / 深色模式的底色與文字色。
 * 只用於分類標籤(欄位選項顏色、遊戲顏色、人力需求範本顏色、行事曆特殊日顏色),
 * 與狀態色 `statusPalettes`(info / success / warning / error)分開(FIGMA-13)。
 *
 * 這裡是色票的**定義**(性質同 `packages/ui/src/theme/tokens.ts`),所以直寫色碼;元件一律經
 * `components/project/TagPaletteChip` 取用,不在別處寫色碼(STYLE-01)。
 * 值與 Figma 本機變數集合 `Draft/tagPalettes` 相同(`docs/tmp/figma-base-round/Base-ref.js` 的 `TAG_PALETTES`);
 * 代號清單是前後端共用的 `@repo/domain/project/tag-palette`。
 * 升格時搬到 `packages/ui/src/theme/tokens.ts` 的 `tagPalettes`(規格 18.5)。
 */
export const tagPalettes: Readonly<Record<TagPaletteKey, TagPalette>> = {
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
};

/**
 * 一個色票的**代表色**(淺色模式的文字色,飽和度最高的那一個):給只收一個顏色值、自己淡化的底座元件用
 * (例:`MonthCalendar` 每日資訊的 `background`,以主題 alpha 淡化成格子底色)。
 */
export const tagPaletteColorOf = (key: TagPaletteKey): string =>
  tagPalettes[key].light.text;
