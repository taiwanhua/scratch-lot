import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 側欄數字設定會收到的業務錯誤(GQL-04;api 正本 `apps/api/src/sidebar-badges/sidebar-badges-error.ts`)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 細分、`FORBIDDEN` + `TENANT_ONLY` 細分成 `TENANT_ONLY`;
 * 認不出來的一律 `UNEXPECTED`。文案在 `admin.sidebarBadgeSettings.errors.*`。
 */
export const SIDEBAR_BADGE_SETTINGS_ERROR_CODES = [
  "AUDIENCE_INVALID",
  "OUT_OF_TENANT",
  "UNKNOWN_BADGE",
  "TENANT_ONLY",
  "FORBIDDEN",
] as const;

export type SidebarBadgeSettingsErrorCode =
  (typeof SIDEBAR_BADGE_SETTINGS_ERROR_CODES)[number] | "UNEXPECTED";

const VALIDATION_REASONS = new Set([
  "AUDIENCE_INVALID",
  "OUT_OF_TENANT",
  "UNKNOWN_BADGE",
]);

/** `path` 只在 `AUDIENCE_INVALID` / `OUT_OF_TENANT`(人員條件裡出錯的位置)才有。 */
export type SidebarBadgeSettingsError =
  AdminError<SidebarBadgeSettingsErrorCode>;

export const sidebarBadgeSettingsErrorOf = (
  error: unknown,
): SidebarBadgeSettingsError =>
  parseAdminError(error, {
    codes: SIDEBAR_BADGE_SETTINGS_ERROR_CODES,
    refine: (code, reason) => {
      if (code === "FORBIDDEN" && reason === "TENANT_ONLY") {
        return "TENANT_ONLY";
      }
      return code === "VALIDATION_FAILED" &&
        typeof reason === "string" &&
        VALIDATION_REASONS.has(reason)
        ? (reason as (typeof SIDEBAR_BADGE_SETTINGS_ERROR_CODES)[number])
        : undefined;
    },
  });
