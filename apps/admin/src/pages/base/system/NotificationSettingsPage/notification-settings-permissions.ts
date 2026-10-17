/**
 * 通知設定的權限 key(正本 `docs/modules/notification-settings.md` 權限表;判斷走 ADR-0011「頁內功能」)。
 * 沒有 `edit` = 整頁唯讀(看得到類型、組織範圍與收件人,沒有 [編輯] / [還原預設])。
 */
export const NOTIFICATION_SETTINGS_MODULE_KEY = "system.notification-settings";

export const NOTIFICATION_SETTINGS_PERMISSIONS = {
  view: `${NOTIFICATION_SETTINGS_MODULE_KEY}.view`,
  edit: `${NOTIFICATION_SETTINGS_MODULE_KEY}.edit`,
} as const;
