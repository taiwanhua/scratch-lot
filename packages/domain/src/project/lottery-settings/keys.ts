/**
 * 刮刮樂設定(`lottery-settings`)的模組 key 與權限 key(張數店規格第 4、12 節;權限表正本
 * `docs/modules/project/lottery-settings.md`)。seed 宣告、api 守門、admin 判斷都引用這裡,不另寫字面值。
 */
export const LOTTERY_SETTINGS_KEY = "lottery-settings";

/**
 * 個別權限(wildcard 由 seed 自動產生);分法同排班規則:
 * `edit-default` 改最上層組織的預設、`edit-org` 改其他組織(區域、分店)。
 */
export const LOTTERY_SETTINGS_PERMISSIONS = {
  view: `${LOTTERY_SETTINGS_KEY}.view`,
  editDefault: `${LOTTERY_SETTINGS_KEY}.edit-default`,
  editOrg: `${LOTTERY_SETTINGS_KEY}.edit-org`,
} as const;
