import { useLocation, useNavigate } from "react-router";

import { normalizePathname } from "@/lib/base/module-tree";
import { EMPTY_TABS_ROUTE } from "@/lib/base/route-tabs";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

export interface CloseItemTabsTarget {
  /** 那一筆的子頁所屬的隱藏頁路由(詳情、編輯;沒綁的給 null 會略過) */
  pageRoutes: readonly (string | null)[];
  /** 那一筆的識別碼(網址尾端那一段) */
  id: string;
  /** 所屬模組的列表頁;當前頁籤被關掉時轉去這裡(沒綁列表頁 → 首頁) */
  listRoute: string | null;
}

/**
 * 刪除成功後關掉那一筆的所有子頁籤(ADR-0011「頁籤兩種」):詳情、編輯的網址 `<隱藏頁路由>/<id>` 以前綴比對一次關掉;
 * 當前頁籤就是其中之一(在詳情頁刪除)→ 導向所屬模組的列表頁;從列表刪除 → 當前頁籤不變,只收掉背景的子頁籤。
 * 固定欄位模組與表單模組的刪除流程都在成功後呼叫它,不自己導向列表。
 */
export const useCloseItemTabs = (): ((target: CloseItemTabsTarget) => void) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const closeItemTabs = useRouteTabsStore((state) => state.closeItemTabs);

  return ({ pageRoutes, id, listRoute }) => {
    const itemRoutes = pageRoutes
      .filter((route): route is string => route !== null)
      .map((route) => `${route}/${id}`);
    const target = closeItemTabs(
      itemRoutes,
      normalizePathname(pathname),
      listRoute ?? EMPTY_TABS_ROUTE,
    );
    if (target !== null) {
      void navigate(target);
    }
  };
};
