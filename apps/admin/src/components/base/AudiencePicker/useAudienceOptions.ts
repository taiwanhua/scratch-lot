import { useMemo } from "react";

import type { AudienceField } from "@repo/domain/audience";
import {
  useAudiencePermissionOptionsQuery,
  useRolesQuery,
  useUsersQuery,
} from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import type { PermissionOptionModule } from "@/lib/base/permission-options";
import {
  type RoleMenuOption,
  roleMenuOptions,
  sortRolesByOwnerOrg,
} from "@/lib/base/role-options";

/**
 * 角色 / 使用者的候選借用角色管理、使用者管理的清單查詢,所以要各自的檢視權限;
 * 沒有時該欄的候選是空的(元件照常顯示,提示「沒有符合的對象」)。
 * 組織由 `OrgTreeSelect` 自己查 `orgTree`(只受管理範圍限制),權限樹 `audiencePermissionOptions`
 * 登入即可讀(回的就是操作者自己持有的那一份)。
 */
export const AUDIENCE_ROLE_VIEW_PERMISSION = "system.role-manager.view";

export const AUDIENCE_USER_VIEW_PERMISSION = "system.user-manager.view";

/** 選擇器的清單一次取滿(單一租戶內都是小清單,不做分頁;沿用資料範圍改版前的做法)。 */
const PICKER_PAGE = { page: 1, pageSize: 100 };

export interface AudienceUserOption {
  id: string;
  label: string;
}

export interface AudienceOptions {
  /** 依擁有組織排好序(同組織相鄰,`groupBy` 才不會重複標題) */
  roles: readonly RoleMenuOption[];
  users: readonly AudienceUserOption[];
  permissionModules: readonly PermissionOptionModule[];
  isPermissionsLoading: boolean;
  isPermissionsError: boolean;
}

/** AudiencePicker 的候選清單;只查這個使用處開放的欄位。 */
export const useAudienceOptions = (
  fields: readonly AudienceField[],
): AudienceOptions => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();

  const roles = useRolesQuery(
    session.client,
    { input: PICKER_PAGE },
    {
      enabled:
        fields.includes("role") && hasPermission(AUDIENCE_ROLE_VIEW_PERMISSION),
    },
  );
  const users = useUsersQuery(
    session.client,
    { input: PICKER_PAGE },
    {
      enabled:
        fields.includes("user") && hasPermission(AUDIENCE_USER_VIEW_PERMISSION),
    },
  );
  const permissions = useAudiencePermissionOptionsQuery(
    session.client,
    undefined,
    { enabled: fields.includes("permission") },
  );

  const roleOptions = useMemo(
    () => sortRolesByOwnerOrg(roleMenuOptions(roles.data?.roles.items ?? [])),
    [roles.data],
  );
  const userOptions = useMemo(
    () =>
      (users.data?.users.items ?? []).map((user) => ({
        id: user.id,
        label: `${user.name}(${user.account})`,
      })),
    [users.data],
  );

  return {
    roles: roleOptions,
    users: userOptions,
    permissionModules:
      permissions.data?.audiencePermissionOptions.modules ?? [],
    isPermissionsLoading: permissions.isLoading,
    isPermissionsError: permissions.isError,
  };
};
