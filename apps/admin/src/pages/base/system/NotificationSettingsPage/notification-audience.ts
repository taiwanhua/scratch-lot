import type { AudienceField } from "@repo/domain/audience";

import type { AudienceOrgSourceOption } from "@/lib/base/audience-draft";

/**
 * 通知設定的人員條件只開放使用者 / 角色 / 權限(api `NOTIFICATION_AUDIENCE_OPTIONS`):
 * 不能「所有人」、沒有所屬組織欄 —— 組織範圍由通知類型宣告。
 */
export const NOTIFICATION_AUDIENCE_FIELDS: readonly AudienceField[] = [
  "user",
  "role",
  "permission",
];

/** 沒有所屬組織欄,所以也沒有組織來源。 */
export const NOTIFICATION_AUDIENCE_ORG_SOURCES: readonly AudienceOrgSourceOption[] =
  [];
