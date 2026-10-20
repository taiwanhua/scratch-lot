import type { Types } from "mongoose";

import type { OrgsRepository } from "./database.module";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { systemTenantReader } from "./system-tenant-reader";

/**
 * **租戶邊界上下文**(ADR-0005「例外出口」):可見範圍與管理範圍 = 這個租戶的整棵組織樹,
 * 給「問的是整個租戶」的讀(反查、以人為準的資料)、登記過的例外寫入與排程。
 *
 * - 有操作者:`tenantId` 必須是他所屬的租戶(`memberTenants`;根組織成員除外),否則 `TenantScopeError`;
 *   回傳的上下文保留他的 `actorId`(基礎欄位與稽核記得是誰),其餘照租戶系統身分
 * - 沒有操作者(排程、系統重算):等同 `systemTenantReader(tenantId)`
 * - `tenantId = null`(根組織的資料,沒有租戶):只有根組織成員可用,直接回他自己的上下文(本來就看得到全部)
 *
 * 前提:用它讀寫的表**不是資料範圍目標**(系統身分沒有角色,對全員生效的規則照樣收窄,ADR-0008)。
 * 呼叫端登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`(附用途),`tenant-boundary-context.test.ts` 掃 src 鎖定;
 * `systemTenantReader` 只准經這裡呼叫。
 */
export async function tenantBoundaryContext(
  orgs: OrgsRepository,
  operator: OperatorContext | null,
  tenantId: Types.ObjectId | null,
): Promise<OperatorContext> {
  const isRoot = operator !== null && operator.visibleOrgIds === "all";
  if (tenantId === null) {
    if (operator !== null && isRoot) {
      return operator;
    }
    throw new TenantScopeError(
      "tenantBoundaryContext:沒有租戶的資料只有根組織可用",
    );
  }
  if (
    operator !== null &&
    !isRoot &&
    !operator.memberTenants.some((tenant) => tenant.tenantId.equals(tenantId))
  ) {
    throw new TenantScopeError(
      `tenantBoundaryContext:${String(tenantId)} 不是操作者所屬的租戶`,
    );
  }
  const reader = await systemTenantReader(orgs, tenantId);
  return operator === null ? reader : { ...reader, actorId: operator.actorId };
}

/** 用途分類(登記表的值;新增呼叫端前先確認屬於其中一種)。 */
export type TenantBoundaryContextPurpose =
  "反查" | "以人為準的資料" | "例外寫入" | "排程";

/**
 * **允許呼叫 `tenantBoundaryContext` 的檔案**(相對 `apps/api/src/`)與用途。新增前先在 ADR-0005
 * 「例外出口」那一列確認用途,再加進來;`tenant-boundary-context.test.ts` 掃 src 斷言。
 */
export const TENANT_BOUNDARY_CONTEXT_CALLERS: Readonly<
  Record<string, readonly TenantBoundaryContextPurpose[]>
> = {
  // 共同銷售人 / 已被對應的分店 / 關係人掛在哪些經銷商、看得到的經銷商的關聯列、對應分店是否在租戶;
  // 關係人取消身分時連帶解除看不到的經銷商上的關聯
  "project/lottery/dealers/dealer-links.service.ts": ["反查", "例外寫入"],
  // 對應分店的名稱(分店可能不在讀者的可見範圍)
  "project/lottery/dealers/dealer-view.service.ts": ["反查"],
  // 證照到期 / 牌租提醒逐租戶跑
  "project/lottery/dealers/dealer-reminders.service.ts": ["排程"],
  // 批購日重算(進貨單 / 經銷商在交易內呼叫,沒有操作者)
  "project/lottery/dealers/purchase-dates.ts": ["排程"],
  // 畫休屬於人、守門文件掛在租戶頂層:跨店讀寫
  "project/schedule/day-offs/schedule-day-offs.service.ts": ["以人為準的資料"],
  // 畫休開放 / 截止提醒逐租戶跑
  "project/schedule/day-offs/day-off-reminders.service.ts": ["排程"],
  // 候選使用者、排班檔案、可以排的分店關聯(以人為準,看不到的分店的關聯保留)
  "project/schedule/staff/schedule-staff.service.ts": ["以人為準的資料"],
};
