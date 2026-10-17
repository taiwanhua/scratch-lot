import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  type WorkflowFieldsFragment,
  useWorkflowQuery,
  useWorkflowVersionQuery,
  useWorkflowVersionsQuery,
  useWorkflowsQuery,
} from "@repo/graphql";

import { useListSelection } from "@/hooks/base/useListSelection";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

/** 左清單一頁幾個(流程數量不大;api 上限 100)。 */
const PAGE_SIZE = 100;

/** 左清單的搜尋存在網址 `?list=`(REACT-14);選中的流程在 `?detail=<流程 key>`。 */
const listSchema = z
  .object({ keyword: z.string().default("") })
  .default({ keyword: "" });

/**
 * 流程管理頁的資料層:左清單(root = 共用流程;租戶 = 分派來的 + 自己的客製)、選中的流程、
 * 寫入後的精準失效(清單、單個、版本面板、草稿)。
 */
export const useWorkflowsPageData = (
  initialKey: string | null = null,
  /** 網址 `?edit=<流程 key>` 要編輯的流程:有就以它為選中的流程(編輯彈窗編的就是右欄那一個) */
  editKey: string | null = null,
) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [list, setList] = useUrlState("list", listSchema);
  const { keyword } = list;
  const setKeyword = (value: string) => {
    setList({ keyword: value });
  };
  // 網址上的選擇優先;沒有時用導過來時指定的那一個(`initialKey`:從阻擋清單等處要求 fork 的流程)
  const [urlKey, setPickedKey] = useUrlSelectedId();
  const pickedKey = editKey ?? urlKey ?? initialKey;

  const workflows = useWorkflowsQuery(session.client, {
    input: { keyword, page: 1, pageSize: PAGE_SIZE },
  });
  const items: readonly WorkflowFieldsFragment[] =
    workflows.data?.workflows.items ?? [];

  /**
   * 還沒點過任何一個時預設選第一個(不在 effect 內 setState,REACT-06);指定的流程不在清單裡 →
   * 清單查完才退回第一個,剛建立 / fork 的那一個等清單帶回來(`useListSelection`)。
   */
  const selection = useListSelection({
    pickedKey,
    setPickedKey,
    keys: items.map((item) => item.key),
    query: workflows,
  });
  const { selectedKey } = selection;
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
    /** 清單已查完、沒有在等誰(網址上的流程不在清單裡就是不存在或看不到) */
    isListSettled: workflows.isSuccess && !selection.isPending,
    selected,
    selectedKey,
    /** 指定的流程還沒出現在清單上(剛建立 / fork),右欄顯示載入中 */
    isSelectionPending: selection.isPending,
    select: selection.select,
    invalidate,
  };
};
