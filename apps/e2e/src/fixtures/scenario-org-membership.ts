import {
  addOrgMembers,
  createRole,
  grantRoleUsers,
  roleMatrix,
  saveRoleMatrix,
} from "./api";
import type { ScenarioTenant } from "./scenario-tenant";

/**
 * 劇本 8 / 9 的共同前置:**多所屬組織的 +user** + **擁有組織不是租戶頂層的角色**。
 *
 * 「組織外」與 dry-run 的「失去資格」都是同一份判斷(`OrgQualificationService`):
 * 角色擁有組織的子樹 ∩ 使用者(移除後)剩餘的所屬組織 = 空集合。所以:
 * - +user 一定要**不只一個所屬組織** —— 最後一個不可移除(`LAST_ORG`);
 * - 角色的擁有組織一定要**不是**租戶頂層 —— 租戶頂層的子樹包住所有分店,移掉哪一個都還有支撐,
 *   `scenario-tenant.ts` 的「客服」(擁有組織 = 租戶A)因此永遠不會變成組織外。
 *
 * 與 `scenario-tenant.ts` 分開一支,理由同 `scenario-demo-items.ts`:其他劇本用不到。
 */

/** 讓 +user 同時屬南港店與內湖店(走組織管理「成員」分頁的那一支寫入)。 */
export async function addMemberToNeihu(tenant: ScenarioTenant): Promise<void> {
  await addOrgMembers(tenant.tenantAdmin.token, tenant.neihuOrgId, [
    tenant.member.userId,
  ]);
}

/**
 * +tenant 建一個擁有組織 = `ownerOrgId` 的角色,**權限矩陣照抄「客服」**(示範家族的四個動作),
 * 再指派給 +user。回傳角色 id。
 *
 * 照抄而不是另算一份:劇本 8 要證明「組織外的授予功能照常有效」,
 * 拿掉「客服」之後 +user 能進示範模組1,只能是靠這個角色。
 */
export async function grantMemberRoleOwnedBy(
  tenant: ScenarioTenant,
  name: string,
  ownerOrgId: string,
): Promise<string> {
  const token = tenant.tenantAdmin.token;
  const roleId = await createRole(token, name, ownerOrgId);
  const { granted } = await roleMatrix(token, tenant.supportRoleId);
  await saveRoleMatrix(token, {
    roleId,
    moduleKeys: granted.moduleKeys,
    permissionKeys: granted.permissionKeys,
  });
  await grantRoleUsers(token, roleId, [tenant.member.userId]);
  return roleId;
}
