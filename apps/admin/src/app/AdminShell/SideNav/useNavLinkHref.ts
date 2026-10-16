import { entryHref } from "@/lib/base/route-tabs";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

/**
 * 側欄連結的實際網址(規格 10.1「頁籤記住網址參數」):這一頁的頁籤開著 → 帶回它記下的網址參數
 * (側欄連結視為「切頁籤」,不是「帶空參數打開」);頁籤沒開 → 模組路由本身(預設條件)。
 */
export const useNavLinkHref = (route: string): string =>
  useRouteTabsStore((state) => {
    const entry = state.entries.find((item) => item.route === route);
    return entry === undefined ? route : entryHref(entry);
  });
