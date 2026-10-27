import { create } from "zustand";

export interface AppUpdateState {
  /**
   * 「這個分頁跑的是舊版」的訊號:每回報一次加 1(0 = 還沒發現)。用計數而不是布林,
   * 是讓使用者按 ✕ 關掉提示後,下一次觸發(回前景、換路由、再遇到同樣的錯誤)能再顯示一次。
   */
  signal: number;
  /** 回報舊版:版本檢查不同、lazy chunk 載入失敗、api 回 `GRAPHQL_VALIDATION_FAILED` */
  markOutdated: () => void;
  /** 測試用:歸零(`src/test/setup.ts` 每個測試後呼叫) */
  reset: () => void;
}

/**
 * 新版本提示的訊號(REACT-02:跨元件的用戶端狀態用 zustand)。回報的地方有三處
 * (版本檢查、`vite:preloadError`、QueryClient 的錯誤),顯示只在 `hooks/base/useAppUpdateNotice.ts`。
 */
export const useAppUpdateStore = create<AppUpdateState>()((set) => ({
  signal: 0,
  markOutdated: () => {
    set((state) => ({ signal: state.signal + 1 }));
  },
  reset: () => {
    set({ signal: 0 });
  },
}));
