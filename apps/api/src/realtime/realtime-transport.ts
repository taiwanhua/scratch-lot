import { Logger } from "@nestjs/common";

import {
  REALTIME_PUBLISH_SIGNATURE_HEADER,
  type RealtimePublishRequest,
  signRealtimePublish,
} from "@repo/domain/realtime";

import type { RealtimeConfig } from "./realtime.config";

/** 一次 `/publish` 的逾時:盡力而為,不拖慢交易後的回應。 */
export const REALTIME_PUBLISH_TIMEOUT_MS = 3000;

/**
 * 把一次送出交給即時通道的 adapter(呼叫端只注入 `RealtimePublisher`,不認得 Cloudflare)。
 * 失敗一律拋錯,由 `RealtimePublisher` 記 log(盡力而為)。
 */
export abstract class RealtimeTransport {
  abstract send(request: RealtimePublishRequest): Promise<void>;
}

/** 正式 adapter:`POST <REALTIME_URL>/publish`,header 帶送出信號密鑰對原始 body 的簽章。 */
export class HttpRealtimeTransport extends RealtimeTransport {
  constructor(
    private readonly url: string,
    private readonly publishSecret: string,
  ) {
    super();
  }

  async send(request: RealtimePublishRequest): Promise<void> {
    const body = JSON.stringify(request);
    const response = await fetch(`${this.url}/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [REALTIME_PUBLISH_SIGNATURE_HEADER]: await signRealtimePublish(
          body,
          this.publishSecret,
        ),
      },
      body,
      signal: AbortSignal.timeout(REALTIME_PUBLISH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`/publish 回 ${String(response.status)}`);
    }
  }
}

/** 停用時(本地、測試、雲端漏設)的 adapter:只記 log,不連任何地方。 */
export class LoggingRealtimeTransport extends RealtimeTransport {
  private readonly logger = new Logger("RealtimeTransport");

  send(request: RealtimePublishRequest): Promise<void> {
    this.logger.debug(
      `即時通道停用,不送出信號 ${request.signal.type} → ${request.topics.join(",")}`,
    );
    return Promise.resolve();
  }
}

export function createRealtimeTransport(
  config: RealtimeConfig,
): RealtimeTransport {
  return config.enabled
    ? new HttpRealtimeTransport(config.url, config.publishSecret)
    : new LoggingRealtimeTransport();
}
