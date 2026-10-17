import { useQueryClient } from "@tanstack/react-query";

import type { GraphQLClient } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import type {
  DemoItemResult,
  DemoRows,
  DemoSetEnabledHook,
} from "./demo-module-config";

/**
 * codegen 產的 query hook 的**最小形狀**(共用元件只用到這三件事:呼叫、`enabled`、`getKey`)。
 * 設定物件把自己的 `useDemoItemsOneQuery` 這類 hook 原樣傳進來,型別由呼叫端的泛型對齊。
 */
export interface DemoQueryHook<Variables, Data> {
  (
    client: GraphQLClient,
    variables: Variables,
    options?: { enabled?: boolean; retry?: boolean; gcTime?: number },
  ): { data?: Data; isLoading: boolean; error: unknown };
  getKey: (variables: Variables) => unknown[];
}

/**
 * 清單:呼叫 codegen 的 query hook,取出 `items` / `totalCount`,並附上只失效這一份清單的
 * `invalidate`(DATA-02 / 04)。設定物件的 `useRows` 就是包這一個。
 *
 * 範圍(可見範圍 + 資料範圍規則)由 api 自動套,前端不送任何組織條件。
 */
export const useDemoRows = <Variables, Data, Row>(
  useQuery: DemoQueryHook<Variables, Data>,
  variables: Variables,
  select: (data: Data) => { items: readonly Row[]; totalCount: number },
): DemoRows<Row> => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery(session.client, variables);
  const page = query.data === undefined ? null : select(query.data);

  return {
    rows: page?.items ?? [],
    totalCount: page?.totalCount ?? 0,
    isLoading: query.isLoading,
    invalidate: async () => {
      await queryClient.invalidateQueries({
        queryKey: useQuery.getKey(variables),
      });
    },
  };
};

/**
 * 寫入成功後的快取維護(DATA-04 的兩步)。設定物件的 `useSave` 在 mutation 的 `onSuccess`
 * 呼叫這一個,把回傳的 payload 交出來:
 *
 * (a) 先用 payload `setQueryData` 同 key 的**單筆**查詢 —— 不做這一步的話,儲存完回列表、
 *     馬上再進編輯頁看到的是舊值(快取還在,重取要等一個來回才回來,#372 劇本 5);
 * (b) 再失效**清單**(各頁各篩選:取 codegen key 的第一段當前綴,DATA-02)與單筆。
 *
 * payload 與單筆查詢同形(兩邊同一個 fragment),所以是整份覆寫而不是合併。
 */
export const useDemoItemCache = <Variables, Data>(
  useItemQuery: DemoQueryHook<Variables, Data>,
  listKeyPrefix: readonly unknown[],
): ((variables: Variables, data: Data) => void) => {
  const queryClient = useQueryClient();
  return (variables, data) => {
    const itemKey = useItemQuery.getKey(variables);
    queryClient.setQueryData(itemKey, data);
    void queryClient.invalidateQueries({
      queryKey: listKeyPrefix,
      exact: false,
    });
    void queryClient.invalidateQueries({ queryKey: itemKey });
  };
};

/**
 * 沒給 `useSetEnabled` 的模組用的替身:同形、什麼都不做。
 * hook 不能條件呼叫,所以「有沒有這個選配」不能寫成 `if`,要換成一支恆呼叫的替身。
 */
const noDemoSetEnabled: DemoSetEnabledHook = () => ({
  mutate: () => {
    // 沒有這個選配的模組不會有開關,所以這支永遠不會被呼叫
  },
  isPending: false,
});

/**
 * 切換啟用 / 停用(選配)。設定物件給了就用它的 mutation hook,沒給就用上面的替身 ——
 * 設定物件是模組層常數,「給不給」在執行期不會變,所以 hook 的呼叫順序仍然是穩定的。
 */
export const useDemoSetEnabled = (
  useSetEnabled: DemoSetEnabledHook | undefined,
  options: { onSuccess: () => void; onError: (error: unknown) => void },
): ReturnType<DemoSetEnabledHook> => {
  const { session } = useSession();
  return (useSetEnabled ?? noDemoSetEnabled)(session.client, options);
};

/**
 * 單筆(詳情頁與編輯頁共用)。`retry: false` —— 看不到的資料一律 `NOT_FOUND`,
 * 重試三次只是讓「找不到」晚三秒出現。
 *
 * 新增情境不查(`isEnabled` 為 false),也就不會拿一個空字串的 id 去打 api。
 */
export const useDemoItem = <Variables, Data, Detail>(
  useQuery: DemoQueryHook<Variables, Data>,
  variables: Variables,
  select: (data: Data) => Detail | null,
  isEnabled: boolean,
): DemoItemResult<Detail> => {
  const { session } = useSession();
  const query = useQuery(session.client, variables, {
    enabled: isEnabled,
    retry: false,
  });

  return {
    item: query.data === undefined ? null : select(query.data),
    isLoading: query.isLoading,
    error: query.error,
  };
};
