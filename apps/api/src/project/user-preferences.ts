import type { UserPreferenceDefinition } from "../user-preferences/user-preference-registry";

/**
 * 專案登記的個人偏好(規格 10.6「登記制」;STRUCT-12 api 的固定入口之一,只由 `app.module.ts` 組裝)。
 * 每筆宣告 key、型別與預設值;key 不可與底座(`BASE_USER_PREFERENCES`)重複:
 *
 * ```ts
 * { key: "lotteryDefaultView", type: "string", defaultValue: "list", pattern: /^(list|grid)$/ }
 * ```
 *
 * 跟著裝置的設定(只影響這台電腦的畫面)不放這裡,存瀏覽器。
 */
export const PROJECT_USER_PREFERENCES: readonly UserPreferenceDefinition[] = [];
