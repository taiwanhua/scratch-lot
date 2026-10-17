import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import {
  type RolesQueryVariables,
  useRoleMatrixQuery,
  useRoleUserCandidatesQuery,
  useRoleUsersQuery,
  useRolesQuery,
} from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

import { ROLE_MANAGER_PERMISSIONS } from "./role-manager-permissions";
import {
  ROLES_PAGE_SIZE,
  ROLE_USERS_PAGE_SIZE,
  ROLE_USER_CANDIDATES_PAGE_SIZE,
  type RoleActionAbility,
  type RoleRow,
} from "./role-manager-types";
import { useOwnerOrgOptions } from "./useOwnerOrgOptions";

/**
 * 左清單的篩選存在網址 `?list=`(REACT-14):搜尋、擁有組織(`""` = 全部)、頁碼;選中的角色在 `?detail=<id>`。
 */
const listSchema = z
  .object({
    keyword: z.string().default(""),
    ownerOrgId: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({ keyword: "", ownerOrgId: "", page: 1 });

/**
 * 角色管理頁的資料層:清單、搜尋、分頁、選中的角色與權限判斷(ADR-0011「頁內功能」)。
 *
 * 清單範圍由 api 決定(擁有組織在操作者管理範圍內,ADR-0003),前端不再過濾。
 * 選中的角色是**衍生**的:清單上找得到就用清單那一筆,否則退回第一筆 —
 * 換頁 / 搜尋後不必在 effect 內改 state(REACT-06)。
 */
export const useRoleManagerData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const ability: RoleActionAbility = {
    canView: hasPermission(ROLE_MANAGER_PERMISSIONS.view),
    canCreate: hasPermission(ROLE_MANAGER_PERMISSIONS.create),
    canEdit: hasPermission(ROLE_MANAGER_PERMISSIONS.edit),
    canEditMatrix: hasPermission(ROLE_MANAGER_PERMISSIONS.editMatrix),
    canAssignUsers: hasPermission(ROLE_MANAGER_PERMISSIONS.assignUsers),
    canToggleEnabled: hasPermission(ROLE_MANAGER_PERMISSIONS.toggleEnabled),
    canDelete: hasPermission(ROLE_MANAGER_PERMISSIONS.delete),
  };

  /** 擁有組織篩選 `ownerOrgId`:`""` = 全部(不送 `ownerOrgId`)。與搜尋框並存、兩者疊加。 */
  const [list, setList] = useUrlState("list", listSchema);
  const { keyword, ownerOrgId, page } = list;
  const [pickedRoleId, setPickedRoleId] = useUrlSelectedId();

  /** 下拉的候選 = 操作者的管理範圍(與新增角色的「擁有組織」同一份,#246 的 3)。 */
  const ownerOrgs = useOwnerOrgOptions();

  const rolesVariables = useMemo<RolesQueryVariables>(
    () => ({
      input: {
        page,
        pageSize: ROLES_PAGE_SIZE,
        keyword: keyword.trim() === "" ? null : keyword.trim(),
        ownerOrgId: ownerOrgId === "" ? null : ownerOrgId,
      },
    }),
    [page, keyword, ownerOrgId],
  );
  const roles = useRolesQuery(session.client, rolesVariables, {
    enabled: ability.canView,
  });

  const rows: readonly RoleRow[] = roles.data?.roles.items ?? [];
  const totalCount = roles.data?.roles.totalCount ?? 0;
  const selectedRole =
    rows.find((role) => role.id === pickedRoleId) ?? rows.at(0) ?? null;

  /** 換關鍵字回到第一頁(否則會停在一個不存在的頁碼上看到空清單)。 */
  const setKeyword = (value: string) => {
    setList((current) => ({ ...current, keyword: value, page: 1 }));
  };

  /** 換擁有組織同理回到第一頁。 */
  const setOwnerOrgId = (value: string) => {
    setList((current) => ({ ...current, ownerOrgId: value, page: 1 }));
  };
  const setPage = (value: number) => {
    setList((current) => ({ ...current, page: value }));
  };

  /** 寫入成功後精準失效(DATA-02 / 04):清單 + 被改到那筆角色的矩陣與持有人清單。 */
  const invalidate = async (roleId?: string) => {
    await queryClient.invalidateQueries({
      queryKey: useRolesQuery.getKey(rolesVariables),
    });
    if (roleId !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: useRoleMatrixQuery.getKey({ roleId }),
      });
      // RoleUsers 的 key 還帶分頁,取 codegen key 的第一段當前綴,一次掃掉各頁(DATA-02)
      await queryClient.invalidateQueries({
        queryKey: useRoleUsersQuery
          .getKey({
            roleId,
            input: { page: 1, pageSize: ROLE_USERS_PAGE_SIZE },
          })
          .slice(0, 1),
        exact: false,
      });
      // 候選清單要排除剛加進去的人(#246 的 4);key 帶關鍵字,同樣以第一段當前綴
      await queryClient.invalidateQueries({
        queryKey: useRoleUserCandidatesQuery
          .getKey({
            roleId,
            input: { page: 1, pageSize: ROLE_USER_CANDIDATES_PAGE_SIZE },
          })
          .slice(0, 1),
        exact: false,
      });
    }
  };

  return {
    ability,
    rows,
    totalCount,
    isLoading: roles.isLoading,
    keyword,
    setKeyword,
    ownerOrgId,
    setOwnerOrgId,
    ownerOrgOptions: ownerOrgs.options,
    page,
    setPage,
    selectedRole,
    selectRole: setPickedRoleId,
    invalidate,
  };
};
