/**
 * 代理程式版本:發布時由 `scripts/build.ts` 以 esbuild `define` 烘進產物(= 發布 workflow 的 `version` 輸入);
 * 開發與測試直接跑原始碼時沒有烘入值,回 `0.0.0`。心跳(`POST /print-agent/heartbeat`)回報它,
 * 印表機管理頁拿它與 `manifest.json` 的最新版本比,舊版標「請更新」。
 */
declare const __PRINT_AGENT_VERSION__: string | undefined;

export const AGENT_VERSION: string =
  typeof __PRINT_AGENT_VERSION__ === "string"
    ? __PRINT_AGENT_VERSION__
    : "0.0.0";
