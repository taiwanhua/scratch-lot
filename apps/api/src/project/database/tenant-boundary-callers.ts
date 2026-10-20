import type { TenantBoundaryContextPurpose } from "../../database/tenant-boundary-purposes";

/**
 * 專案裡**允許呼叫租戶邊界出口(`BaseRepository.existsInTenant` / `findRefsInTenant`)的檔案**
 * (相對 `apps/api/src/`;規則與底座清單見 `database/base.repository.ts` 的 `TENANT_BOUNDARY_CALLERS`)。
 * `database/exists-any-callers.test.ts` 合併兩份清單掃整個 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_TENANT_BOUNDARY_CALLERS: readonly string[] = [
  "project/lottery/cash-points/cash-points.service.ts",
  "project/lottery/dealers/dealer-contacts.service.ts",
  "project/lottery/dealers/dealer-links.service.ts",
  "project/lottery/dealers/dealer-view.service.ts",
  "project/lottery/dealers/dealers.service.ts",
  "project/lottery/games/games.service.ts",
];

/**
 * 專案裡**允許呼叫 `tenantBoundaryContext` 的檔案**與用途(規則與底座清單見
 * `database/tenant-boundary-context.ts` 的 `TENANT_BOUNDARY_CONTEXT_CALLERS`)。
 * `database/tenant-boundary-context.test.ts` 合併兩份清單掃 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_TENANT_BOUNDARY_CONTEXT_CALLERS: Readonly<
  Record<string, readonly TenantBoundaryContextPurpose[]>
> = {
  // 共同銷售人 / 已被對應的分店 / 關係人掛在哪些經銷商、看得到的經銷商的關聯列、對應分店是否在租戶;
  // 關係人取消身分時連帶解除看不到的經銷商上的關聯
  "project/lottery/dealers/dealer-links.service.ts": ["反查", "例外寫入"],
  // 對應分店的名稱(分店可能不在讀者的可見範圍)
  "project/lottery/dealers/dealer-view.service.ts": ["反查"],
  // 證照到期 / 牌租提醒逐租戶跑
  "project/lottery/dealers/dealer-reminders.service.ts": ["排程"],
  // 批購日重算(進貨單 / 經銷商在交易內呼叫,沒有操作者;不是排程)
  "project/lottery/dealers/purchase-dates.ts": ["系統重算"],
  // 畫休屬於人、守門文件掛在租戶頂層:跨店讀寫
  "project/schedule/day-offs/schedule-day-offs.service.ts": ["以人為準的資料"],
  // 畫休開放 / 截止提醒逐租戶跑
  "project/schedule/day-offs/day-off-reminders.service.ts": ["排程"],
  // 候選使用者、排班檔案、可以排的分店關聯(以人為準,看不到的分店的關聯保留)
  "project/schedule/staff/schedule-staff.service.ts": ["以人為準的資料"],
};
