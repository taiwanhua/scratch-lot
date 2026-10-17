import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** 注入 token(即時通道的設定值,自環境變數讀取;登記:docs/env-registry.md)。 */
export const REALTIME_CONFIG = Symbol("REALTIME_CONFIG");

/**
 * 即時通道的設定。三個值都有才啟用:
 * - `REALTIME_URL`(普通 env):Worker 的網址(`https://rt-dev.<網域>`);`/publish` 與前端連線都從它組出
 * - `REALTIME_PUBLISH_SECRET`(Secret Manager):送出信號密鑰,對 `/publish` 的 body 簽章
 * - `REALTIME_TICKET_SECRET`(Secret Manager):訂閱憑證簽章密鑰,Worker 用同一把驗
 *
 * 缺任何一個 = 停用:不簽發訂閱憑證(前端改 60 秒輪詢)、送出信號只記 log。api 不因此啟動失敗 ——
 * 本地與測試本來就沒有 Worker;雲端漏設會在 log 看到警告(寫法與 MailModule 一致)。
 */
export type RealtimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      /** 不帶結尾斜線的 origin(`https://rt.example.com`)。 */
      url: string;
      publishSecret: string;
      ticketSecret: string;
    };

const ENV_KEYS = [
  "REALTIME_URL",
  "REALTIME_PUBLISH_SECRET",
  "REALTIME_TICKET_SECRET",
] as const;

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** `http(s)://host[:port]`,去掉結尾斜線;格式不對回 undefined。 */
function originOf(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function loadRealtimeConfig(config: ConfigService): RealtimeConfig {
  const values = ENV_KEYS.map((key) => nonEmpty(config.get<string>(key)));
  const [rawUrl, publishSecret, ticketSecret] = values;
  const url = originOf(rawUrl);
  if (
    url !== undefined &&
    publishSecret !== undefined &&
    ticketSecret !== undefined
  ) {
    return { enabled: true, url, publishSecret, ticketSecret };
  }
  const missing = ENV_KEYS.filter(
    (key, index) =>
      values[index] === undefined ||
      (key === "REALTIME_URL" && url === undefined),
  );
  new Logger("RealtimeConfig").warn(
    `即時通道停用(${missing.join("、")} 未設定或格式不對):不簽發訂閱憑證、送出信號只記 log,前端改 60 秒輪詢`,
  );
  return { enabled: false };
}

export const realtimeConfigProvider = {
  provide: REALTIME_CONFIG,
  inject: [ConfigService],
  useFactory: loadRealtimeConfig,
};
