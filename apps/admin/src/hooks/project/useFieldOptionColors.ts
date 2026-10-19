import { useFieldOptionColorsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import {
  type FieldOptionColorIndex,
  indexFieldOptionColors,
} from "@/lib/project/field-option-colors";

export interface FieldOptionColors extends FieldOptionColorIndex {
  isLoading: boolean;
}

/**
 * 一個欄位管理類別(以 key 指定,例崗位 `schedule-position`)各選項的顏色(`fieldOptionColors`,規格 18.5)。
 * **其他頁面要顯示選項顏色一律經這個 hook**,不直接呼叫 `useFieldOptionColorsQuery`:
 * 代號驗證、`byFieldId` / `byValue` 的取捨與快取 key 都在這裡,升格成底座 `fields.color` 時只改這一處。
 * 只要登入即可讀,不需要欄位管理的權限;api 回了認不得的代號(色票改版前的舊資料)就當沒有顏色。
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
  const { byFieldId, byValue } = indexFieldOptionColors(
    query.data?.fieldOptionColors.items ?? [],
  );
  return { byFieldId, byValue, isLoading: query.isLoading };
};
