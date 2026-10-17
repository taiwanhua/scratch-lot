import { lazy } from "react";

/**
 * 印表機管理頁的懶載入入口(`app/base/module-pages.ts` 登記的是它):測試頁的單據零件含條碼與 QR code,
 * 只有進這一頁才需要,不進首屏 bundle。Suspense 在 `ModuleRoute`。
 */
export const LazyPrintersPage = lazy(() =>
  import("./PrintersPage").then((module) => ({ default: module.PrintersPage })),
);
