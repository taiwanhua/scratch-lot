import { HttpResponse } from "msw";

import { RoleKind } from "@repo/graphql";
import type {
  CreateRoleMutationVariables,
  DeleteRoleMutationVariables,
  GrantRoleUsersMutationVariables,
  RoleUserCandidatesQueryVariables,
  RoleUsersQueryVariables,
  RolesQueryVariables,
  SaveRoleMatrixMutationVariables,
  SetRoleEnabledMutationVariables,
  UpdateRoleMutationVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import type { TestOrgNode } from "./org-manager-handlers";
import {
  type TestCandidate,
  type TestMatrixModule,
  type TestRole,
  type TestRoleUser,
  candidates as defaultCandidates,
  roleUsers as defaultRoleUsers,
  roles as defaultRoles,
  grantedFixture,
  matrixModules,
  roleOrgTree,
} from "./role-fixtures";
import { api } from "./server";

/** 角色管理會回的業務錯誤碼(GQL-04;`graphqlError` 的型別只認 auth 那組,故轉型)。 */
export type RoleErrorCode =
  | AuthErrorCode
  | "ROLE_NOT_DELETABLE"
  | "ROLE_OUT_OF_REACH"
  | "USER_NOT_ELIGIBLE"
  | "OWNER_PROTECTED"
  | "NOT_FOUND";

export type RoleOperation =
  | "CreateRole"
  | "UpdateRole"
  | "SetRoleEnabled"
  | "DeleteRole"
  | "SaveRoleMatrix"
  | "GrantRoleUsers"
  | "RevokeRoleUsers";

export interface RoleFailure {
  code: RoleErrorCode;
  /** `ROLE_NOT_DELETABLE` 的前置檢查項(extensions.reasons) */
  reasons?: string[];
}

export interface RoleWorldOptions {
  roles?: TestRole[];
  modules?: TestMatrixModule[];
  granted?: { moduleKeys: string[]; permissionKeys: string[] };
  /** 租戶副本的矩陣只能縮不能擴 */
  shrinkOnly?: boolean;
  /**
   * 預設角色的天花板(#283):內建「租戶管理員」模板角色目前的授予。
   * 未給 = 不是預設角色(api 回 null),天花板那把鎖不作用。
   */
  ceiling?: { moduleKeys: string[]; permissionKeys: string[] } | null;
  users?: TestRoleUser[];
  /** 加入使用者彈窗的候選(`roleUserCandidates`;已持有的人由 handler 自動排除) */
  candidates?: TestCandidate[];
  orgTree?: TestOrgNode[];
  pageSize?: number;
  failures?: Partial<Record<RoleOperation, RoleFailure>>;
}

export interface RoleWorld {
  handlers: ReturnType<typeof api.query>[];
  /** 各操作收到的輸入(依序),用來斷言「送出去的是什麼」 */
  inputs: {
    roles: RolesQueryVariables["input"][];
    /** 持有人清單的查詢(驗頁碼有照網址送出) */
    roleUsers: RoleUsersQueryVariables[];
    createRole: CreateRoleMutationVariables["input"][];
    updateRole: UpdateRoleMutationVariables["input"][];
    setRoleEnabled: SetRoleEnabledMutationVariables["input"][];
    deleteRole: DeleteRoleMutationVariables["input"][];
    saveRoleMatrix: SaveRoleMatrixMutationVariables["input"][];
    grantRoleUsers: GrantRoleUsersMutationVariables["input"][];
    revokeRoleUsers: GrantRoleUsersMutationVariables["input"][];
    roleUserCandidates: RoleUserCandidatesQueryVariables["input"][];
  };
}

/**
 * 角色管理頁的假 api(#203 的端點 + 擁有組織下拉的 `orgTree` + 候選的 `roleUserCandidates`)。
 * 清單範圍照 api 的規則由伺服器決定,這裡只做關鍵字比對與分頁;
 * `grantRoleUsers` / `revokeRoleUsers` 會真的改動持有人清單,
 * 候選清單也跟著排除已持有的人(有狀態的假伺服器,TEST-08),讓畫面測得到結果。
 */
export const roleWorld = (options: RoleWorldOptions = {}): RoleWorld => {
  const {
    roles = defaultRoles,
    modules = matrixModules,
    granted = grantedFixture,
    shrinkOnly = false,
    ceiling = null,
    users = defaultRoleUsers,
    candidates = defaultCandidates,
    orgTree = roleOrgTree,
    pageSize = 10,
    failures = {},
  } = options;

  const roleList = [...roles];
  let holders = [...users];
  /** 儲存後的矩陣要留住(api 是整份覆蓋),否則重查又回到夾具的初始授予 */
  let currentGranted = granted;

  const inputs: RoleWorld["inputs"] = {
    roles: [],
    roleUsers: [],
    createRole: [],
    updateRole: [],
    setRoleEnabled: [],
    deleteRole: [],
    saveRoleMatrix: [],
    grantRoleUsers: [],
    revokeRoleUsers: [],
    roleUserCandidates: [],
  };

  const fail = (operation: RoleOperation) => {
    const failure = failures[operation];
    if (failure === undefined) {
      return null;
    }
    return graphqlError(
      failure.code as AuthErrorCode,
      failure.code,
      failure.reasons === undefined ? {} : { reasons: failure.reasons },
    );
  };

  const roleOf = (id: string): TestRole =>
    roleList.find((item) => item.id === id) ?? roleList[0];

  const matrixPayload = (roleId: string) => ({
    role: roleOf(roleId),
    shrinkOnly,
    ceiling,
    granted: currentGranted,
    modules,
  });

  const usersPayload = (roleId: string, page: number) => ({
    role: roleOf(roleId),
    totalCount: holders.length,
    page,
    pageSize,
    items: holders.slice((page - 1) * pageSize, page * pageSize),
  });

  const handlers = [
    api.query("OrgTree", () => HttpResponse.json({ data: { orgTree } })),
    api.query("RoleUserCandidates", ({ variables }) => {
      const { input } = variables as RoleUserCandidatesQueryVariables;
      inputs.roleUserCandidates.push(input);
      const needle = (input.keyword ?? "").toLowerCase();
      const matched = candidates.filter(
        (candidate) =>
          // 已持有這個角色的人不在候選裡(api 的規則,這裡照做才測得到加入後的變化)
          !holders.some((holder) => holder.id === candidate.id) &&
          (needle === "" ||
            candidate.name.toLowerCase().includes(needle) ||
            candidate.account.toLowerCase().includes(needle) ||
            candidate.email.toLowerCase().includes(needle)),
      );
      return HttpResponse.json({
        data: {
          roleUserCandidates: {
            totalCount: matched.length,
            page: 1,
            pageSize: input.pageSize ?? pageSize,
            items: matched,
          },
        },
      });
    }),
    api.query("Roles", ({ variables }) => {
      const { input } = variables as RolesQueryVariables;
      inputs.roles.push(input);
      const needle = (input.keyword ?? "").toLowerCase();
      const matched = roleList.filter(
        (item) =>
          needle === "" ||
          item.name.toLowerCase().includes(needle) ||
          (item.description ?? "").toLowerCase().includes(needle),
      );
      const size = input.pageSize ?? pageSize;
      const page = input.page ?? 1;
      return HttpResponse.json({
        data: {
          roles: {
            totalCount: matched.length,
            page,
            pageSize: size,
            items: matched.slice((page - 1) * size, page * size),
          },
        },
      });
    }),
    api.query("Role", ({ variables }) => {
      const { id } = variables as { id: string };
      return HttpResponse.json({ data: { role: { role: roleOf(id) } } });
    }),
    api.query("RoleMatrix", ({ variables }) => {
      const { roleId } = variables as { roleId: string };
      return HttpResponse.json({ data: { roleMatrix: matrixPayload(roleId) } });
    }),
    api.query("RoleUsers", ({ variables }) => {
      const { roleId, input } = variables as RoleUsersQueryVariables;
      inputs.roleUsers.push({ roleId, input });
      return HttpResponse.json({
        data: { roleUsers: usersPayload(roleId, input.page ?? 1) },
      });
    }),
    api.mutation("CreateRole", ({ variables }) => {
      const { input } = variables as CreateRoleMutationVariables;
      inputs.createRole.push(input);
      const ownerOrgId = input.ownerOrgId ?? "org-tenant";
      const created: TestRole = {
        id: "role-new",
        name: input.name,
        description: input.description ?? null,
        enabled: true,
        // 新建的一律是自建角色:四個動作全開(#261 的種類規則)
        kind: RoleKind.Custom,
        abilities: {
          canEdit: true,
          canEditMatrix: true,
          canToggleEnabled: true,
          canDelete: true,
        },
        isSystem: false,
        isTemplateCopy: false,
        userCount: 0,
        ownerOrg: {
          id: ownerOrgId,
          name: "租戶 A",
          tenantTop: { id: "org-tenant", name: "租戶 A" },
        },
      };
      if (failures.CreateRole === undefined) {
        roleList.push(created);
      }
      return (
        fail("CreateRole") ??
        HttpResponse.json({ data: { createRole: { role: created } } })
      );
    }),
    api.mutation("UpdateRole", ({ variables }) => {
      const { input } = variables as UpdateRoleMutationVariables;
      inputs.updateRole.push(input);
      const current = roleOf(input.id);
      return (
        fail("UpdateRole") ??
        HttpResponse.json({
          data: {
            updateRole: {
              role: {
                ...current,
                name: input.name ?? current.name,
                description: input.description ?? null,
              },
            },
          },
        })
      );
    }),
    api.mutation("SetRoleEnabled", ({ variables }) => {
      const { input } = variables as SetRoleEnabledMutationVariables;
      inputs.setRoleEnabled.push(input);
      const current = roleOf(input.id);
      return (
        fail("SetRoleEnabled") ??
        HttpResponse.json({
          data: {
            setRoleEnabled: { role: { ...current, enabled: input.enabled } },
          },
        })
      );
    }),
    api.mutation("DeleteRole", ({ variables }) => {
      const { input } = variables as DeleteRoleMutationVariables;
      inputs.deleteRole.push(input);
      return (
        fail("DeleteRole") ??
        HttpResponse.json({
          data: { deleteRole: { success: true, deletedId: input.id } },
        })
      );
    }),
    api.mutation("SaveRoleMatrix", ({ variables }) => {
      const { input } = variables as SaveRoleMatrixMutationVariables;
      inputs.saveRoleMatrix.push(input);
      const failure = fail("SaveRoleMatrix");
      if (failure !== null) {
        return failure;
      }
      // 整份覆蓋(api 會再 normalize 一次;測試直接收下送來的那份)
      currentGranted = {
        moduleKeys: input.moduleKeys,
        permissionKeys: input.permissionKeys,
      };
      return HttpResponse.json({
        data: { saveRoleMatrix: matrixPayload(input.roleId) },
      });
    }),
    api.mutation("GrantRoleUsers", ({ variables }) => {
      const { input } = variables as GrantRoleUsersMutationVariables;
      inputs.grantRoleUsers.push(input);
      const failure = fail("GrantRoleUsers");
      if (failure !== null) {
        return failure;
      }
      for (const userId of input.userIds) {
        const candidate = candidates.find((item) => item.id === userId);
        if (
          candidate !== undefined &&
          !holders.some((holder) => holder.id === userId)
        ) {
          holders.push({
            id: candidate.id,
            account: candidate.account,
            name: candidate.name,
            email: candidate.email,
            enabled: candidate.enabled,
            outOfScope: false,
            ownerProtected: false,
            orgs: candidate.orgs,
          });
        }
      }
      return HttpResponse.json({
        data: { grantRoleUsers: usersPayload(input.roleId, 1) },
      });
    }),
    api.mutation("RevokeRoleUsers", ({ variables }) => {
      const { input } = variables as GrantRoleUsersMutationVariables;
      inputs.revokeRoleUsers.push(input);
      const failure = fail("RevokeRoleUsers");
      if (failure !== null) {
        return failure;
      }
      holders = holders.filter((holder) => !input.userIds.includes(holder.id));
      return HttpResponse.json({
        data: { revokeRoleUsers: usersPayload(input.roleId, 1) },
      });
    }),
  ];

  return { handlers, inputs };
};
