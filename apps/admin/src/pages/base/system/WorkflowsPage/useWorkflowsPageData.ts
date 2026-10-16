import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type WorkflowFieldsFragment,
  useWorkflowQuery,
  useWorkflowVersionQuery,
  useWorkflowVersionsQuery,
  useWorkflowsQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

/** 左清單一頁幾個(流程數量不大;api 上限 100)。 */
const PAGE_SIZE = 100;

/**
 * 流程管理頁的資料層:左清單(root = 共用流程;租戶 = 分派來的 + 自己的客製)、選中的流程、
 * 寫入後的精準失效(清單、單個、版本面板、草稿)。
 */
export const useWorkflowsPageData = (initialKey: string | null = null) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [pickedKey, setPickedKey] = useState<string | null>(initialKey);

  const workflows = useWorkflowsQuery(session.client, {
    input: { keyword, page: 1, pageSize: PAGE_SIZE },
  });
  const items: readonly WorkflowFieldsFragment[] =
    workflows.data?.workflows.items ?? [];

  /** 還沒點過任何一個時預設選第一個(不在 effect 內 setState,REACT-06)。 */
  const selectedKey =
    pickedKey !== null && items.some((item) => item.key === pickedKey)
      ? pickedKey
      : (items.at(0)?.key ?? null);
  const selected = items.find((item) => item.key === selectedKey) ?? null;

  const invalidate = async (workflowKey: string | null) => {
    await queryClient.invalidateQueries({
      queryKey: useWorkflowsQuery.getKey({ input: { keyword } }).slice(0, 1),
    });
    if (workflowKey !== null) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: useWorkflowQuery.getKey({ key: workflowKey }),
        }),
        queryClient.invalidateQueries({
          queryKey: useWorkflowVersionsQuery.getKey({ workflowKey }),
        }),
        queryClient.invalidateQueries({
          queryKey: useWorkflowVersionQuery.getKey({ workflowKey }).slice(0, 1),
        }),
      ]);
    }
  };

  return {
    keyword,
    setKeyword,
    workflows: items,
    isLoading: workflows.isLoading,
    selected,
    selectedKey,
    select: setPickedKey,
    invalidate,
  };
};
