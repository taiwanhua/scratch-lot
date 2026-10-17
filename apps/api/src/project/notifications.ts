import type { ProjectNotificationRegistrations } from "../notifications/notification-registry.module";

/**
 * 專案登記的通知類型與連結(底座規格第 5 章;STRUCT-12 api 的固定入口之一,只由 `app.module.ts` 經
 * `NotificationRegistryModule.forRoot` 組裝)。key / refType 不可與底座重複;每種類型的每個管道
 * 自動成為個人偏好的一個開關(`notification_<類型>_<管道>`)。
 *
 * ```ts
 * types: [
 *   {
 *     key: "lottery.stocktake-reminder",
 *     name: "盤點提醒",
 *     defaultChannels: ["in-app"],
 *     canDisable: { "in-app": true },
 *     category: "responsible",
 *     orgScope: { ref: "event-org", range: "self" },
 *     defaultAudience: { mode: "match", filter: { field: "permission", cond: "in", value: { kind: "static", values: ["lottery.stocktake.edit"] } } },
 *     template: { "zh-TW": (params) => ({ title: "…", body: "…" }) },
 *   },
 * ],
 * links: [{ refType: "lottery-stocktake", path: "/lottery/stocktake/view-page/{refId}" }],
 * ```
 */
export const PROJECT_NOTIFICATIONS: ProjectNotificationRegistrations = {
  types: [],
  links: [],
};
