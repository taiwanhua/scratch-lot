import {
  REALTIME_PUBLISH_SIGNATURE_HEADER,
  isRealtimePublishRequest,
  verifyRealtimePublish,
  verifyRealtimeTicket,
} from "@repo/domain/realtime";

import { type RealtimeEnv, VERIFIED_TICKET_HEADER, nowSeconds } from "./env";

export { TenantHub } from "./tenant-hub";

/** `/publish` body 上限:信號只有幾十 byte,超過就不是合法請求。 */
const PUBLISH_BODY_MAX_LENGTH = 4096;

function hubOf(env: RealtimeEnv, tenantId: string) {
  return env.TENANT_HUB.get(env.TENANT_HUB.idFromName(`hub:${tenantId}`));
}

/**
 * `GET /connect?ticket=`:驗訂閱憑證的簽章與到期(不查資料庫)→ 轉給該租戶的 Durable Object 接下連線。
 */
async function connect(
  request: Request,
  url: URL,
  env: RealtimeEnv,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  const result = await verifyRealtimeTicket(
    url.searchParams.get("ticket") ?? "",
    env.REALTIME_TICKET_SECRET,
    nowSeconds(),
  );
  if (!result.ok) {
    return new Response("Unauthorized", { status: 401 });
  }
  return hubOf(env, result.ticket.tenantId).fetch("https://hub/connect", {
    headers: {
      Upgrade: "websocket",
      [VERIFIED_TICKET_HEADER]: JSON.stringify(result.ticket),
    },
  });
}

/**
 * `POST /publish`:API 送出信號。body `{ tenantId, topic, signal }`,header 帶送出信號密鑰的簽章;
 * 簽章不對 401、格式不對(含信號夾帶資料)400。成功回推送到的連線數。
 */
async function publish(request: Request, env: RealtimeEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const body = await request.text();
  if (body.length > PUBLISH_BODY_MAX_LENGTH) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const signed = await verifyRealtimePublish(
    body,
    request.headers.get(REALTIME_PUBLISH_SIGNATURE_HEADER),
    env.REALTIME_PUBLISH_SECRET,
  );
  if (!signed) {
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  if (!isRealtimePublishRequest(payload)) {
    return new Response("Bad Request", { status: 400 });
  }
  const delivered = await hubOf(env, payload.tenantId).publish(
    payload.topic,
    payload.signal,
  );
  return Response.json({ delivered });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      return connect(request, url, env);
    }
    if (url.pathname === "/publish") {
      return publish(request, env);
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<RealtimeEnv>;
