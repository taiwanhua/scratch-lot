import type { Types } from "mongoose";

import { DEFAULT_TENANT_TIMEZONE, isValidTimezone } from "@repo/domain/form";

import type { OrgsRepository } from "./database.module";
import type { OperatorContext } from "./operator-context";
import { tenantIdOfOrg } from "./tenant-id";

/**
 * 讀組織只取時區,不受操作者的管理範圍影響:時區是租戶的設定,不是「你管不管得到」的問題
 * (同 `OwnerProtectionService` 的 fail-closed 讀法)。
 */
function orgReader(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/**
 * **租戶時區**:租戶頂層的 `orgs.settings.timezone`;`tenantId = null`(根組織與它自己的資料)讀根組織的設定。
 * 沒設或不是 `Intl` 認得的時區 → `DEFAULT_TENANT_TIMEZONE`。
 *
 * 全系統「某一天」的換算都以它為準:表單引擎的 `ctx.timezone` 與日期欄、`me.currentOrg.timezone`、
 * 資料範圍規則的日期條件(`docs/concepts/form-engine.md`「值、計算與條件」)。
 */
export async function tenantTimezoneOf(
  orgs: OrgsRepository,
  operator: OperatorContext,
  tenantId: Types.ObjectId | null,
): Promise<string> {
  const reader = orgReader(operator);
  const rootOrTenant = tenantId
    ? await orgs.findById(reader, tenantId)
    : await orgs.findOne(reader, { parentId: null });
  return timezoneOfTenantSettings(rootOrTenant?.settings);
}

/**
 * 租戶頂層(或根組織)`settings` 裡的時區;沒設或不合法 → `DEFAULT_TENANT_TIMEZONE`。
 * 已經讀到組織文件的呼叫端(排程任務一次列出所有租戶)用它,判斷規則與 `tenantTimezoneOf` 同一份。
 */
export function timezoneOfTenantSettings(
  settings: Record<string, unknown> | undefined,
): string {
  const timezone: unknown = settings?.timezone;
  return isValidTimezone(timezone) ? timezone : DEFAULT_TENANT_TIMEZONE;
}

/** 某個組織所屬租戶的時區;組織讀不到 → 預設時區。 */
export async function tenantTimezoneOfOrg(
  orgs: OrgsRepository,
  operator: OperatorContext,
  orgId: Types.ObjectId,
): Promise<string> {
  const org = await orgs.findById(orgReader(operator), orgId);
  if (!org) {
    return DEFAULT_TENANT_TIMEZONE;
  }
  return tenantTimezoneOf(
    orgs,
    operator,
    tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors }),
  );
}
