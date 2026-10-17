import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";

import { SessionContext } from "@/hooks/base/useSession";
import type { AuthSession } from "@/lib/base/auth/session";
import { useSessionStore } from "@/stores/base/useSessionStore";

import { MultiTabSession } from "./MultiTabSession/MultiTabSession";

export interface SessionProviderProps {
  session: AuthSession;
  children: ReactNode;
}

/**
 * 登入狀態的 React 入口(注入 `AuthSession` 實例;狀態本體在 `useSessionStore`):
 * - 開機時用 refresh cookie 換票(重新整理後 30 天內不必重登)
 * - 狀態變成未登入時清掉 react-query 快取(`me` 等不留給下一個人)
 *
 * 分頁之間的同步(其他分頁登出 / 登入了別的帳號)在 `MultiTabSession`(#375) —— 它要用到 `me` 與導向,
 * 所以掛在 context 裡面、與頁面同層。
 */
export const SessionProvider = ({
  session,
  children,
}: SessionProviderProps) => {
  const queryClient = useQueryClient();
  const status = useSessionStore((state) => state.status);

  useEffect(() => {
    void session.restore();
  }, [session]);

  useEffect(() => {
    if (status === "anonymous") {
      queryClient.clear();
    }
  }, [queryClient, status]);

  useEffect(
    () => () => {
      session.dispose();
    },
    [session],
  );

  return (
    <SessionContext.Provider value={session}>
      {children}
      <MultiTabSession />
    </SessionContext.Provider>
  );
};
