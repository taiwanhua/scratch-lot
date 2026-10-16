import { DurableObject } from "cloudflare:workers";

import {
  REALTIME_CLOSE_CODES,
  type RealtimeServerMessage,
  type RealtimeSignal,
  type RealtimeTicket,
  parseRealtimeClientMessage,
  parseRealtimeTicket,
  realtimeAllowedTopics,
  realtimeSelfTopic,
  realtimeTicketHolder,
  verifyRealtimeTicket,
} from "@repo/domain/realtime";
import { log } from "@repo/logger";

import { type RealtimeEnv, VERIFIED_TICKET_HEADER, nowSeconds } from "./env";

/**
 * 連線資訊,存在每條 WebSocket 的 attachment(`serializeAttachment`),Durable Object 休眠喚醒後照樣讀得到;
 * 不寫 storage、不保存信號。
 */
export interface ConnectionAttachment {
  /** 持有者識別(租戶 + 個人頻道),換發憑證時新舊必須相同。 */
  holder: string;
  userId?: string;
  agentId?: string;
  allowedTopics: string[];
  subscribedTopics: string[];
  /** 訂閱憑證到期時間(Unix 秒)。 */
  exp: number;
}

function attachmentFor(ticket: RealtimeTicket): ConnectionAttachment {
  return {
    holder: realtimeTicketHolder(ticket),
    ...(ticket.userId === undefined
      ? { agentId: ticket.agentId }
      : { userId: ticket.userId }),
    allowedTopics: realtimeAllowedTopics(ticket),
    subscribedTopics: [realtimeSelfTopic(ticket)],
    exp: ticket.exp,
  };
}

function readAttachment(ws: WebSocket): ConnectionAttachment | null {
  return ws.deserializeAttachment() as ConnectionAttachment | null;
}

function send(ws: WebSocket, message: RealtimeServerMessage): void {
  ws.send(JSON.stringify(message));
}

function closeExpired(ws: WebSocket): void {
  ws.close(REALTIME_CLOSE_CODES.ticketExpired, "ticket expired");
}

/** 對一條連線送出信號:憑證過期就關閉、不推;有訂閱該頻道才推。回傳是否推送。 */
function deliver(
  ws: WebSocket,
  topic: string,
  message: RealtimeServerMessage,
  now: number,
): boolean {
  const attachment = readAttachment(ws);
  if (attachment === null) {
    return false;
  }
  if (attachment.exp <= now) {
    closeExpired(ws);
    return false;
  }
  if (!attachment.subscribedTopics.includes(topic)) {
    return false;
  }
  send(ws, message);
  return true;
}

/**
 * 每個租戶一個的 Durable Object(`idFromName("hub:" + tenantId)`):保存連線與各連線訂閱的頻道,
 * 收到信號推給有訂閱的連線。
 *
 * **只用 WebSocket Hibernation API**(`ctx.acceptWebSocket` + `webSocketMessage` / `serializeAttachment`):
 * 閒置連線不讓 Durable Object 常駐計費;測試會掃原始碼把關。
 */
export class TenantHub extends DurableObject<RealtimeEnv> {
  /** Worker 驗過訂閱憑證後轉來的連線請求。 */
  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    let ticket: RealtimeTicket | null = null;
    try {
      ticket = parseRealtimeTicket(
        JSON.parse(request.headers.get(VERIFIED_TICKET_HEADER) ?? "null"),
      );
    } catch {
      ticket = null;
    }
    if (ticket === null) {
      return new Response("Bad Request", { status: 400 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [
      WebSocket,
      WebSocket,
    ];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachmentFor(ticket));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 送出信號:推給訂閱該頻道的連線;遇到憑證已過期的連線一律關閉、不推。回傳實際推送的連線數。 */
  publish(topic: string, signal: RealtimeSignal): number {
    const now = nowSeconds();
    const message: RealtimeServerMessage = {
      op: "signal",
      topic,
      signal:
        signal.id === undefined
          ? { type: signal.type }
          : { type: signal.type, id: signal.id },
    };
    let delivered = 0;
    for (const ws of this.ctx.getWebSockets()) {
      // 每條連線各自處理:一條連線出錯(已斷、attachment 壞掉)只略過它,不影響其他連線,`/publish` 也不回 500
      try {
        if (deliver(ws, topic, message, now)) {
          delivered += 1;
        }
      } catch (error) {
        log("realtime: 推送到單一連線失敗,略過", topic, error);
      }
    }
    return delivered;
  }

  override async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = readAttachment(ws);
    if (attachment === null) {
      return;
    }
    const message =
      typeof raw === "string" ? parseRealtimeClientMessage(raw) : null;
    if (message === null) {
      send(ws, { op: "rejected", reason: "bad-message" });
      return;
    }
    if (message.op === "renew") {
      await this.renew(ws, attachment, message.ticket);
      return;
    }
    if (attachment.exp <= nowSeconds()) {
      closeExpired(ws);
      return;
    }
    if (message.op === "subscribe") {
      if (!attachment.allowedTopics.includes(message.topic)) {
        send(ws, { op: "rejected", reason: "not-allowed" });
        return;
      }
      if (!attachment.subscribedTopics.includes(message.topic)) {
        ws.serializeAttachment({
          ...attachment,
          subscribedTopics: [...attachment.subscribedTopics, message.topic],
        });
      }
      send(ws, { op: "subscribed", topic: message.topic });
      return;
    }
    ws.serializeAttachment({
      ...attachment,
      subscribedTopics: attachment.subscribedTopics.filter(
        (topic) => topic !== message.topic,
      ),
    });
    send(ws, { op: "unsubscribed", topic: message.topic });
  }

  /**
   * 在原連線上換發訂閱憑證(不重新連線):新憑證要驗得過、且租戶與持有者和原連線相同;
   * 可訂閱頻道換成新憑證的,已訂閱但新憑證不再允許的頻道一併移除。
   */
  private async renew(
    ws: WebSocket,
    attachment: ConnectionAttachment,
    token: string,
  ): Promise<void> {
    const result = await verifyRealtimeTicket(
      token,
      this.env.REALTIME_TICKET_SECRET,
      nowSeconds(),
    );
    if (!result.ok) {
      send(ws, { op: "rejected", reason: "invalid-ticket" });
      return;
    }
    const next = attachmentFor(result.ticket);
    if (next.holder !== attachment.holder) {
      send(ws, { op: "rejected", reason: "ticket-mismatch" });
      return;
    }
    ws.serializeAttachment({
      ...next,
      subscribedTopics: attachment.subscribedTopics.filter((topic) =>
        next.allowedTopics.includes(topic),
      ),
    });
    send(ws, { op: "renewed", exp: next.exp });
  }
}
