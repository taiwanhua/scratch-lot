import type { TenantBoundaryContextPurpose } from "../../database/tenant-boundary-purposes";

/**
 * 專案裡**允許呼叫租戶邊界出口(`BaseRepository.existsInTenant` / `findRefsInTenant`)的檔案**
 * (相對 `apps/api/src/`;規則與底座清單見 `database/base.repository.ts` 的 `TENANT_BOUNDARY_CALLERS`)。
 * `database/exists-any-callers.test.ts` 合併兩份清單掃整個 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_TENANT_BOUNDARY_CALLERS: readonly string[] = [
  "project/lottery/accounts/bank-accounts.service.ts",
  "project/lottery/cash-points/cash-points.service.ts",
  "project/lottery/dealers/dealer-contacts.service.ts",
  "project/lottery/dealers/dealer-links.service.ts",
  "project/lottery/dealers/dealer-view.service.ts",
  "project/lottery/dealers/dealers.service.ts",
  "project/lottery/games/games.service.ts",
  // 遊戲是否有本引用(整個租戶有沒有)、本編號租戶內唯一
  "project/lottery/tickets/book-game-usage.ts",
  "project/lottery/tickets/books.service.ts",
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
  // 張數帳本:跨店的寫入(調入、尋回到刷到的那家店)與換店後重算本的持有分店(要看整本的張)
  "project/lottery/tickets/ticket-ledger.service.ts": ["例外寫入", "系統重算"],
  // 本的即時計算要看整本的張(各分店持有)
  "project/lottery/tickets/books.service.ts": ["反查"],
  // 已給本數:出貨店也要算得出收貨店的(整個租戶的張數事件)
  "project/lottery/tickets/allocations.service.ts": ["反查"],
  // 遊戲是否有本引用:沒有操作者,問的是整個租戶
  "project/lottery/tickets/book-game-usage.ts": ["系統重算"],
  // 看得到帳戶 / 單據 / 交易,就看得到它掛的分店名稱與登記人(使用組織可能是讀者看不到的組織)
  "project/lottery/accounts/account-names.ts": ["反查"],
  // 看得到帳戶就看得到它的交易(交易可能是別家分店登記的);存入被沖正時連結的存銀行流水自動反向
  "project/lottery/accounts/bank-transactions.service.ts": ["反查", "例外寫入"],
  // 看得到單據就看得到它的收付(另一邊可能是別家分店記的)
  "project/lottery/settlement/settlement-ledger.ts": ["反查"],
  // 收付歷程、帳戶名稱、付款帳戶的使用組織比對分店的上層;沖正現金收付時寫在單據那一邊的分店
  "project/lottery/settlement/settlement.service.ts": ["反查", "例外寫入"],
};
