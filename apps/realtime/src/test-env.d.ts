import type { RealtimeEnv } from "./env";

declare global {
  namespace Cloudflare {
    // `cloudflare:workers` 的 `env` 型別:與 Worker 實際 bindings 同一份
    interface Env {
      TENANT_HUB: RealtimeEnv["TENANT_HUB"];
      REALTIME_TICKET_SECRET: RealtimeEnv["REALTIME_TICKET_SECRET"];
      REALTIME_PUBLISH_SECRET: RealtimeEnv["REALTIME_PUBLISH_SECRET"];
    }

    // `cloudflare:workers` 的 `exports` 型別:Worker 主模組(測試用 `exports.default.fetch` 打 Worker)
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "TenantHub";
    }
  }

  interface ImportMeta {
    /** Vite 的 `import.meta.glob`(vitest 編譯時展開);只宣告測試用到的 `?raw` 形式。 */
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}
