import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { type SidebarBadgesQuery, useSidebarBadgesQuery } from "@repo/graphql";

import { useSession } from "./useSession";

/**
 * 側欄計數:`sidebarBadges` 一次回傳使用者看得到的所有模組的數字,轉成
 * 「模組 key → 數字」給 `SideNav`。api 只回有 `<模組 key>.view` 的模組,所以不必在前端看權限。
 * 進站取一次;之後靠 `badge:<模組 key>` 信號重抓(`app/base/realtime-signals.ts` 的 `badge:*`),
 * 即時通道斷線時跟 `RealtimeProvider` 每 60 秒重抓,不另外輪詢。
 */
export const useSidebarBadges = (): Readonly<Record<string, number>> => {
  const { session } = useSession();
  const query = useSidebarBadgesQuery(session.client);
  const badges = query.data?.sidebarBadges;
  return useMemo(
    () =>
      Object.fromEntries(
        (badges ?? []).map((badge) => [badge.moduleKey, badge.count]),
      ),
    [badges],
  );
};

/**
 * 某個模組的數字已在別處取得(例:申請中心頁籤的 `applyCenterCounts.myTasks`):寫進側欄快取,
 * 兩邊不會一新一舊。只在那份數字比側欄快取新(`updatedAt` 晚於側欄的 `dataUpdatedAt`)時才寫,
 * 別處快取裡的舊數字不會讓側欄倒退;快取裡沒有這個模組(看不到它)時不寫。
 */
export const useWriteSidebarBadge = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (moduleKey: string, count: number, updatedAt: number) => {
      const key = useSidebarBadgesQuery.getKey();
      const sidebarUpdatedAt = queryClient.getQueryState(key)?.dataUpdatedAt;
      if (sidebarUpdatedAt === undefined || updatedAt <= sidebarUpdatedAt) {
        return;
      }
      queryClient.setQueryData<SidebarBadgesQuery>(key, (current) =>
        current?.sidebarBadges.some((badge) => badge.moduleKey === moduleKey)
          ? {
              sidebarBadges: current.sidebarBadges.map((badge) =>
                badge.moduleKey === moduleKey ? { ...badge, count } : badge,
              ),
            }
          : current,
      );
    },
    [queryClient],
  );
};

/** 側欄計數有變(本人的寫入)時失效重抓;別人造成的變動靠 `badge:<模組 key>` 信號。 */
export const useInvalidateSidebarBadges = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: useSidebarBadgesQuery.getKey(),
    });
  }, [queryClient]);
};
