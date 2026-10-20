import { GraphQLError } from "graphql";

/**
 * 側欄數字設定被拒的原因(`VALIDATION_FAILED` 的 `extensions.reason`;GQL-04)。
 * 語意見 `docs/modules/notification-settings.md`「側欄數字」。
 */
export const SIDEBAR_BADGE_SETTING_REJECT_REASONS = [
  /** 模組沒有登記側欄數字,或這個租戶沒有開通那個模組 */
  "UNKNOWN_BADGE",
  /** 人員條件格式不對(`extensions.path` 指到出錯的條件列) */
  "AUDIENCE_INVALID",
  /** 人員條件裡的使用者 / 角色不屬於本租戶(`extensions.path` 同上) */
  "OUT_OF_TENANT",
] as const;

export type SidebarBadgeSettingRejectReason =
  (typeof SIDEBAR_BADGE_SETTING_REJECT_REASONS)[number];

export function sidebarBadgeSettingRejected(
  reason: SidebarBadgeSettingRejectReason,
  moduleKey: string,
  path?: string,
): GraphQLError {
  return new GraphQLError(
    `Sidebar badge setting "${moduleKey}" rejected: ${reason}`,
    {
      extensions: {
        code: "VALIDATION_FAILED",
        reason,
        moduleKey,
        ...(path === undefined ? {} : { path }),
      },
    },
  );
}

/** 站在根組織時改側欄數字設定:設定屬租戶,`FORBIDDEN` + `reason: TENANT_ONLY`(同通知設定)。 */
export function sidebarBadgeSettingTenantOnly(): GraphQLError {
  return new GraphQLError(
    "Sidebar badge settings belong to a tenant; switch to a tenant org first",
    { extensions: { code: "FORBIDDEN", reason: "TENANT_ONLY" } },
  );
}
