import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";

import { reportAppUpdateError } from "../hooks/base/useAppUpdateNotice";
import { APP_VERSION } from "../lib/base/app-version-env";
import { type AuthSession, createAuthSession } from "../lib/base/auth/session";
import { GRAPHQL_ENDPOINT } from "../lib/base/graphql";
import { useSessionStore } from "../stores/base/useSessionStore";
import { AppUpdateNotice } from "./AppUpdateNotice";
import { RootProviders } from "./providers/RootProviders";
import { AppRoutes } from "./routes";

/**
 * 組裝根:瀏覽器 router + 單一 session(access token 只活在 `useSessionStore` 的記憶體裡)+ providers。
 * QueryClient 的錯誤統一經 `reportAppUpdateError`:api 回 `GRAPHQL_VALIDATION_FAILED` = 這個分頁跑的是舊版,
 * 由 `AppUpdateNotice` 提示重新整理(`hooks/base/useAppUpdateNotice.ts`)。
 */
export const App = () => {
  const [session] = useState<AuthSession>(() =>
    createAuthSession(GRAPHQL_ENDPOINT, useSessionStore),
  );
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: reportAppUpdateError }),
        mutationCache: new MutationCache({ onError: reportAppUpdateError }),
      }),
  );

  return (
    <BrowserRouter>
      <RootProviders session={session} queryClient={queryClient}>
        <AppRoutes />
        <AppUpdateNotice currentVersion={APP_VERSION} />
      </RootProviders>
    </BrowserRouter>
  );
};
