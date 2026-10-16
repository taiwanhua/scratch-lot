import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  type FormFieldsFragment,
  useFormQuery,
  useFormSubmissionQuery,
  useFormSubmissionRevisionsQuery,
  useFormSubmissionsQuery,
  useFormUpgradePlanQuery,
  useFormVersionQuery,
  useFormVersionsQuery,
  useFormsQuery,
} from "@repo/graphql";

import { useListSelection } from "@/hooks/base/useListSelection";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

/** 左清單一頁幾張(表單數量不大;api 上限 100)。 */
const PAGE_SIZE = 100;

/** 左清單的搜尋存在網址 `?list=`(REACT-14);選中的表單在 `?detail=<表單 key>`。 */
const listSchema = z
  .object({ keyword: z.string().default("") })
  .default({ keyword: "" });

/**
 * 表單管理頁的資料層:左清單(root 全部共用表單;租戶 = 分派來的 + 自己的客製)、選中的表單、
 * 以及寫入後的精準失效(清單、單張、版本面板、草稿;舊版資料升級會改綁提交,所以提交的清單、單筆、
 * 修訂紀錄與升級計畫也一併失效 —— 各頁各篩選、各筆,取 getKey 第一段當前綴,DATA-04)。
 */
export const useFormsPageData = () => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [list, setList] = useUrlState("list", listSchema);
  const { keyword } = list;
  const setKeyword = (value: string) => {
    setList({ keyword: value });
  };
  const [pickedKey, setPickedKey] = useUrlSelectedId();

  const forms = useFormsQuery(session.client, {
    input: { keyword, page: 1, pageSize: PAGE_SIZE },
  });
  const items: readonly FormFieldsFragment[] = forms.data?.forms.items ?? [];

  /**
   * 還沒點過任何一張時預設選第一張(不在 effect 內 setState,REACT-06);網址上的表單不在清單裡
   * (手改、被收回、已刪除)→ 清單查完才退回第一張,剛建立 / fork 的那一張等清單帶回來(`useListSelection`)。
   */
  const selection = useListSelection({
    pickedKey,
    setPickedKey,
    keys: items.map((form) => form.key),
    query: forms,
  });
  const { selectedKey } = selection;
  const selected = items.find((form) => form.key === selectedKey) ?? null;

  const invalidate = async (formKey: string | null) => {
    await queryClient.invalidateQueries({
      queryKey: useFormsQuery.getKey({ input: { keyword } }).slice(0, 1),
    });
    if (formKey !== null) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: useFormQuery.getKey({ key: formKey }),
        }),
        queryClient.invalidateQueries({
          queryKey: useFormVersionsQuery.getKey({ formKey }),
        }),
        queryClient.invalidateQueries({
          queryKey: useFormVersionQuery.getKey({ formKey }).slice(0, 1),
        }),
        ...[
          useFormSubmissionsQuery.getKey({ input: { moduleKey: "" } }),
          useFormSubmissionQuery.getKey({ id: "" }),
          useFormSubmissionRevisionsQuery.getKey({ id: "" }),
          useFormUpgradePlanQuery.getKey({ formKey, targetVersion: 0 }),
        ].map((key) =>
          queryClient.invalidateQueries({ queryKey: key.slice(0, 1) }),
        ),
      ]);
    }
  };

  return {
    keyword,
    setKeyword,
    forms: items,
    isLoading: forms.isLoading,
    selected,
    selectedKey,
    /** 指定的表單還沒出現在清單上(剛建立 / fork),右欄顯示載入中 */
    isSelectionPending: selection.isPending,
    select: selection.select,
    invalidate,
  };
};
