import { HttpResponse } from "msw";

import {
  type AssignUserRolesMutationVariables,
  CopyUserOrgRolesMode,
  type CopyUserOrgRolesMutation,
  type CopyUserOrgRolesMutationVariables,
  type CreateUserMutationVariables,
  type OrgQuery,
  type OrgQueryVariables,
  type OrgTreeQuery,
  type RolesQueryVariables,
  type SetUserEnabledMutationVariables,
  type SetUserOrgsMutationVariables,
  type UpdateUserMutationVariables,
  type UserQuery,
  type UsersQueryVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import type { TestRole } from "./role-fixtures";
import { api } from "./server";

/** 測試夾具的一筆使用者 = `user(id)` 的完整形狀(清單投影掉細節欄位)。 */
export type TestUser = UserQuery["user"];
export type TestOrgNode = OrgTreeQuery["orgTree"][number];
export type TestOrg = OrgQuery["org"];

interface OrgNodeLike {
  id: string;
  children?: readonly OrgNodeLike[];
}

/** 組織子樹的 id 集合(清單範圍 = 選中組織的子樹,ADR-0005)。 */
const subtreeIds = (
  nodes: readonly OrgNodeLike[],
  orgId: string,
): Set<string> => {
  const collect = (node: OrgNodeLike): string[] => [
    node.id,
    ...(node.children ?? []).flatMap((child) => collect(child)),
  ];
  const find = (list: readonly OrgNodeLike[]): OrgNodeLike | null => {
    for (const node of list) {
      if (node.id === orgId) {
        return node;
      }
      const hit = find(node.children ?? []);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  };
  const root = find(nodes);
  return new Set(root === null ? [orgId] : collect(root));
};

/** 清單投影:`users` 只回這幾個欄位(`nationalId` 等細節只在 `user(id)`)。 */
const listItem = (user: TestUser) => ({
  id: user.id,
  account: user.account,
  name: user.name,
  email: user.email,
  enabled: user.enabled,
  orgs: user.orgs,
  roles: user.roles,
});

export interface UserWorldOptions {
  users?: TestUser[];
  orgTree?: TestOrgNode[];
  /**
   * `roles` query 的回應:指派角色彈窗的候選來源(正式的 `roles`,
   * 範圍 = 擁有組織在操作者管理範圍內;夾具型別與角色管理頁共用 `role-fixtures.ts`)。
   */
  roles?: TestRole[];
  /** `org(樹根 id)` 的回應:`parentId` 決定是不是根組織視角、`ownerUserId` 是受保護的擁有者 */
  rootOrg?: TestOrg;
  pageSize?: number;
  /** `setUserOrgs(dryRun: true)` 要回的失去資格清單 */
  dryRun?: {
    removedOrgs: { id: string; name: string }[];
    unqualifiedRoles: {
      roleId: string;
      roleName: string;
      ownerOrgId: string | null;
      ownerOrgName: string | null;
      reasons: string[];
      ownerProtected: boolean;
    }[];
  };
  /**
   * `copyUserOrgRoles` 額外要回的東西:擋下原因與「範圍外角色照樣保留」旗標。
   * 差異本身由 handler 依夾具的 orgs / roles 算(合併 / 取代),正式送出會改寫目標那一筆,
   * 之後重查清單看得到新值(有狀態的假伺服器,TEST-08)。
   */
  copy?: {
    blockers?: CopyUserOrgRolesResult["blockers"];
    outOfScopeKept?: boolean;
  };
  /** 指定某個 mutation 一律回某個錯誤碼(驗 OWNER_PROTECTED / ROLE_OUT_OF_REACH 的提示) */
  failures?: Partial<
    Record<
      | "CreateUser"
      | "UpdateUser"
      | "SetUserEnabled"
      | "SetUserOrgs"
      | "AssignUserRoles"
      | "CopyUserOrgRoles",
      | AuthErrorCode
      | "OWNER_PROTECTED"
      | "LAST_ORG"
      | "ROLE_OUT_OF_REACH"
      | "ROLE_DISABLED"
    >
  >;
}

type CopyUserOrgRolesResult = CopyUserOrgRolesMutation["copyUserOrgRoles"];

/** 以 id 比對的差異(合併:只加;取代:目標有、來源沒有的移除)。 */
const diffById = <T extends { id: string }>(
  target: readonly T[],
  source: readonly T[],
  isReplace: boolean,
) => {
  const has = (list: readonly T[], item: T) =>
    list.some((entry) => entry.id === item.id);
  const added = source.filter((item) => !has(target, item));
  const removed = isReplace ? target.filter((item) => !has(source, item)) : [];
  const kept = target.filter((item) => !has(removed, item));
  return { added, removed, kept };
};

/** 差異裡的角色只有 id / 名稱 / 擁有組織名稱(`CopyUserOrgRolesRole`)。 */
const copiedRoleOf = (role: TestUser["roles"][number]) => ({
  id: role.id,
  name: role.name,
  ownerOrgName: role.ownerOrgName ?? null,
});

export interface UserWorld {
  handlers: ReturnType<typeof api.query>[];
  /** 各操作收到的輸入(依序),用來斷言「送出去的是什麼」 */
  inputs: {
    users: UsersQueryVariables["input"][];
    roles: RolesQueryVariables["input"][];
    createUser: CreateUserMutationVariables["input"][];
    updateUser: UpdateUserMutationVariables["input"][];
    setUserEnabled: SetUserEnabledMutationVariables["input"][];
    setUserOrgs: SetUserOrgsMutationVariables["input"][];
    assignUserRoles: AssignUserRolesMutationVariables["input"][];
    copyUserOrgRoles: CopyUserOrgRolesMutationVariables["input"][];
  };
}

/**
 * 使用者管理頁的假 api(`users` / `user` / 五個 mutation + 組織管理的 `orgTree` / `org`)。
 * 清單範圍照 ADR-0005:給 `orgId` 就是該組織子樹,不給就是全部;關鍵字比對姓名與 Email。
 */
export const userWorld = (options: UserWorldOptions = {}): UserWorld => {
  const {
    users = [],
    orgTree = [],
    roles = [],
    rootOrg,
    pageSize = 10,
    dryRun = { removedOrgs: [], unqualifiedRoles: [] },
    copy = {},
    failures = {},
  } = options;
  /** 可被 `copyUserOrgRoles` 改寫的那一份(整筆換掉,不改夾具物件本身 —— 夾具跨測試共用) */
  const current = [...users];

  const inputs: UserWorld["inputs"] = {
    users: [],
    roles: [],
    createUser: [],
    updateUser: [],
    setUserEnabled: [],
    setUserOrgs: [],
    assignUserRoles: [],
    copyUserOrgRoles: [],
  };

  const fail = (operation: keyof typeof failures) => {
    const code = failures[operation];
    return code === undefined ? null : graphqlError(code as AuthErrorCode);
  };

  const handlers = [
    api.query("OrgTree", () => HttpResponse.json({ data: { orgTree } })),
    api.query("Org", ({ variables }) => {
      const { id } = variables as OrgQueryVariables;
      if (rootOrg === undefined) {
        return graphqlError("FORBIDDEN", "No org");
      }
      return HttpResponse.json({ data: { org: { ...rootOrg, id } } });
    }),
    api.query("Users", ({ variables }) => {
      const { input } = variables as UsersQueryVariables;
      inputs.users.push(input);
      const scope =
        input.orgId === null || input.orgId === undefined
          ? null
          : subtreeIds(orgTree, input.orgId);
      const needle = (input.keyword ?? "").toLowerCase();
      const matched = current.filter(
        (user) =>
          (scope === null || user.orgs.some((org) => scope.has(org.id))) &&
          (needle === "" ||
            user.name.toLowerCase().includes(needle) ||
            user.email.toLowerCase().includes(needle)),
      );
      const size = input.pageSize ?? pageSize;
      const page = input.page ?? 1;
      return HttpResponse.json({
        data: {
          users: {
            totalCount: matched.length,
            page,
            pageSize: size,
            items: matched
              .slice((page - 1) * size, page * size)
              .map((user) => listItem(user)),
          },
        },
      });
    }),
    api.query("Roles", ({ variables }) => {
      const { input } = variables as RolesQueryVariables;
      inputs.roles.push(input);
      return HttpResponse.json({
        data: {
          roles: {
            totalCount: roles.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? pageSize,
            items: roles,
          },
        },
      });
    }),
    api.query("User", ({ variables }) => {
      const { id } = variables as { id: string };
      const user = current.find((item) => item.id === id);
      return user === undefined
        ? graphqlError("FORBIDDEN", "No such user")
        : HttpResponse.json({ data: { user } });
    }),
    api.mutation("CreateUser", ({ variables }) => {
      const { input } = variables as CreateUserMutationVariables;
      inputs.createUser.push(input);
      return (
        fail("CreateUser") ??
        HttpResponse.json({
          data: {
            createUser: {
              user: {
                id: "user-new",
                account: input.account,
                email: input.email,
                mustChangePassword: input.activation.initialPassword !== null,
              },
            },
          },
        })
      );
    }),
    api.mutation("UpdateUser", ({ variables }) => {
      const { input } = variables as UpdateUserMutationVariables;
      inputs.updateUser.push(input);
      const current = users.find((item) => item.id === input.id);
      return (
        fail("UpdateUser") ??
        HttpResponse.json({
          data: { updateUser: { user: { ...current, ...input } } },
        })
      );
    }),
    api.mutation("SetUserEnabled", ({ variables }) => {
      const { input } = variables as SetUserEnabledMutationVariables;
      inputs.setUserEnabled.push(input);
      return (
        fail("SetUserEnabled") ??
        HttpResponse.json({
          data: {
            setUserEnabled: {
              user: { id: input.id, enabled: input.enabled },
            },
          },
        })
      );
    }),
    api.mutation("SetUserOrgs", ({ variables }) => {
      const { input } = variables as SetUserOrgsMutationVariables;
      inputs.setUserOrgs.push(input);
      const user = users.find((item) => item.id === input.userId);
      return (
        fail("SetUserOrgs") ??
        HttpResponse.json({
          data: {
            setUserOrgs: {
              user: {
                id: input.userId,
                orgs: user?.orgs ?? [],
                roles: user?.roles ?? [],
              },
              removedOrgs: dryRun.removedOrgs,
              unqualifiedRoles: dryRun.unqualifiedRoles,
              revokedRoleIds: [],
            },
          },
        })
      );
    }),
    api.mutation("AssignUserRoles", ({ variables }) => {
      const { input } = variables as AssignUserRolesMutationVariables;
      inputs.assignUserRoles.push(input);
      const user = users.find((item) => item.id === input.userId);
      return (
        fail("AssignUserRoles") ??
        HttpResponse.json({
          data: {
            assignUserRoles: {
              user: { id: input.userId, roles: user?.roles ?? [] },
            },
          },
        })
      );
    }),
    api.mutation("CopyUserOrgRoles", ({ variables }) => {
      const { input } = variables as CopyUserOrgRolesMutationVariables;
      inputs.copyUserOrgRoles.push(input);
      const failure = fail("CopyUserOrgRoles");
      if (failure !== null) {
        return failure;
      }
      const source = current.find((item) => item.id === input.sourceUserId);
      const targetIndex = current.findIndex(
        (item) => item.id === input.targetUserId,
      );
      const target = targetIndex === -1 ? undefined : current[targetIndex];
      if (source === undefined || target === undefined) {
        return graphqlError("FORBIDDEN", "No such user");
      }
      const isReplace = input.mode === CopyUserOrgRolesMode.Replace;
      const orgs = diffById(target.orgs, source.orgs, isReplace);
      const roles = diffById(target.roles, source.roles, isReplace);
      const blockers = copy.blockers ?? [];
      const hasChanges =
        orgs.added.length +
          orgs.removed.length +
          roles.added.length +
          roles.removed.length >
        0;
      const applied =
        input.dryRun === false && blockers.length === 0 && hasChanges;
      if (applied) {
        current[targetIndex] = {
          ...target,
          orgs: [...orgs.kept, ...orgs.added],
          roles: [...roles.kept, ...roles.added],
        };
      }
      const result: CopyUserOrgRolesResult = {
        user: { id: target.id },
        mode: input.mode,
        applied,
        orgs,
        roles: {
          added: roles.added.map((role) => copiedRoleOf(role)),
          removed: roles.removed.map((role) => copiedRoleOf(role)),
          kept: roles.kept.map((role) => copiedRoleOf(role)),
        },
        blockers,
        outOfScopeKept: copy.outOfScopeKept ?? false,
      };
      return HttpResponse.json({ data: { copyUserOrgRoles: result } });
    }),
  ];

  return { handlers, inputs };
};
