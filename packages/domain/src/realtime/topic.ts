/**
 * 即時通道的頻道與信號。
 *
 * - 頻道是 Durable Object 內的分類標籤,格式 `<種類>:<編號>`;每個租戶一個 Durable Object,所以頻道名不含租戶。
 * - 信號只有類型與編號,不帶資料、不保存;收到信號的一方再用自己的身分向 API 拿資料。
 */

/** 頻道種類。`user:` / `print-agent:` 是個人頻道,只有本人(本代理程式)能訂閱。 */
export const REALTIME_TOPIC_KINDS = ["user", "print-agent", "board"] as const;
export type RealtimeTopicKind = (typeof REALTIME_TOPIC_KINDS)[number];

/** 頻道名稱與信號欄位的長度上限(信號只有幾十 byte,超過視為格式錯誤)。 */
export const REALTIME_FIELD_MAX_LENGTH = 128;

const TOPIC_PATTERN = /^(user|print-agent|board):[\w-]+$/;
/**
 * 信號類型:`<種類>` 或 `<種類>:<子類型>`;子類型可以是以 `.` 分段的 key(模組 key 如 `group.module`),
 * 每段是英數、底線、連字號,不能以 `.` 開頭、結尾或連續兩個 `.`。
 */
const SIGNAL_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?::[\w-]+(?:\.[\w-]+)*)?$/;
const ID_PATTERN = /^[\w-]+$/;

/** 租戶、使用者、代理程式與信號編號共用的識別格式(英數、底線、連字號,長度上限同上)。 */
export function isRealtimeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= REALTIME_FIELD_MAX_LENGTH &&
    ID_PATTERN.test(value)
  );
}

export function userTopic(userId: string): string {
  return `user:${userId}`;
}

export function printAgentTopic(agentId: string): string {
  return `print-agent:${agentId}`;
}

export function boardTopic(branchId: string): string {
  return `board:${branchId}`;
}

export function isRealtimeTopic(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= REALTIME_FIELD_MAX_LENGTH &&
    TOPIC_PATTERN.test(value)
  );
}

/**
 * 信號:只有類型(如 `notification`、`badge:<模組 key>`(模組 key 可帶 `.`)、`print-job`)與可選的編號。
 * 刻意沒有資料欄位 —— 資料一律向 API 拿,權限與可見範圍由 API 判斷。
 */
export interface RealtimeSignal {
  type: string;
  id?: string;
}

/** 只接受 `{ type, id? }`;多出任何欄位(例如夾帶資料)一律不是合法信號。 */
export function isRealtimeSignal(value: unknown): value is RealtimeSignal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "type" && key !== "id")) {
    return false;
  }
  const { type, id } = value as Record<string, unknown>;
  if (
    typeof type !== "string" ||
    type.length > REALTIME_FIELD_MAX_LENGTH ||
    !SIGNAL_TYPE_PATTERN.test(type)
  ) {
    return false;
  }
  return id === undefined || isRealtimeId(id);
}
