import { useCallback } from "react";

import { entryHref } from "@/lib/base/route-tabs";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

/**
 * 頁面內「返回列表 / 取消 / 存完離開」的落點:
 * 目標頁的路由頁籤開著 → 帶回它記下的網址參數(列表的篩選、頁碼);沒開 → 路由本身(預設條件)。
 * 與關閉頁籤、刪除後回列表(`closeItemEntries`)同一個規則。
 */
export const useRouteTabHref = (): ((route: string) => string) => {
  const entries = useRouteTabsStore((state) => state.entries);
  return useCallback(
    (route: string) => {
      const entry = entries.find((item) => item.route === route);
      return entry === undefined ? route : entryHref(entry);
    },
    [entries],
  );
};
