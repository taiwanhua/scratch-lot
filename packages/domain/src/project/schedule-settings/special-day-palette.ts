import {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
  isTagPaletteKey,
} from "../../tag-palette/keys";

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
