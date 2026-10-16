import type { TenantHub } from "./tenant-hub";

/**
 * Worker 與 Durable Object 共用的 bindings(`wrangler.jsonc` 宣告 `TENANT_HUB`;兩把密鑰本機放
 * `.dev.vars`、雲端放 Wrangler secret)。
 */
export interface RealtimeEnv {
  /** Durable Object `TenantHub`:每個租戶一個,名稱 `hub:<租戶 id>`。 */
  TENANT_HUB: DurableObjectNamespace<TenantHub>;
  /** 訂閱憑證簽章密鑰(API 簽、Worker 與 Durable Object 驗)。 */
  REALTIME_TICKET_SECRET: string;
  /** 送出信號密鑰(API 對 `/publish` 的 body 簽章)。 */
  REALTIME_PUBLISH_SECRET: string;
}

/** Worker 驗過的訂閱憑證內容,轉給 Durable Object 的內部 header(Durable Object 只能經由 Worker 到達)。 */
export const VERIFIED_TICKET_HEADER = "x-realtime-verified-ticket";

/** 現在時間(Unix 秒),與訂閱憑證的 `exp` 同單位。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
