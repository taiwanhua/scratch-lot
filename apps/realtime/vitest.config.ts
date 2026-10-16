import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * 測試跑在本機 Workers 執行環境(Miniflare / workerd),Worker 與 Durable Object 都是真的;
 * 兩把密鑰給測試用假值(雲端值放 Wrangler secret,不在這裡)。
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          REALTIME_TICKET_SECRET: "test-ticket-secret",
          REALTIME_PUBLISH_SECRET: "test-publish-secret",
        },
      },
    }),
  ],
});
