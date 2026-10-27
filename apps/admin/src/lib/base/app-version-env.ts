/**
 * 這個 bundle 的版本:build 時由 `scripts/app-version-plugin.mjs` 烘入(部署的 commit SHA,沒有就是 build 時間)。
 * `vite dev` 與 mock 模式不接外掛 → `undefined`,新版本提示不啟動。只在組裝根讀取 — 測試不 import 本檔(同 `graphql.ts`)。
 */
export const APP_VERSION = import.meta.env.APP_VERSION;
