import { useUsersQuery } from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { USER_MANAGER_VIEW_PERMISSION } from "./org-manager-permissions";
import { OWNER_CANDIDATE_PAGE_SIZE, type OrgDetail } from "./org-manager-types";

/** 租戶頂層才有擁有者與可見範圍(api 對其餘組織一律回 null,`orgs/org-mapper.ts`)。 */
export const isTenantTop = (org: OrgDetail | undefined): boolean =>
  org !== undefined && org.visibility !== null;

/**
 * 租戶擁有者的名字與可轉移的候選人。
 *
 * `orgs` 只存 `ownerUserId`,要顯示名字就得查使用者 — 而 `users` 掛在
 * `system.user-manager.view` 底下。持有它的人才看得到名字與候選人清單;沒有的人
 * 擁有者欄位仍然出現(狀態是組織的事實),只是顯示不出是誰,轉移欄位也不給。
 *
 * 候選人限該租戶(`orgId` = 租戶頂層 → api 回該子樹 ∩ 可見範圍)且啟用中,與 api 的
 * 前置檢查同一條規則(`tenant-ops.service.ts`)。
 */
export const useTenantOwner = (org: OrgDetail | undefined) => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const isAvailable = hasPermission(USER_MANAGER_VIEW_PERMISSION);

  const users = useUsersQuery(
    session.client,
    {
      input: {
        orgId: org?.id ?? null,
        page: 1,
        pageSize: OWNER_CANDIDATE_PAGE_SIZE,
      },
    },
    { enabled: isAvailable && isTenantTop(org) },
  );

  const items = users.data?.users.items ?? [];
  const owner = items.find((item) => item.id === org?.ownerUserId);

  return {
    isAvailable,
    ownerName: owner?.name ?? null,
    /** 擁有者帳號(撤銷開通的確認清單要列出「會被抹掉的帳號」,#374)。 */
    ownerAccount: owner?.account ?? null,
    /**
     * 這個租戶的「租戶管理員」角色副本名稱:擁有者持有的角色中,擁有組織就是這個租戶頂層的那一筆
     * (開通時建的副本,ADR-0009 第 2 步)。同樣靠 `users` 那一支查詢,不為了一個名字再開端點。
     */
    tenantAdminRoleName:
      owner?.roles.find((role) => role.ownerOrgId === org?.id)?.name ?? null,
    candidates: items.filter((item) => item.enabled),
    isLoading: users.isLoading,
  };
};
