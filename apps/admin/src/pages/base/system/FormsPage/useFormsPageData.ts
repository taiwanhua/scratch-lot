import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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

import { useSession } from "@/hooks/base/useSession";

/** 左清單一頁幾張(表單數量不大;api 上限 100)。 */
const PAGE_SIZE = 100;

/**
 * 表單管理頁的資料層:左清單(root 全部共用表單;租戶 = 分派來的 + 自己的客製)、選中的表單、
 * 以及寫入後的精準失效(清單、單張、版本面板、草稿;舊版資料升級會改綁提交,所以提交的清單、單筆、
 * 修訂紀錄與升級計畫也一併失效 —— 各頁各篩選、各筆,取 getKey 第一段當前綴,DATA-04)。
 */
export const useFormsPageData = () => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const forms = useFormsQuery(session.client, {
    input: { keyword, page: 1, pageSize: PAGE_SIZE },
  });
  const items: readonly FormFieldsFragment[] = forms.data?.forms.items ?? [];

  /** 還沒點過任何一張時預設選第一張(不在 effect 內 setState,REACT-06)。 */
  const selectedKey = pickedKey ?? items.at(0)?.key ?? null;
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
    select: setPickedKey,
    invalidate,
  };
};
