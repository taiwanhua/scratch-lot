import { create } from "zustand";
import { type PersistStorage, persist } from "zustand/middleware";

import type { ShellModule } from "../../lib/base/module-tree";
import {
  ROUTE_TABS_STORAGE_PREFIX,
  type RouteTabEntry,
  closeEntry,
  closeItemEntries,
  isSameEntries,
  moveEntry,
  readStoredEntries,
  routeTabsStorageKey,
  setEntryItemLabel,
  syncEntries,
  writeStoredEntries,
} from "../../lib/base/route-tabs";

interface RouteTabsPersisted {
  entries: RouteTabEntry[];
}

export interface RouteTabsStoreState extends RouteTabsPersisted {
  /** 綁定登入者:切到 `<專案 slug>-admin-route-tabs:<userId>` 這把 key 並從 sessionStorage 讀回(殼 mount 時呼叫) */
  bind: (userId: string) => void;
  /** 與「可進入路由集合」對齊 + 目前路徑生成 tab(進入路由即呼叫;沒變化不寫回、不通知) */
  sync: (routes: ReadonlyMap<string, ShellModule>, currentPath: string) => void;
  /**
   * 詳情子頁籤的項目名(#428;「模組名 — 項目名」的後半):頁面拿到資料後經 `hooks/base/useRouteTabItemLabel` 呼叫,
   * 同名不寫回、不通知。`route` 是該頁的完整網址(已正規化)。
   */
  setItemLabel: (route: string, itemLabel: string) => void;
  /** 關閉 tab;回傳關閉當前 tab 時要轉去的路由(非當前為 null) */
  close: (route: string, activeRoute: string | null) => string | null;
  /**
   * 刪除成功後關掉同一筆的所有子頁籤(詳情、編輯;`itemRoutes` 以網址前綴比對):經 `hooks/base/useCloseItemTabs` 呼叫。
   * 回傳當前 tab 在其中時要轉去的路由(= `fallbackRoute`,所屬模組的列表頁);否則 null。
   */
  closeItemTabs: (
    itemRoutes: readonly string[],
    activeRoute: string | null,
    fallbackRoute: string,
  ) => string | null;
  move: (fromRoute: string, toRoute: string) => void;
  /**
   * 清空頁籤並刪掉目前這把 key 的存檔(#375:其他分頁登出或換了帳號時,不把上一個人的頁籤留在這個分頁)。
   * 換帳號後由殼重新 `bind(新的 userId)`。
   */
  reset: () => void;
}

/**
 * sessionStorage 存的是紀錄陣列本身(`[{ route, itemLabel? }]`),不是 zustand 的 JSON 封包 — 沿用重構前的格式與 key(docs/branding.md)。
 * `getItem` 讀不到回空陣列(不是 null),讓 `bind` 換使用者時一定以 storage 內容覆蓋記憶體、不會撿到上一個人的頁籤。
 */
const storage: PersistStorage<RouteTabsPersisted> = {
  getItem: (name) => ({ state: { entries: readStoredEntries(name) } }),
  setItem: (name, value) => {
    writeStoredEntries(name, value.state.entries);
  },
  removeItem: (name) => {
    try {
      sessionStorage.removeItem(name);
    } catch {
      // sessionStorage 不可用時本來就沒存,不需處理
    }
  },
};

/**
 * 路由頁籤列的狀態(#67;REACT-02 zustand + persist):進入模組路由即生成 tab、以路由去重;關閉當前 tab 切到相鄰;順序可調;
 * 保留在 sessionStorage(同一分頁重新整理後還在,關掉分頁即清),每個使用者一把 key。
 * 純函式(`syncEntries` / `closeEntry` / `moveEntry`)在 `lib/base/route-tabs.ts`;這裡只負責狀態、寫回與通知。
 */
export const useRouteTabsStore = create<RouteTabsStoreState>()(
  persist(
    (set, get, api) => {
      const commit = (next: RouteTabEntry[]) => {
        if (!isSameEntries(next, get().entries)) {
          set({ entries: next });
        }
      };

      return {
        entries: [],
        bind: (userId) => {
          api.persist.setOptions({ name: routeTabsStorageKey(userId) });
          void api.persist.rehydrate();
        },
        sync: (routes, currentPath) => {
          commit(syncEntries(get().entries, routes, currentPath));
        },
        setItemLabel: (route, itemLabel) => {
          commit(setEntryItemLabel(get().entries, route, itemLabel));
        },
        close: (route, activeRoute) => {
          const result = closeEntry(get().entries, route, activeRoute);
          commit(result.entries);
          return result.navigateTo;
        },
        closeItemTabs: (itemRoutes, activeRoute, fallbackRoute) => {
          const result = closeItemEntries(
            get().entries,
            itemRoutes,
            activeRoute,
            fallbackRoute,
          );
          commit(result.entries);
          return result.navigateTo;
        },
        move: (fromRoute, toRoute) => {
          commit(moveEntry(get().entries, fromRoute, toRoute));
        },
        reset: () => {
          // 先清記憶體再刪存檔:`set` 會經 persist 寫回 storage,順序反過來會把剛刪掉的 key 又寫成空陣列
          set({ entries: [] });
          api.persist.clearStorage();
        },
      };
    },
    {
      // 真正的 key 在 bind 時才知道(帶 userId);建立時不讀 storage
      name: ROUTE_TABS_STORAGE_PREFIX,
      storage,
      partialize: (state) => ({ entries: state.entries }),
      skipHydration: true,
    },
  ),
);
