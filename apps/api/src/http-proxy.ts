import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * api 前面的反向代理層數(Express `trust proxy`):Cloud Run 的請求一律先經過 Google Front End(一層),
 * 由它把客戶端 IP 附加在 `X-Forwarded-For` 最後面;瀏覽器直接打 api 的 Cloud Run 網址
 * (admin 的 nginx 只出靜態檔,不轉送 api,見 `apps/admin/nginx.conf`)。
 *
 * 設成 1 = 只信任最靠近 api 的那一層:`req.ip` 取 `X-Forwarded-For` 由右數第一個(GFE 附上的客戶端 IP),
 * 客戶端自己塞在前面的假值不會被採用。之後若在 Cloud Run 前面再加一層(外部 HTTPS 負載平衡器等),
 * 這裡要跟著加 1。本機沒有代理時,客戶端可以自帶 `X-Forwarded-For` 改寫 `req.ip`——只影響本機開發。
 *
 * 需要記錄來源 IP 的功能一律讀 `req.ip`(經這裡的 trust proxy 設定換算),不要自己解析 `X-Forwarded-For`。
 */
export const TRUST_PROXY_HOPS = 1;

/** 正式啟動(`main.ts`)與測試 harness 共用同一份設定。 */
export function applyTrustProxy(app: NestExpressApplication): void {
  app.set("trust proxy", TRUST_PROXY_HOPS);
}
