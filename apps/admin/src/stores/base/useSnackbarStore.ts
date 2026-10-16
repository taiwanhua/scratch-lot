import type { ReactNode } from "react";
import { create } from "zustand";

import type { SnackbarSeverity } from "@repo/ui/snackbar";

/** 佇列上的一則提示。`id` 只為了讓 React 換節點時重跑進場動畫與自動關閉計時。 */
export interface SnackbarItem {
  id: number;
  severity: SnackbarSeverity;
  message: ReactNode;
}

export interface SnackbarState {
  /** 目前要顯示的那一則;沒有就是 null */
  current: SnackbarItem | null;
  show: (severity: SnackbarSeverity, message: ReactNode) => void;
  /** 關掉目前這一則(自動逾時或按關閉鈕) */
  dismiss: () => void;
  /** 測試用:把 store 歸零(`src/test/setup.ts` 每個測試後呼叫) */
  reset: () => void;
}

let nextId = 0;

/**
 * 操作結果提示的佇列(REACT-02:跨元件的用戶端狀態用 zustand)。
 *
 * **排隊策略:長度 1 的佇列 —— 一次只顯示最新的一則,舊的直接被取代、不補顯示。**
 * 理由寫在 `@repo/ui/snackbar` 的 JSDoc:這是操作回饋不是通知中心,連續送出三次時
 * 使用者要看的是最後那一次的結果;真排隊的話第三則要等 12 秒才出現,那時人早就換頁了。
 * 失敗的細節本來就另外留在表單 / 彈窗的欄位級錯誤上,不靠這裡補完。
 *
 * 元件不直接用這支 store,一律經 `hooks/base/useMutationFeedback.ts`
 * (mutation 的回饋)或 `useSnackbar()`(少數自己控制時機的流程)。
 */
export const useSnackbarStore = create<SnackbarState>()((set) => ({
  current: null,
  show: (severity, message) => {
    nextId += 1;
    set({ current: { id: nextId, severity, message } });
  },
  dismiss: () => {
    set({ current: null });
  },
  reset: () => {
    set({ current: null });
  },
}));
