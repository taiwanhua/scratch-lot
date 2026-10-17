/**
 * `@repo/domain/realtime`:即時通道的訂閱憑證、頻道、信號與協定(底座規格第 4 章)。
 * api(簽發訂閱憑證、送出信號)與 `apps/realtime`(Worker + Durable Object)共用;
 * 只用 WebCrypto / `TextEncoder` / `btoa`,不依賴 Node,可在 V8 Worker 執行。
 */
export {
  REALTIME_FIELD_MAX_LENGTH,
  REALTIME_TOPIC_KINDS,
  type RealtimeSignal,
  type RealtimeTopicKind,
  boardTopic,
  isRealtimeId,
  isRealtimeSignal,
  isRealtimeTopic,
  printAgentTopic,
  userTopic,
} from "./topic";
export {
  REALTIME_TICKET_TTL_SECONDS,
  type RealtimeTicket,
  type RealtimeTicketRejection,
  type RealtimeTicketVerification,
  parseRealtimeTicket,
  realtimeAllowedTopics,
  realtimeSelfTopic,
  realtimeTicketHolder,
  signRealtimeTicket,
  verifyRealtimeTicket,
} from "./ticket";
export {
  REALTIME_CLOSE_CODES,
  REALTIME_PING,
  REALTIME_PONG,
  REALTIME_PUBLISH_BODY_MAX_LENGTH,
  REALTIME_PUBLISH_SIGNATURE_HEADER,
  type RealtimeClientMessage,
  type RealtimePublishRequest,
  type RealtimeRejectReason,
  type RealtimeServerMessage,
  isRealtimePublishRequest,
  parseRealtimeClientMessage,
  signRealtimePublish,
  verifyRealtimePublish,
} from "./protocol";
export {
  MIN_RENEW_DELAY_MS,
  REALTIME_PING_INTERVAL_MS,
  REALTIME_PONG_TIMEOUT_MS,
  RECONNECT_BACKOFF_MS,
  RENEW_BEFORE_MS,
} from "./timing";
