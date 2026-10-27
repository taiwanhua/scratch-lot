import {
  DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS,
  SCHEDULE_ROSTER_COLUMNS_PATTERN,
  SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY,
} from "@repo/domain/project/schedule-settings";

import type { UserPreferenceDefinition } from "../user-preferences/user-preference-registry";

/**
 * 專案登記的個人偏好(STRUCT-12 api 的固定入口之一,只由 `app.module.ts` 組裝)。
 * 每筆宣告 key、型別與預設值;key 不可與底座(`BASE_USER_PREFERENCES`)重複:
 *
 * ```ts
 * { key: "lotteryDefaultView", type: "string", defaultValue: "list", pattern: /^(list|grid)$/ }
 * ```
 *
 * 跟著裝置的設定(只影響這台電腦的畫面)不放這裡,存瀏覽器。
 */
export const PROJECT_USER_PREFERENCES: readonly UserPreferenceDefinition[] = [
  // 排班表(班表檢視)[⚙ 顯示欄位]:統計欄 key 逗號分隔(規格 14.5;換一台裝置登入也一樣)
  {
    key: SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY,
    type: "string",
    defaultValue: DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS.join(","),
    pattern: SCHEDULE_ROSTER_COLUMNS_PATTERN,
    maxLength: 200,
  },
];
