import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { type ShellModule, matchModuleRoute } from "@/lib/base/module-tree";
import { type RouteTab, entryHref, resolveTabs } from "@/lib/base/route-tabs";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

export interface UseRouteTabsOptions {
  /** 登入者 id:sessionStorage 以它分 key */
  userId: string;
  /** 可進入路由集合(`enterableRouteMap`) */
  routes: ReadonlyMap<string, ShellModule>;
  /** 目前網址(已正規化) */
  currentPath: string;
  /** 目前的網址參數(`location.search`,含 `?`):目前頁籤記下它,切回來時帶回去 */
  currentSearch: string;
}

export interface RouteTabsState {
  tabs: RouteTab[];
  /**
   * 目前網址對應的 tab 路由(= 網址本身;詳情子頁籤含尾端識別碼);
   * 網址不是模組路由(`/`、群組、無權限頁)時為 null,沒有 tab 是選中的
   */
  activeRoute: string | null;
  select: (route: string) => void;
  close: (route: string) => void;
  move: (fromRoute: string, toRoute: string) => void;
}

/**
 * 路由頁籤列的狀態:把 `useRouteTabsStore` 接上目前的使用者、路由集合與網址,並把「關閉當前 tab」的落點轉成導向。
 * 狀態本體在 store(zustand + sessionStorage);登出會卸載殼,換帳號登入時殼重新 mount、重新 `bind` 到新的一把 key。
 */
export const useRouteTabs = ({
  userId,
  routes,
  currentPath,
  currentSearch,
}: UseRouteTabsOptions): RouteTabsState => {
  const navigate = useNavigate();
  const bind = useRouteTabsStore((state) => state.bind);
  const sync = useRouteTabsStore((state) => state.sync);
  const closeTab = useRouteTabsStore((state) => state.close);
  const moveTab = useRouteTabsStore((state) => state.move);

  // 殼 mount 時綁定登入者的 key 並對齊目前路徑:放在 useState 初始化器(只跑一次)而不是 effect,
  // 首次渲染就有 tab、不多閃一幀 — 沿用重構前「store 在 mount 時建立並立刻 sync」的時序。放在讀 entries 之前,快照才一致。
  useState(() => {
    bind(userId);
    sync(routes, currentPath, currentSearch);
    return userId;
  });
  const entries = useRouteTabsStore((state) => state.entries);

  useEffect(() => {
    sync(routes, currentPath, currentSearch);
  }, [sync, routes, currentPath, currentSearch]);

  const tabs = useMemo(() => resolveTabs(entries, routes), [entries, routes]);
  const activeRoute =
    matchModuleRoute(routes, currentPath) === undefined ? null : currentPath;

  /** 切到頁籤 = 回到它記下的「路徑 + 網址參數」 */
  const select = useCallback(
    (route: string) => {
      const entry = entries.find((item) => item.route === route);
      void navigate(entry === undefined ? route : entryHref(entry));
    },
    [entries, navigate],
  );

  const close = useCallback(
    (route: string) => {
      const target = closeTab(route, activeRoute);
      if (target !== null) {
        void navigate(target);
      }
    },
    [closeTab, activeRoute, navigate],
  );

  const move = useCallback(
    (fromRoute: string, toRoute: string) => {
      moveTab(fromRoute, toRoute);
    },
    [moveTab],
  );

  return { tabs, activeRoute, select, close, move };
};
