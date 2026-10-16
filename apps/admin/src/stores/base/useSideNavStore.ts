import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

/**
 * 側欄收合狀態的 localStorage key(登記於 `docs/branding.md`)。
 * 收合是**這台瀏覽器的偏好**,不分使用者也不分組織 —— 換人登入照樣維持,
 * 所以不像路由頁籤那樣以 `:<userId>` 分把鑰匙(#289)。
 *
 * kebab 是 admin 所有儲存鍵的統一寫法(`<slug>-admin-<用途>`,由專案設定的 slug 生成);
 * #289 當初寫成點分隔,#183 第 6 項改齊。
 */
export const SIDE_NAV_STORAGE_KEY = createAdminStorageKeys(
  projectPublic.slug,
).sideNav;

/**
 * #289 時用的點分隔舊 key;只為了把既存的收合狀態搬過來,搬完就刪(見 `createSideNavItemReader`)。
 * 由專案設定指定:只有當年用過舊 key 的專案有值,新專案是 null(完全不讀、不刪任何舊 key)。
 */
export const LEGACY_SIDE_NAV_STORAGE_KEY: string | null =
  projectPublic.compatibility.legacySideNavStorageKey;

interface SideNavPersisted {
  /** 側欄是不是收成 64px 的圖示列 */
  isCollapsed: boolean;
}

export interface SideNavState extends SideNavPersisted {
  toggle: () => void;
}

/**
 * 一次性搬移:新 key 讀不到值時才看舊 key,讀到就寫進新 key 並**立刻刪掉舊的**。
 * 所以每個瀏覽器最多只搬一次,之後這段等於不存在;localStorage 不可用(隱私模式、
 * 被擋)時一律當成沒有值,不讓側欄因此炸掉。`legacyKey` 為 null 時只讀新 key。
 */
export const createSideNavItemReader =
  (legacyKey: string | null) =>
  (name: string): string | null => {
    try {
      const current = localStorage.getItem(name);
      if (current !== null || legacyKey === null) {
        return current;
      }
      const legacy = localStorage.getItem(legacyKey);
      if (legacy === null) {
        return null;
      }
      localStorage.setItem(name, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    } catch {
      return null;
    }
  };

/**
 * 封包格式仍是 `persist` 預設的 `{ state, version }` JSON(#289 就是這個格式),
 * 只在讀取那一步多墊一層搬移;語言與路由頁籤那兩支是為了保住**非 JSON 的**既存格式
 * 才自訂整個 `PersistStorage`(REACT-02 的注意①),這裡不需要。
 */
const sideNavStorage = createJSONStorage<SideNavPersisted>(() => ({
  getItem: createSideNavItemReader(LEGACY_SIDE_NAV_STORAGE_KEY),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // localStorage 不可用時不保留收合狀態,重新整理回到展開態即可
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // 同上:沒存進去就沒東西可刪
    }
  },
}));

/**
 * 側欄收合狀態(#289;REACT-02 第 4 點:跨元件、跨重新整理的用戶端狀態放 zustand + `persist`)。
 */
export const useSideNavStore = create<SideNavState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      toggle: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }));
      },
    }),
    {
      name: SIDE_NAV_STORAGE_KEY,
      storage: sideNavStorage,
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    },
  ),
);
