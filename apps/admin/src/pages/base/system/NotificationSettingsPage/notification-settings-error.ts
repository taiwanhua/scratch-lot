import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 通知設定會收到的業務錯誤(GQL-04;api 正本 `apps/api/src/notifications/notifications-error.ts`)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 細分成三個碼、`FORBIDDEN` + `TENANT_ONLY` 細分成 `TENANT_ONLY`;
 * 認不出來的一律 `UNEXPECTED`。文案在 `admin.notificationSettings.errors.*`。
 */
export const NOTIFICATION_SETTINGS_ERROR_CODES = [
  "INVALID_AUDIENCE",
  "OUT_OF_TENANT",
  "UNKNOWN_TYPE",
  "TENANT_ONLY",
  "FORBIDDEN",
] as const;

export type NotificationSettingsErrorCode =
  (typeof NOTIFICATION_SETTINGS_ERROR_CODES)[number] | "UNEXPECTED";

const VALIDATION_REASONS = new Set([
  "INVALID_AUDIENCE",
  "OUT_OF_TENANT",
  "UNKNOWN_TYPE",
]);

/** `path`(人員條件裡出錯的位置)只在 `INVALID_AUDIENCE` / `OUT_OF_TENANT` 才有。 */
export type NotificationSettingsError =
  AdminError<NotificationSettingsErrorCode>;

export const notificationSettingsErrorOf = (
  error: unknown,
): NotificationSettingsError =>
  parseAdminError(error, {
    codes: NOTIFICATION_SETTINGS_ERROR_CODES,
    refine: (code, reason) => {
      if (code === "FORBIDDEN" && reason === "TENANT_ONLY") {
        return "TENANT_ONLY";
      }
      return code === "VALIDATION_FAILED" &&
        typeof reason === "string" &&
        VALIDATION_REASONS.has(reason)
        ? (reason as (typeof NOTIFICATION_SETTINGS_ERROR_CODES)[number])
        : undefined;
    },
  });
