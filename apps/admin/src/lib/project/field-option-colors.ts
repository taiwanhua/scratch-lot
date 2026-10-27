import { type TagPaletteKey, isTagPaletteKey } from "./tag-palettes";

/** api `fieldOptionColors` 的一筆(只取用得到的欄位)。 */
export interface FieldOptionColorItem {
  fieldId: string;
  value: string;
  paletteKey?: string | null;
}

export interface FieldOptionColorIndex {
  /** 選項 id → 色票代號。**顯示顏色一律優先用它**(手上有選項 id 時) */
  byFieldId: ReadonlyMap<string, TagPaletteKey>;
  /**
   * 選項值 → 色票代號:只給「手上只有業務資料存的 `value`、沒有選項 id」的地方用。
   * 同一類別的合併清單可能有兩筆同 `value`(自己這一層與下層組織各加一筆,見底座 field-manager.md
   * 「value 的唯一性」);兩筆顏色不同時這個 `value` 不放進來(當沒有顏色),不猜是哪一筆。
   */
  byValue: ReadonlyMap<string, TagPaletteKey>;
}

/** 把 api 回的清單整理成兩張查表;認不得的代號(色票改版前的舊資料)當沒有顏色。 */
export const indexFieldOptionColors = (
  items: readonly FieldOptionColorItem[],
): FieldOptionColorIndex => {
  const byFieldId = new Map<string, TagPaletteKey>();
  const byValue = new Map<string, TagPaletteKey>();
  const ambiguousValues = new Set<string>();
  for (const { fieldId, value, paletteKey } of items) {
    if (!isTagPaletteKey(paletteKey)) {
      continue;
    }
    byFieldId.set(fieldId, paletteKey);
    const seen = byValue.get(value);
    if (seen !== undefined && seen !== paletteKey) {
      ambiguousValues.add(value);
    }
    byValue.set(value, paletteKey);
  }
  for (const value of ambiguousValues) {
    byValue.delete(value);
  }
  return { byFieldId, byValue };
};
