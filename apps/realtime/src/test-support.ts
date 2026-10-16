import { env, exports } from "cloudflare:workers";

import {
  REALTIME_PUBLISH_SIGNATURE_HEADER,
  REALTIME_TICKET_TTL_SECONDS,
  type RealtimeServerMessage,
  signRealtimePublish,
  signRealtimeTicket,
} from "@repo/domain/realtime";

import { nowSeconds } from "./env";

const ORIGIN = "https://rt.test";

type TicketSubject = { userId: string } | { agentId: string };

export async function issueTicket(
  tenantId: string,
  subject: TicketSubject,
  topics: string[],
  exp = nowSeconds() + REALTIME_TICKET_TTL_SECONDS,
): Promise<string> {
  return signRealtimeTicket(
    { tenantId, ...subject, exp, topics },
    env.REALTIME_TICKET_SECRET,
  );
}

/** 用測試端收發的連線:收到的訊息依序排隊,`next()` 取下一則。 */
export interface TestConnection {
  ws: WebSocket;
  next(): Promise<RealtimeServerMessage>;
  send(message: unknown): void;
  closed: Promise<{ code: number; reason: string }>;
  /** 目前已收到但還沒取走的訊息數。 */
  pending(): number;
}

export function connectWith(ticket: string): Promise<Response> {
  return exports.default.fetch(
    `${ORIGIN}/connect?ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: "websocket" } },
  );
}

export async function connect(ticket: string): Promise<TestConnection> {
  const response = await connectWith(ticket);
  const ws = response.webSocket;
  if (response.status !== 101 || ws === null) {
    throw new Error(`連線失敗:${String(response.status)}`);
  }
  const queue: RealtimeServerMessage[] = [];
  const waiters: ((message: RealtimeServerMessage) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as RealtimeServerMessage;
    const waiter = waiters.shift();
    if (waiter === undefined) {
      queue.push(message);
    } else {
      waiter(message);
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener("close", (event) => {
      resolve({ code: event.code, reason: event.reason });
    });
  });
  ws.accept();
  return {
    ws,
    next: () => {
      const queued = queue.shift();
      return queued === undefined
        ? new Promise((resolve) => waiters.push(resolve))
        : Promise.resolve(queued);
    },
    send: (message) => {
      ws.send(JSON.stringify(message));
    },
    closed,
    pending: () => queue.length,
  };
}

export function publishRaw(
  body: string,
  signature: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== null) {
    headers[REALTIME_PUBLISH_SIGNATURE_HEADER] = signature;
  }
  return exports.default.fetch(`${ORIGIN}/publish`, {
    method: "POST",
    headers,
    body,
  });
}

/** 正確簽章的 `/publish`,回傳推送到的連線數。 */
export async function publish(
  tenantId: string,
  topic: string,
  signal: { type: string; id?: string },
): Promise<number> {
  const body = JSON.stringify({ tenantId, topic, signal });
  const response = await publishRaw(
    body,
    await signRealtimePublish(body, env.REALTIME_PUBLISH_SECRET),
  );
  if (response.status !== 200) {
    throw new Error(`publish 失敗:${String(response.status)}`);
  }
  const { delivered } = await response.json<{ delivered: number }>();
  return delivered;
}

export function hubStub(tenantId: string) {
  return env.TENANT_HUB.get(env.TENANT_HUB.idFromName(`hub:${tenantId}`));
}

export async function statusOf(response: Promise<Response>): Promise<number> {
  const resolved = await response;
  return resolved.status;
}

/**
 * 不經 `signRealtimeTicket` 的形狀檢查、直接用測試密鑰簽任意內容(測「簽章正確但內容不合法」的憑證)。
 * 格式與正式憑證相同:`base64url(JSON).base64url(HMAC-SHA256)`。
 */
export async function signRawTicket(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const toBase64Url = (bytes: Uint8Array) =>
    btoa(String.fromCodePoint(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.REALTIME_TICKET_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}
