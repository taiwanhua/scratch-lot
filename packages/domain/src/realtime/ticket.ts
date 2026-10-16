import {
  decodeBase64Url,
  encodeBase64Url,
  encodeUtf8,
  signHmac,
  verifyHmac,
} from "./hmac";
import {
  REALTIME_FIELD_MAX_LENGTH,
  isRealtimeTopic,
  printAgentTopic,
  userTopic,
} from "./topic";

/**
 * 訂閱憑證(底座規格第 4 章「訂閱憑證」):API `realtimeTicket` 簽發、Worker 與 Durable Object 驗證。
 *
 * - 內容:`{ tenantId, userId | agentId, exp, topics }`;`exp` 是 Unix 秒,效期 10 分鐘。
 * - 字串格式:`<base64url(JSON)>.<base64url(HMAC-SHA256)>`,簽章對象是第一段原字串。
 * - 不存資料庫;驗證只看簽章與到期,不查資料庫。可訂閱的頻道由 API 依權限與可見範圍計算。
 */

/** 訂閱憑證效期(秒)。 */
export const REALTIME_TICKET_TTL_SECONDS = 600;

interface RealtimeTicketBase {
  tenantId: string;
  /** 到期時間(Unix 秒)。 */
  exp: number;
  /** 可訂閱的頻道。 */
  topics: string[];
}

/** 使用者(瀏覽器)或代理程式,二擇一。 */
export type RealtimeTicket = RealtimeTicketBase &
  ({ userId: string; agentId?: never } | { agentId: string; userId?: never });

export type RealtimeTicketRejection = "malformed" | "bad-signature" | "expired";

export type RealtimeTicketVerification =
  | { ok: true; ticket: RealtimeTicket }
  | { ok: false; reason: RealtimeTicketRejection };

const ID_PATTERN = /^[\w-]+$/;

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= REALTIME_FIELD_MAX_LENGTH &&
    ID_PATTERN.test(value)
  );
}

/** 形狀檢查:只接受上面列的欄位,`userId` / `agentId` 恰好一個。 */
export function parseRealtimeTicket(value: unknown): RealtimeTicket | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["tenantId", "userId", "agentId", "exp", "topics"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return null;
  }
  const { tenantId, userId, agentId, exp, topics } = record;
  if (!isId(tenantId) || typeof exp !== "number" || !Number.isFinite(exp)) {
    return null;
  }
  if (!Array.isArray(topics) || !topics.every(isRealtimeTopic)) {
    return null;
  }
  const base = { tenantId, exp, topics: [...topics] };
  if (userId !== undefined && agentId === undefined && isId(userId)) {
    return { ...base, userId };
  }
  if (agentId !== undefined && userId === undefined && isId(agentId)) {
    return { ...base, agentId };
  }
  return null;
}

export async function signRealtimeTicket(
  ticket: RealtimeTicket,
  secret: string,
): Promise<string> {
  if (parseRealtimeTicket(ticket) === null) {
    throw new Error("訂閱憑證內容格式錯誤");
  }
  const body = encodeBase64Url(encodeUtf8(JSON.stringify(ticket)));
  return `${body}.${await signHmac(secret, body)}`;
}

/**
 * 驗證訂閱憑證:先驗簽章、再看內容形狀、最後看到期(`exp <= nowSeconds` 即過期)。
 * 簽章不對時不解析內容,避免對未驗證的資料做任何判斷。
 */
export async function verifyRealtimeTicket(
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<RealtimeTicketVerification> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }
  const [body = "", signature = ""] = parts;
  if (!(await verifyHmac(secret, body, signature))) {
    return { ok: false, reason: "bad-signature" };
  }
  const bytes = decodeBase64Url(body);
  if (bytes === null) {
    return { ok: false, reason: "malformed" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const ticket = parseRealtimeTicket(payload);
  if (ticket === null) {
    return { ok: false, reason: "malformed" };
  }
  if (ticket.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, ticket };
}

/** 持有者自己的個人頻道:使用者 `user:<id>`、代理程式 `print-agent:<id>`(連線後的初始訂閱)。 */
export function realtimeSelfTopic(ticket: RealtimeTicket): string {
  return ticket.userId === undefined
    ? printAgentTopic(ticket.agentId)
    : userTopic(ticket.userId);
}

/** 持有者識別:同一條連線換發憑證時,新舊憑證的租戶與持有者必須相同。 */
export function realtimeTicketHolder(ticket: RealtimeTicket): string {
  return `${ticket.tenantId}/${realtimeSelfTopic(ticket)}`;
}

/**
 * 這張憑證實際可訂閱的頻道:憑證列的頻道去重,**剔除別人的個人頻道**(`user:` / `print-agent:`
 * 只能是自己的;即使簽發端算錯也不放行),並一定包含自己的個人頻道。
 */
export function realtimeAllowedTopics(ticket: RealtimeTicket): string[] {
  const self = realtimeSelfTopic(ticket);
  const allowed = new Set<string>([self]);
  for (const topic of ticket.topics) {
    const personal =
      topic.startsWith("user:") || topic.startsWith("print-agent:");
    if (!personal || topic === self) {
      allowed.add(topic);
    }
  }
  return [...allowed];
}
