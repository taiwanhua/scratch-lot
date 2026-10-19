import { useFieldOptionColorsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import {
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

export interface FieldOptionColors {
  /** 選項 id → 色票代號(合併清單裡可能有同 `value` 的兩筆,以 id 為準) */
  byFieldId: ReadonlyMap<string, TagPaletteKey>;
  /** 選項值 → 色票代號(業務資料存的是 `value`,顯示選項的頁面用這個查) */
  byValue: ReadonlyMap<string, TagPaletteKey>;
  isLoading: boolean;
}

/**
 * 一個欄位管理類別(以 key 指定,例崗位 `schedule-position`)各選項的顏色(`fieldOptionColors`,規格 18.5)。
 * 顯示欄位選項的地方都用它:只要登入即可讀,不需要欄位管理的權限。
 * api 回了認不得的代號(色票改版前的舊資料)就當沒有顏色。
 */
export const useFieldOptionColors = (
  categoryKey: string | null,
): FieldOptionColors => {
  const { session } = useSession();
  const query = useFieldOptionColorsQuery(
    session.client,
    { categoryKey: categoryKey ?? "" },
    { enabled: categoryKey !== null },
  );
  const byFieldId = new Map<string, TagPaletteKey>();
  const byValue = new Map<string, TagPaletteKey>();
  for (const item of query.data?.fieldOptionColors.items ?? []) {
    if (isTagPaletteKey(item.paletteKey)) {
      byFieldId.set(item.fieldId, item.paletteKey);
      byValue.set(item.value, item.paletteKey);
    }
  }
  return { byFieldId, byValue, isLoading: query.isLoading };
};
