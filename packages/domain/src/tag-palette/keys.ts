/**
 * 標籤色票(`tagPalettes`)的十個代號,順序即畫面上的排列順序(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰)。
 *
 * 只用於分類標籤(例:欄位選項的顏色),與狀態色 `statusPalettes` 分開(FIGMA-13)。
 * 前後端共用:api 以它驗證寫入的代號(不在清單 → `VALIDATION_FAILED`),admin 以它決定色票面板的順序;
 * 顏色值在 `@repo/ui/theme` 的 `tagPalettes`(ui 不依賴本套件,兩邊的代號一致由 admin 的
 * `components/base/TagPaletteChip/tag-palette-keys.test.ts` 把關)。
 */
export const TAG_PALETTE_KEYS = [
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
] as const;

export type TagPaletteKey = (typeof TAG_PALETTE_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(TAG_PALETTE_KEYS);

/** 是不是色票清單裡的代號(大小寫敏感;色碼、空字串都不是)。 */
export function isTagPaletteKey(value: unknown): value is TagPaletteKey {
  return typeof value === "string" && KEY_SET.has(value);
}
