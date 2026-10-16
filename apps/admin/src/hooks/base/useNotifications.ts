import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  type MarkNotificationsReadMutation,
  type MyNotificationUnreadCountQuery,
  type MyNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationsReadMutation,
  useMyNotificationUnreadCountQuery,
  useMyNotificationsQuery,
} from "@repo/graphql";

import {
  NOTIFICATION_PAGE_SIZE,
  mergeNotificationPages,
  nextNotificationPage,
} from "@/lib/base/notification-pages";

import { useMutationFeedback } from "./useMutationFeedback";
import { useSession } from "./useSession";

export type NotificationItem =
  MyNotificationsQuery["myNotifications"]["items"][number];

type NotificationPages = InfiniteData<MyNotificationsQuery, number>;

/**
 * 通知清單(捲到底載入下一批)的 query key 前綴。`app/base/realtime-signals.ts` 的 `notification`
 * 登記它:收到信號 / 斷線輪詢時重抓「全部」「未讀」兩份清單(只重抓畫面上開著的)。
 * 第一段取自 codegen 的 `getKey`(DATA-02 的 infinite 查詢例外:codegen 沒開 `addInfiniteQuery`)。
 */
export const NOTIFICATION_LIST_KEY = [
  useMyNotificationsQuery.getKey({ input: {} })[0],
  "infinite",
] as const;

const listKey = (unreadOnly: boolean) => [
  ...NOTIFICATION_LIST_KEY,
  { unreadOnly },
];

/** 🔔 上的未讀數(登入後取一次;之後靠 `notification` 信號重抓,斷線時跟 `RealtimeProvider` 輪詢)。 */
export const useNotificationUnreadCount = (): number => {
  const { session } = useSession();
  const query = useMyNotificationUnreadCountQuery(session.client);
  return query.data?.myNotificationUnreadCount.count ?? 0;
};

/**
 * 通知清單:依時間新到舊、一次 20 則,`loadMore` 載入下一批;沒有更多時 `hasNextPage` 為 false。
 * 清單只在通知鈴打開時掛上(`enabled`)。各頁以通知 id 去重(offset 分頁途中有新通知時下一頁會重複一筆)。
 *
 * **「未讀」清單點過通知後不接續 offset**:伺服器端的未讀清單已少了那幾則,接著拿第 N+1 頁會跳過
 * 等量的通知(漏資料)。所以已載入的項目裡有被標成已讀的,下一次載入改成從第 1 頁重抓已載入的各頁
 * (TanStack 的 infinite refetch 依新資料重算頁碼),之後再照常往下接。
 */
export const useNotificationList = (unreadOnly: boolean, enabled: boolean) => {
  const { session } = useSession();
  const query = useInfiniteQuery({
    queryKey: listKey(unreadOnly),
    queryFn: ({ pageParam }) =>
      useMyNotificationsQuery.fetcher(session.client, {
        input: {
          unreadOnly,
          page: pageParam,
          pageSize: NOTIFICATION_PAGE_SIZE,
        },
      })(),
    initialPageParam: 1,
    getNextPageParam: (last) => nextNotificationPage(last.myNotifications),
    enabled,
  });
  const pages = query.data?.pages;
  const items = useMemo(
    () =>
      mergeNotificationPages((pages ?? []).map((page) => page.myNotifications)),
    [pages],
  );
  return {
    items,
    isPending: query.isPending,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage || query.isRefetching,
    loadMore: async () => {
      if (unreadOnly && items.some((item) => item.readAt !== null)) {
        await query.refetch();
        return;
      }
      await query.fetchNextPage();
    },
  };
};

/** 清單快取的一頁:指定的(或全部)未讀通知補上 `readAt`,未讀數換成動作後的值。 */
const markPageRead = (
  page: MyNotificationsQuery,
  ids: readonly string[] | "all",
  readAt: string,
  unreadCount: number,
): MyNotificationsQuery => ({
  myNotifications: {
    ...page.myNotifications,
    unreadCount,
    items: page.myNotifications.items.map((item) =>
      item.readAt === null && (ids === "all" || ids.includes(item.id))
        ? { ...item, readAt }
        : item,
    ),
  },
});

/**
 * 標已讀 / 全部標已讀:寫回 🔔 的未讀數(mutation 回傳動作後的未讀數,不必再查),
 * 清單快取裡對應的通知補上 `readAt`(「未讀」清單留著那一則,下次重抓才拿掉,點的當下不跳動)。失敗跳一則提示。
 */
export const useMarkNotificationsRead = () => {
  const t = useTranslations("admin.notifications");
  const { session } = useSession();
  const queryClient = useQueryClient();
  // 成功不提示(畫面上的圓點與數字就是回饋);失敗跳一則
  const { onError } = useMutationFeedback({
    success: null,
    error: () => t("markReadFailed"),
  });

  const writeBack = useCallback(
    (unreadCount: number, ids: readonly string[] | "all") => {
      queryClient.setQueryData<MyNotificationUnreadCountQuery>(
        useMyNotificationUnreadCountQuery.getKey(),
        { myNotificationUnreadCount: { count: unreadCount } },
      );
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<NotificationPages>(
        { queryKey: NOTIFICATION_LIST_KEY },
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                pages: current.pages.map((page) =>
                  markPageRead(page, ids, readAt, unreadCount),
                ),
              },
      );
    },
    [queryClient],
  );

  const markRead = useMarkNotificationsReadMutation(session.client, {
    onSuccess: (payload: MarkNotificationsReadMutation, variables) => {
      const { ids } = variables.input;
      writeBack(
        payload.markNotificationsRead.unreadCount,
        Array.isArray(ids) ? ids : [ids],
      );
    },
    onError,
  });
  const markAllRead = useMarkAllNotificationsReadMutation(session.client, {
    onSuccess: (payload) => {
      writeBack(payload.markAllNotificationsRead.unreadCount, "all");
    },
    onError,
  });
  return { markRead, markAllRead };
};
