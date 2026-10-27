import { useAppUpdateNotice } from "@/hooks/base/useAppUpdateNotice";

export interface AppUpdateNoticeProps {
  /** 這個 bundle 的版本(`lib/base/app-version-env.ts`);沒有 = 不啟動 */
  currentVersion: string | undefined;
}

/**
 * 新版本提示的掛載點(不渲染任何東西,提示走全站 Snackbar)。放在組裝根 `App.tsx` 的 router 裡、
 * 路由旁邊 —— 登入頁也要偵測得到,所以不登記成殼上的常駐元件。行為見 `useAppUpdateNotice`。
 */
export const AppUpdateNotice = ({ currentVersion }: AppUpdateNoticeProps) => {
  useAppUpdateNotice({ currentVersion });
  return null;
};
