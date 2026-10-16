import { useState } from "react";

import {
  type ListSelection,
  resolveListSelection,
} from "@/lib/base/list-selection";

export interface UseListSelectionOptions {
  /** 指定的 key(網址 `?detail=`,或導過來時指定的那一個);null = 沒指定 */
  pickedKey: string | null;
  /** 寫入指定的 key(網址) */
  setPickedKey: (key: string) => void;
  /** 清單目前的 key(依序;第一筆是退回的預設) */
  keys: readonly string[];
  /** 清單查詢的狀態(TanStack Query 的同名欄位) */
  query: { isFetching: boolean; dataUpdatedAt: number };
}

/**
 * 主從版面的選中項(規則見 `lib/base/list-selection.ts`):建立 / fork 完馬上選新的那一筆時,
 * 清單還沒把它帶回來 —— 記下「選的當下清單是哪一版」(`dataUpdatedAt`),清單換新版之前都維持指定的 key,
 * 不先退回第一筆;換了新版還是沒有才退回。
 */
export const useListSelection = ({
  pickedKey,
  setPickedKey,
  keys,
  query,
}: UseListSelectionOptions): ListSelection & {
  select: (key: string) => void;
} => {
  const [awaiting, setAwaiting] = useState<{
    key: string;
    since: number;
  } | null>(null);

  const isAwaiting =
    awaiting !== null &&
    awaiting.key === pickedKey &&
    awaiting.since === query.dataUpdatedAt;

  const select = (key: string) => {
    setAwaiting(
      keys.includes(key) ? null : { key, since: query.dataUpdatedAt },
    );
    setPickedKey(key);
  };

  return {
    ...resolveListSelection({
      pickedKey,
      keys,
      isFetching: query.isFetching,
      isAwaiting,
    }),
    select,
  };
};
