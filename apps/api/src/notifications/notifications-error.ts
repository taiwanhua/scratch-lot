import { GraphQLError } from "graphql";

/**
 * 通知設定被拒的原因(`VALIDATION_FAILED` 的 `extensions.reason`;GQL-04「同一個 code 有多種說法時加 reason」)。
 * 語意見 `docs/modules/notification-settings.md`「錯誤」。
 */
export const NOTIFICATION_SETTING_REJECT_REASONS = [
  /** 類型沒有登記,或不在通知設定頁上(沒宣告可調時間的當事人通知) */
  "UNKNOWN_TYPE",
  /** 這個類型的收件人不能調整(當事人通知的收件人由事件決定)卻送了 `audience` / 要還原收件人 */
  "AUDIENCE_NOT_ADJUSTABLE",
  /** 這個類型沒有宣告可調時間卻送了 `schedule` / 要還原提醒時間 */
  "SCHEDULE_NOT_ADJUSTABLE",
  /** 提醒時間不合範圍或寫法(`extensions.path` 指到出錯的欄位,例 `daysBefore[2]`) */
  "SCHEDULE_INVALID",
  /** `audience` 與 `schedule` 都沒給(或都是 null) */
  "NOTHING_TO_UPDATE",
  /** 人員條件格式不對(`extensions.path` 指到出錯的條件列) */
  "AUDIENCE_INVALID",
  /** 人員條件裡的使用者 / 角色不屬於本租戶(`extensions.path` 同上) */
  "OUT_OF_TENANT",
] as const;

export type NotificationSettingRejectReason =
  (typeof NOTIFICATION_SETTING_REJECT_REASONS)[number];

export function notificationSettingRejected(
  reason: NotificationSettingRejectReason,
  type: string,
  path?: string,
): GraphQLError {
  return new GraphQLError(
    `Notification setting "${type}" rejected: ${reason}`,
    {
      extensions: {
        code: "VALIDATION_FAILED",
        reason,
        type,
        ...(path === undefined ? {} : { path }),
      },
    },
  );
}

/**
 * 站在根組織時改通知設定:通知設定屬租戶(根組織不是租戶),`FORBIDDEN` + `reason: TENANT_ONLY`。
 */
export function notificationSettingTenantOnly(): GraphQLError {
  return new GraphQLError(
    "Notification settings belong to a tenant; switch to a tenant org first",
    { extensions: { code: "FORBIDDEN", reason: "TENANT_ONLY" } },
  );
}
