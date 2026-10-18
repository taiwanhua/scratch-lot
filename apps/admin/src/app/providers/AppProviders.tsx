import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { IntlProvider } from "use-intl";

import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { createBrandFromPrimary } from "@repo/ui/theme";

import type { AuthSession } from "@/lib/base/auth/session";
import {
  COLOR_MODE_STORAGE_KEY,
  COLOR_SCHEME_STORAGE_KEY,
} from "@/lib/base/color-mode";
import { useLocaleStore } from "@/stores/base/useLocaleStore";

import { SessionProvider } from "./SessionProvider";
import { SnackbarProvider } from "./SnackbarProvider";

/**
 * 專案設定在這裡注入通用的 i18n 與主題(兩者都不自己讀專案設定):
 * 字典的品牌名 / 前台 metadata、主題的名稱 / 主色。設定是 build 輸入,模組層算一次即可。
 */
const projectMessages = composeProjectMessages({
  brandName: projectPublic.brand.name,
  frontMetadata: projectPublic.front.metadata,
});

const projectBrand = createBrandFromPrimary(
  projectPublic.brand.name,
  projectPublic.brand.primary,
);

export interface AppProvidersProps {
  session: AuthSession;
  queryClient: QueryClient;
  children: ReactNode;
}

/**
 * 全 app 共用的 providers(main.tsx 與測試共用同一份組裝;router 由外層提供)。
 * 全部是注入用(REACT-02):語言狀態本體在 `useLocaleStore`,這裡只把它餵給 IntlProvider 並同步 `<html lang>`。
 */
export const AppProviders = ({
  session,
  queryClient,
  children,
}: AppProvidersProps) => {
  const locale = useLocaleStore((state) => state.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <IntlProvider locale={locale} messages={projectMessages[locale]}>
      <AppThemeProvider
        brand={projectBrand}
        modeStorageKey={COLOR_MODE_STORAGE_KEY}
        colorSchemeStorageKey={COLOR_SCHEME_STORAGE_KEY}
      >
        <QueryClientProvider client={queryClient}>
          <SessionProvider session={session}>
            {/* 操作結果提示掛在最內層:每一頁、每個彈窗共用同一個出口 */}
            <SnackbarProvider>{children}</SnackbarProvider>
          </SessionProvider>
        </QueryClientProvider>
      </AppThemeProvider>
    </IntlProvider>
  );
};
