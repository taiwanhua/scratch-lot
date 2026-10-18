import { signHmac, verifyHmac } from "./hmac";
import {
  type RealtimeSignal,
  isRealtimeId,
  isRealtimeSignal,
  isRealtimeTopic,
} from "./topic";

/**
 * 即時通道的兩組協定:
 *
 * 1. API → Worker `POST /publish`:body 是 `RealtimePublishRequest` 的 JSON,
 *    header `x-realtime-signature` 帶「送出信號密鑰」對**原始 body 字串**的 HMAC-SHA256(base64url)。
 *    一次送出可帶多個頻道(算 1 次 Worker + 1 次 Durable Object 請求);同一條連線訂閱了其中幾個也只推一次。
 * 2. 連線上的訊息(JSON 文字):前端 / 代理程式送 `RealtimeClientMessage`,Durable Object 回 `RealtimeServerMessage`;
 *    另有偵測半開連線的 `REALTIME_PING` / `REALTIME_PONG`(Durable Object 以 auto-response 回,不經 `webSocketMessage`)。
 */

export const REALTIME_PUBLISH_SIGNATURE_HEADER = "x-realtime-signature";

/** `/publish` body 的長度上限(bytes);送出端一次帶的頻道要切成不超過它的批次。 */
export const REALTIME_PUBLISH_BODY_MAX_LENGTH = 65_536;

export interface RealtimePublishRequest {
  tenantId: string;
  /** 這次送出的頻道(至少一個、不重複)。 */
  topics: string[];
  signal: RealtimeSignal;
}

export function isRealtimePublishRequest(
  value: unknown,
): value is RealtimePublishRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3) {
    return false;
  }
  const { topics } = record;
  return (
    isRealtimeId(record.tenantId) &&
    Array.isArray(topics) &&
    topics.length > 0 &&
    topics.every(isRealtimeTopic) &&
    new Set(topics).size === topics.length &&
    isRealtimeSignal(record.signal)
  );
}

/** 送出端(API)對 body 簽章,放進 `x-realtime-signature`。 */
export async function signRealtimePublish(
  body: string,
  secret: string,
): Promise<string> {
  return signHmac(secret, body);
}

/** 接收端(Worker)驗證 `/publish` 的簽章;缺 header 或不符都回 `false`。 */
export async function verifyRealtimePublish(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (signature === null || signature.length === 0) {
    return false;
  }
  return verifyHmac(secret, body, signature);
}

/** 前端 / 代理程式在連線上送的訊息。`renew` = 在原連線上換發訂閱憑證(不重新連線)。 */
export type RealtimeClientMessage =
  | { op: "subscribe"; topic: string }
  | { op: "unsubscribe"; topic: string }
  | { op: "renew"; ticket: string };

export type RealtimeRejectReason =
  "not-allowed" | "invalid-ticket" | "ticket-mismatch" | "bad-message";

/**
 * 偵測半開連線(連線其實斷了、兩端都沒發現)的 ping / pong:客戶端送 `REALTIME_PING`,Durable Object 回 `REALTIME_PONG`。
 *
 * Durable Object 用 `ctx.setWebSocketAutoResponse` 登記這一組字串:**整個字串完全相同**才自動回應,
 * 不喚醒休眠中的 Durable Object、不進 `webSocketMessage`(RT-01)。所以客戶端一律送這個常數本身,
 * 不要自己 `JSON.stringify`(空白或欄位順序不同就不會被自動回應,改由 `webSocketMessage` 回 `bad-message`)。
 * Cloudflare 限制兩個字串各 2,048 字元以內。間隔與逾時見 `timing.ts`。
 */
export const REALTIME_PING = '{"op":"ping"}';
export const REALTIME_PONG = '{"op":"pong"}';

/** Durable Object 回給連線的訊息(`pong` 由 auto-response 回,內容固定是 `REALTIME_PONG`)。 */
export type RealtimeServerMessage =
  | { op: "signal"; topic: string; signal: RealtimeSignal }
  | { op: "subscribed"; topic: string }
  | { op: "unsubscribed"; topic: string }
  | { op: "renewed"; exp: number }
  | { op: "rejected"; reason: RealtimeRejectReason }
  | { op: "pong" };

/** 連線被關閉的原因代碼(WebSocket close code 4000–4999 為應用自訂)。 */
export const REALTIME_CLOSE_CODES = {
  /** 訂閱憑證過期且未換發:前端應重新取得訂閱憑證再連線。 */
  ticketExpired: 4001,
  /**
   * 連線資料(attachment)寫不進去(例:超過 Cloudflare 的 16 KB 上限):Durable Object 關閉該連線並記 log,
   * 不讓錯誤變成 500;前端照斷線處理(降級輪詢、退避重連)。
   */
  attachmentFailed: 4002,
} as const;

/** 解析連線上的訊息;格式不對回 `null`。 */
export function parseRealtimeClientMessage(
  text: string,
): RealtimeClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.op === "subscribe" || record.op === "unsubscribe") &&
    isRealtimeTopic(record.topic)
  ) {
    return { op: record.op, topic: record.topic };
  }
  if (
    record.op === "renew" &&
    typeof record.ticket === "string" &&
    record.ticket.length > 0
  ) {
    return { op: "renew", ticket: record.ticket };
  }
  return null;
}
