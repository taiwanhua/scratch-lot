import {
  addOrgMembers,
  createChildOrg,
  createDemoItemOne,
  createRole,
  grantRoleUsers,
  provisionTenant,
  revokeRoleUsers,
  roleMatrix,
  saveRoleMatrix,
  switchOrg,
  tenantModuleOptionKeys,
} from "./api";
import type { ScenarioTenant } from "./scenario-tenant";

/**
 * 劇本 14 的共同前置:**擁有組織各不相同的治理角色**。
 *
 * 管理範圍 = 持有的**啟用中角色**之擁有組織子樹的聯集(CONTEXT.md「管理範圍」)——
 * 算的是**全部**啟用中角色,不只帶治理權限的那幾個。所以 `scenario-tenant.ts` 的「客服」
 * (擁有組織 = 租戶頂層)只要還在 +user 身上,他的管理範圍就是整個租戶,
 * 「換成南港店的角色 → 樹根變南港店」看不出來 —— 要驗樹根的小節一律先 `dropSupportRole`。
 *
 * 角色的權限矩陣 = 「客服」那一份(示範家族,讓 +user 仍進得了示範模組1)∪ 指定的治理權限;
 * 寫法同 `scenario-org-membership.ts` 的 `grantMemberRoleOwnedBy`(那一支只照抄客服,沒有治理權限)。
 */

const SYSTEM_GROUP = "system";
export const ORG_MANAGER = "system.org-manager";
const USER_MANAGER = "system.user-manager";
const ROLE_MANAGER = "system.role-manager";

export const ORG_MANAGER_VIEW = `${ORG_MANAGER}.view`;
export const ORG_MANAGER_EDIT = `${ORG_MANAGER}.edit`;

/** 一組治理權限:要綁的模組(含上層群組)+ 權限 key。 */
export interface GovernanceGrant {
  moduleKeys: readonly string[];
  permissionKeys: readonly string[];
}

/**
 * 三個治理頁都進得去、組織管理整組動作都有(含搬移與可見性開關)。
 * `system.org-manager.*` 是同層 wildcard,**不含**根組織專屬的 `tenant-ops`(ADR-0004)。
 */
export const FULL_GOVERNANCE: GovernanceGrant = {
  moduleKeys: [SYSTEM_GROUP, ORG_MANAGER, USER_MANAGER, ROLE_MANAGER],
  permissionKeys: [
    `${ORG_MANAGER}.*`,
    `${USER_MANAGER}.view`,
    `${ROLE_MANAGER}.view`,
  ],
};

/** 只有組織管理的 `view`(劇本 14「可見性開關的權限搬家」最後一句的帳號)。 */
export const ORG_VIEW_ONLY: GovernanceGrant = {
  moduleKeys: [SYSTEM_GROUP, ORG_MANAGER],
  permissionKeys: [ORG_MANAGER_VIEW],
};

/** 整份覆蓋角色的矩陣 = 客服的示範家族 ∪ `governance`。 */
export async function setGovernanceMatrix(
  tenant: ScenarioTenant,
  roleId: string,
  governance: GovernanceGrant,
): Promise<void> {
  const token = tenant.tenantAdmin.token;
  const { granted } = await roleMatrix(token, tenant.supportRoleId);
  await saveRoleMatrix(token, {
    roleId,
    moduleKeys: [...new Set([...granted.moduleKeys, ...governance.moduleKeys])],
    permissionKeys: [
      ...new Set([...granted.permissionKeys, ...governance.permissionKeys]),
    ],
  });
}

/**
 * +tenant 建一個擁有組織 = `ownerOrgId` 的治理角色、指派給 +user,回傳角色 id。
 * 名稱由呼叫端給(角色清單上要認得出是哪一個)。
 */
export async function grantMemberGovernanceRole(
  tenant: ScenarioTenant,
  name: string,
  ownerOrgId: string,
  governance: GovernanceGrant = FULL_GOVERNANCE,
): Promise<string> {
  const token = tenant.tenantAdmin.token;
  const roleId = await createRole(token, name, ownerOrgId);
  await setGovernanceMatrix(tenant, roleId, governance);
  await grantRoleUsers(token, roleId, [tenant.member.userId]);
  return roleId;
}

/** 把「客服」從 +user 身上拿掉(它的擁有組織是租戶頂層,會把管理範圍撐成整個租戶)。 */
export async function dropSupportRole(tenant: ScenarioTenant): Promise<void> {
  await revokeRoleUsers(tenant.tenantAdmin.token, tenant.supportRoleId, [
    tenant.member.userId,
  ]);
}

export interface NangangWarehouse {
  orgId: string;
  name: string;
  /** +tenant 站在南港倉庫建的那一筆示範資料(開關 ON 時 +user 才看得到)。 */
  itemName: string;
}

/** 南港店底下的組織名稱(同一個租戶內分店名稱不重複,樹上以它定位)。 */
export const WAREHOUSE = "南港倉庫";

/**
 * 在南港店底下建「南港倉庫」,+tenant 暫時加入、站在那裡建一筆示範資料。
 *
 * 兩個用途:
 * - 可見性開關要看得出收縮,+user(只屬南港店)的可見範圍裡要有**下層組織的資料**(理由同劇本 12);
 * - 搬移候選要看得出「− 自己子樹」,南港店底下要有東西。
 */
export async function createNangangWarehouse(
  tenant: ScenarioTenant,
): Promise<NangangWarehouse> {
  const token = tenant.tenantAdmin.token;
  const orgId = await createChildOrg(token, tenant.nangangOrgId, WAREHOUSE);
  await addOrgMembers(token, orgId, [tenant.tenantAdmin.userId]);
  const itemName = `倉庫-他人-${tenant.slug}`;
  await createDemoItemOne(await switchOrg(token, orgId), { name: itemName });
  return { orgId, name: WAREHOUSE, itemName };
}

/**
 * root 另開一個租戶(「別的租戶」),回傳它的租戶頂層 id。
 * 只要它的組織存在就夠(驗的是 +tenant 對它送出 → `NOT_FOUND`),所以不走啟用信、不設密碼。
 */
export async function provisionOtherTenant(
  tenant: ScenarioTenant,
): Promise<string> {
  const account = `tenant-b-${tenant.slug}`;
  const { orgId } = await provisionTenant(tenant.rootToken, {
    name: `租戶B-${tenant.slug}`,
    // 租戶短碼要小寫英文開頭;場景字尾是隨機 hex,前面補固定字母
    slug: `tb_${tenant.slug}`,
    adminAccount: account,
    adminEmail: `${account}@cookhome.test`,
    moduleKeys: await tenantModuleOptionKeys(tenant.rootToken),
  });
  return orgId;
}
