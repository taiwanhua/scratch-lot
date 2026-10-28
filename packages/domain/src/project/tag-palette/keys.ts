/**
 * 標籤色票(`tagPalettes`)的十個代號,順序即畫面上的排列順序(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰)。
 *
 * 只用於分類標籤(欄位選項顏色、遊戲顏色、人力需求範本顏色、行事曆特殊日顏色),與狀態色
 * `statusPalettes` 分開(FIGMA-13)。前後端共用:api 以它驗證寫入的代號(不在清單 → `VALIDATION_FAILED`),
 * admin 以它對照顏色值(`apps/admin/src/lib/project/tag-palettes.ts`)。
 * 升格時搬到底座(`packages/ui` 的 `tagPalettes`,規格 18.5)。
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

/**
 * 行事曆特殊日可選的色票:灰色以外的九組(灰色是店休 / 不能排的顏色,特殊日不用,避免混淆;規格 14.1)。
 * 前後端共用:api 以它驗證特殊日的 `paletteKey`(必填),admin 行事曆對話框只列這些。
 */
export const SPECIAL_DAY_PALETTE_KEYS = TAG_PALETTE_KEYS.filter(
  (key): key is Exclude<TagPaletteKey, "grey"> => key !== "grey",
);

/** 是不是特殊日可選的色票(必填:null、灰色、清單外的代號都不是)。 */
export function isSpecialDayPaletteKey(
  value: unknown,
): value is Exclude<TagPaletteKey, "grey"> {
  return isTagPaletteKey(value) && value !== "grey";
}
