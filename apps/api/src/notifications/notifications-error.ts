import { GraphQLError } from "graphql";

/**
 * 通知設定被拒的原因(`VALIDATION_FAILED` 的 `extensions.reason`;GQL-04「同一個 code 有多種說法時加 reason」)。
 * 語意見 `docs/modules/notification-settings.md`「錯誤」。
 */
export const NOTIFICATION_SETTING_REJECT_REASONS = [
  /** 類型沒有登記,或不是負責人提醒(當事人通知不在通知設定頁設定) */
  "UNKNOWN_TYPE",
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
