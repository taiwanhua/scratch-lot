import type { ReactNode } from "react";
import { create } from "zustand";

import {
  type SnackbarAction,
  type SnackbarSeverity,
  enqueueSnackbar,
} from "@repo/ui/snackbar";

/** 一則提示的選填內容:標題、動作按鈕(例 [撤銷])。 */
export interface SnackbarOptions {
  title?: ReactNode;
  action?: SnackbarAction;
}

/** 佇列上的一則提示。`id` 讓堆疊知道關的是哪一則,也讓每則有自己的進場動畫與計時。 */
export interface SnackbarItem extends SnackbarOptions {
  id: number;
  severity: SnackbarSeverity;
  message: ReactNode;
}

export interface SnackbarState {
  /** 畫面上的提示,由舊到新(最後一則畫在最下面);最多 3 則 */
  items: SnackbarItem[];
  /**
   * 最新送出的那一則(彈窗開著時 `SnackbarAnnouncer` 補念它)。被關掉就清空,
   * 所以關掉最新一則時不會把較舊的那則重念一次。
   */
  latest: SnackbarItem | null;
  show: (
    severity: SnackbarSeverity,
    message: ReactNode,
    options?: SnackbarOptions,
  ) => void;
  /** 關掉某一則(自動逾時、按 ✕ 或按動作按鈕) */
  dismiss: (id: number) => void;
  /** 測試用:把 store 歸零(`src/test/setup.ts` 每個測試後呼叫) */
  reset: () => void;
}

let nextId = 0;

/**
 * 全站短提示的佇列(REACT-02:跨元件的用戶端狀態用 zustand)。
 *
 * **堆疊規則:所有提示(操作結果、可撤銷、新通知)一律往上疊,新的在下面;最多 3 則,
 * 第 4 則出現時最舊的那則消失。** 截斷由 `@repo/ui/snackbar` 的 `enqueueSnackbar` 決定,
 * 位置與計時(一般 4 秒、有動作 8 秒、滑過暫停)由 `SnackbarStack` / `Snackbar` 負責。
 *
 * 元件不直接用這支 store,一律經 `hooks/base/useMutationFeedback.ts`
 * (mutation 的回饋)或 `useSnackbar()`(少數自己控制時機的流程、可撤銷、新通知)。
 */
export const useSnackbarStore = create<SnackbarState>()((set) => ({
  items: [],
  latest: null,
  show: (severity, message, options) => {
    nextId += 1;
    const item: SnackbarItem = { id: nextId, severity, message, ...options };
    set((state) => ({
      items: enqueueSnackbar(state.items, item),
      latest: item,
    }));
  },
  dismiss: (id) => {
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      latest: state.latest?.id === id ? null : state.latest,
    }));
  },
  reset: () => {
    set({ items: [], latest: null });
  },
}));
