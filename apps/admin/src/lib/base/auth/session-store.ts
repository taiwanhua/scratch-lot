import type { StoreApi } from "zustand";

/**
 * access token 的唯一存放處:記憶體(ADR-0003;不進 localStorage / cookie)。
 * 狀態本體是 zustand store(`stores/base/useSessionStore.ts`);這裡只放型別與初值,讓 fetch 層(lib)與 store(stores)共用 —
 * lib 不 import stores(STRUCT-03),store 由組裝根注入 `createAuthSession`。
 */
export type SessionStatus =
  /** 開機中:記憶體沒有 token,正在用 refresh cookie 換票 */
  "booting" | "authenticated" | "anonymous";

export interface SessionSnapshot {
  status: SessionStatus;
  accessToken: string | null;
  /**
   * api 對某個受保護請求回了 `MUST_CHANGE_PASSWORD`(GQL-04;首登須改密碼者做了「看自己 / 改密碼 / 登出」以外的操作)。
   * 由 fetch 層寫入、路由守門讀取後導向改密碼頁;改完密碼清掉。
   */
  mustChangePassword: boolean;
}

export interface SessionActions {
  setAccessToken: (token: string) => void;
  setMustChangePassword: (value: boolean) => void;
  /** 清空 token 並標記為未登入(登出、refresh 失敗、其他分頁登出) */
  clear: () => void;
  /**
   * 清空 token 並回到 `booting`(其他分頁登入了別的帳號 → 本分頁丟掉舊身分、等重新用 cookie 換票)。
   * 與 `clear` 的差別只在狀態:`clear` 是「確定沒登入」(守門導去登入頁),`reset` 是「還不知道自己是誰」(守門顯示恢復中)。
   */
  reset: () => void;
}

export type SessionState = SessionSnapshot & SessionActions;

/** 非 React 的 fetch 層看到的 store 介面(zustand 的 `getState` / `subscribe`);`useSessionStore` 本身就滿足它。 */
export type SessionStore = StoreApi<SessionState>;

export const INITIAL_SESSION_SNAPSHOT: SessionSnapshot = {
  status: "booting",
  accessToken: null,
  mustChangePassword: false,
};
