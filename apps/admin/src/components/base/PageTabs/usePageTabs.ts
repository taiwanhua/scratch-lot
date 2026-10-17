import { useMemo } from "react";
import { z } from "zod";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useUrlState } from "@/hooks/base/useUrlState";

import type { PageTabItem } from "./page-tab-item";

/** 網址沒帶、或帶了不存在 / 看不到的分頁 → 空字串,由 `usePageTabs` 退回第一個看得到的分頁。 */
const tabSchema = z.string().default("");

/**
 * PageTabs 的狀態:哪些分頁看得到、目前是哪一頁。
 *
 * - 看得到 = 沒設 `permission`,或 `hasPermission(permission)` 為真
 * - 目前分頁 = 網址上的值(在看得到的分頁裡)→ 否則第一個看得到的分頁。
 *   退回只是推導,不寫回網址:權限還沒載入時網址上的分頁先看不到,載入後就回到它
 */
export const usePageTabs = (items: readonly PageTabItem[], urlKey: string) => {
  const { hasPermission } = usePermissions();
  const [urlValue, setUrlValue] = useUrlState(urlKey, tabSchema);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.permission === undefined || hasPermission(item.permission),
      ),
    [items, hasPermission],
  );

  const current =
    visibleItems.find((item) => item.value === urlValue) ?? visibleItems.at(0);

  return { visibleItems, current, select: setUrlValue };
};
