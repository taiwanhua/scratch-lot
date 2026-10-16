import type { QueryClient } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import type { ReactNode } from "react";

import type { AuthSession } from "@/lib/base/auth/session";

import { formModuleOptions } from "../module-pages";
import { AppProviders } from "./AppProviders";
import { FormModuleOptionsProvider } from "./FormModuleOptionsProvider";

export interface RootProvidersProps {
  session: AuthSession;
  queryClient: QueryClient;
  children: ReactNode;
}

/**
 * 組裝根的 providers:通用的 `AppProviders`(i18n、主題、QueryClient、Session、提示)包住
 * 「讀固定組裝結果」的那一層 —— 表單模組設定取自 `app/module-pages.tsx` 的合成結果。
 * 最外層的 `NuqsAdapter` 讓 `useUrlState` 透過 react-router 讀寫網址參數,所以必須在 router 裡面。
 * `App.tsx` 與測試的 `test/test-app.tsx` 共用這一份接線,兩邊不各寫一套。
 */
export const RootProviders = ({
  session,
  queryClient,
  children,
}: RootProvidersProps) => (
  <NuqsAdapter>
    <AppProviders session={session} queryClient={queryClient}>
      <FormModuleOptionsProvider options={formModuleOptions}>
        {children}
      </FormModuleOptionsProvider>
    </AppProviders>
  </NuqsAdapter>
);
