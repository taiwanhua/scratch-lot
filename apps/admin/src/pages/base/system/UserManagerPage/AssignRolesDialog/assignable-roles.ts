import type { RolesQuery } from "@repo/graphql";

import type { UserRoleGrant } from "../user-manager-types";

/** `roles` query 的一筆(擁有組織在操作者**管理範圍**內;role-manager.md「api 介面」)。 */
export type AssignableRole = RolesQuery["roles"]["items"][number];

/** 指派角色彈窗的一列。 */
export interface RoleOption {
  id: string;
  name: string;
  description: string | null;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  /** 角色本身已停用:持有者拿不到它的權限(ADR-0011 步驟 2),所以不給新勾 */
  enabled: boolean;
  /** 開通租戶時複製出來的副本(ADR-0009);列上掛一個標籤讓人分得出來 */
  isTemplateCopy: boolean;
  /** 目標使用者目前已持有 */
  isGranted: boolean;
  /** 不在操作者管理範圍內(只會是「對方已持有、我搆不到」的既有授予)→ 唯讀 */
  isOutOfReach: boolean;
  /** 已授予但使用者不在該角色擁有組織的子樹內(「組織外」) */
  isOutOfScope: boolean;
  /**
   * 這位使用者有沒有資格被授予這個角色(ADR-0003)。
   * 不合格的列**顯示但 disabled**、就地說明原因 —— 在此之前不合格的角色勾得下去,
   * 送出才吃到一句「資料未通過驗證」。判定正本仍在 api(`USER_NOT_ELIGIBLE`)。
   */
  isEligible: boolean;
  /** 分組用的租戶頂層(`ownerOrg.tenantTop`);根組織視角靠它分辨同名角色 */
  tenantTopId: string | null;
  tenantTopName: string | null;
}

/**
 * 清單 = `roles` query 回的角色(可勾)∪ 目標使用者已被授予的角色(管理範圍外的唯讀顯示)。
 *
 * 候選來自正式的 `roles` query —— 範圍是「擁有組織在操作者管理範圍內」,與 api 的
 * `assignUserRoles` 同一條判準(與 `grantRoleUsers` 統一;第 3 段「查操作者自己
 * 持有的角色」的過渡做法退場)。管理範圍外的既有授予仍要列出來:api 的全量覆蓋
 * 只作用在操作者觸及得到的角色上,列不出來的就不該被順手解除(user-manager.md
 * 「全量覆蓋的邊界」)。
 */
export const buildRoleOptions = (
  assignable: readonly AssignableRole[],
  targetRoles: readonly UserRoleGrant[],
  /** 目標使用者是否有資格被授予某個角色(`lib/base/role-eligibility.ts` 算好的查詢函式) */
  isEligible: (ownerOrgId: string | null) => boolean = () => true,
): RoleOption[] => {
  const grants = new Map(targetRoles.map((role) => [role.id, role]));
  const options = assignable.map<RoleOption>((role) => ({
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    ownerOrgId: role.ownerOrg?.id ?? null,
    ownerOrgName: role.ownerOrg?.name ?? null,
    enabled: role.enabled,
    isTemplateCopy: role.isTemplateCopy,
    isGranted: grants.has(role.id),
    isOutOfReach: false,
    isOutOfScope: grants.get(role.id)?.outOfScope ?? false,
    isEligible: isEligible(role.ownerOrg?.id ?? null),
    tenantTopId: role.ownerOrg?.tenantTop?.id ?? null,
    tenantTopName: role.ownerOrg?.tenantTop?.name ?? null,
  }));

  const reachable = new Set(assignable.map((role) => role.id));
  const outOfReach = targetRoles
    .filter((role) => !reachable.has(role.id))
    .map<RoleOption>((role) => ({
      id: role.id,
      name: role.name,
      description: null,
      ownerOrgId: role.ownerOrgId ?? null,
      ownerOrgName: role.ownerOrgName ?? null,
      // 搆不到的角色只從授予記錄得知,沒有 enabled / isTemplateCopy / 租戶頂層可言
      enabled: true,
      isTemplateCopy: false,
      isGranted: true,
      isOutOfReach: true,
      isOutOfScope: role.outOfScope,
      // 已持有的授予照常有效(ADR-0003「組織外」只標記不解除),不因資格而灰掉
      isEligible: true,
      tenantTopId: null,
      tenantTopName: null,
    }));

  return [...options, ...outOfReach];
};

/**
 * 這一列能不能被勾動:管理範圍外一律唯讀;**已停用的角色不可新勾**,
 * 但已經持有的還要能取消(不然停用的角色就永遠拔不掉了);
 * **沒有授予資格的不可新勾**,同理已持有的仍可取消。
 */
export const isRoleSelectable = (
  role: RoleOption,
  isChecked: boolean,
): boolean =>
  !role.isOutOfReach && ((role.enabled && role.isEligible) || isChecked);

/*
 * `ownerOrgOptions`(依擁有組織篩選的下拉)已退場:改用 Autocomplete 後,
 * 輸入組織名就能收斂到那一組,而分組標題已經把「哪些角色屬於誰」講清楚了。
 */
