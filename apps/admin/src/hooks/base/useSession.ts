import { createContext, useContext } from "react";

import type { AuthSession } from "../../lib/base/auth/session";
import type { SessionSnapshot } from "../../lib/base/auth/session-store";
import { useSessionStore } from "../../stores/base/useSessionStore";

/**
 * 注入用 context(REACT-02:只注入 `AuthSession` 實例 — client、channel、restore / signOut — 不承載會變的狀態;
 * 狀態在 `useSessionStore`)。由 `app/providers/SessionProvider.tsx` 供給。
 */
export const SessionContext = createContext<AuthSession | null>(null);

export interface SessionContextValue {
  session: AuthSession;
  snapshot: SessionSnapshot;
}

export const useSession = (): SessionContextValue => {
  const session = useContext(SessionContext);
  const snapshot = useSessionStore();
  if (session === null) {
    throw new Error("useSession must be used within <SessionProvider>");
  }
  return { session, snapshot };
};
