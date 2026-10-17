import { create } from "zustand";

import {
  INITIAL_SESSION_SNAPSHOT,
  type SessionSnapshot,
  type SessionState,
} from "../../lib/base/auth/session-store";

const ANONYMOUS: SessionSnapshot = {
  status: "anonymous",
  accessToken: null,
  mustChangePassword: false,
};

/**
 * 登入狀態(REACT-02:跨元件的用戶端狀態用 zustand)。access token 只活在這個 store 的記憶體(ADR-0003),不持久化。
 * 元件經 `hooks/base/useSession.ts` 讀;fetch 層(lib)經組裝根注入的 `getState()` 讀寫(`createAuthSession`)。
 * 「沒變化不通知」的兩個守門沿用重構前的手刻 store,避免重複的 clear / 立旗觸發多餘渲染。
 */
export const useSessionStore = create<SessionState>()((set, get) => ({
  ...INITIAL_SESSION_SNAPSHOT,
  setAccessToken: (token) => {
    set({ status: "authenticated", accessToken: token });
  },
  setMustChangePassword: (value) => {
    if (get().mustChangePassword === value) {
      return;
    }
    set({ mustChangePassword: value });
  },
  clear: () => {
    if (get().status === "anonymous") {
      return;
    }
    set(ANONYMOUS);
  },
  reset: () => {
    set({ ...INITIAL_SESSION_SNAPSHOT });
  },
}));
