import { signHmac, verifyHmac } from "./hmac";
import {
  type RealtimeSignal,
  isRealtimeId,
  isRealtimeSignal,
  isRealtimeTopic,
} from "./topic";

/**
 * 即時通道的兩組協定(底座規格第 4 章「四個流程」):
 *
 * 1. API → Worker `POST /publish`:body 是 `RealtimePublishRequest` 的 JSON,
 *    header `x-realtime-signature` 帶「送出信號密鑰」對**原始 body 字串**的 HMAC-SHA256(base64url)。
 * 2. 連線上的訊息(JSON 文字):前端 / 代理程式送 `RealtimeClientMessage`,Durable Object 回 `RealtimeServerMessage`。
 */

export const REALTIME_PUBLISH_SIGNATURE_HEADER = "x-realtime-signature";

export interface RealtimePublishRequest {
  tenantId: string;
  topic: string;
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
  return (
    isRealtimeId(record.tenantId) &&
    isRealtimeTopic(record.topic) &&
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

/** Durable Object 回給連線的訊息。 */
export type RealtimeServerMessage =
  | { op: "signal"; topic: string; signal: RealtimeSignal }
  | { op: "subscribed"; topic: string }
  | { op: "unsubscribed"; topic: string }
  | { op: "renewed"; exp: number }
  | { op: "rejected"; reason: RealtimeRejectReason };

/** 連線被關閉的原因代碼(WebSocket close code 4000–4999 為應用自訂)。 */
export const REALTIME_CLOSE_CODES = {
  /** 訂閱憑證過期且未換發:前端應重新取得訂閱憑證再連線。 */
  ticketExpired: 4001,
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
