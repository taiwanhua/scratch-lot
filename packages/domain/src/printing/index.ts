/**
 * `@repo/domain/printing`:列印的共用契約 —— 常數、狀態、
 * 代理程式 ↔ API 的 HTTP 協定與安裝檔 `manifest.json` 的格式。
 * api(`apps/api/src/printing/`)與代理程式(`apps/print-agent`)共用;不依賴 Node。
 */
export * from "./constants";
export * from "./agent-api";
export * from "./release";
