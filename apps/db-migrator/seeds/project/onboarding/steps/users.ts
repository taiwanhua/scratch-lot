import {
  type OnboardingContext,
  type OnboardingStep,
  requireBranchId,
  requireRoleId,
  requireTenant,
} from "../context";
import type { OnboardingUser } from "../plan";

const USERS = /* GraphQL */ `
  query OnboardingUsers($input: UsersInput!) {
    users(input: $input) {
      items {
        id
        account
        orgs {
          id
        }
        roles {
          id
        }
      }
    }
  }
`;

const CREATE_USER = /* GraphQL */ `
  mutation OnboardingCreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      user {
        id
      }
    }
  }
`;

const ADD_ORG_MEMBERS = /* GraphQL */ `
  mutation OnboardingAddOrgMembers($input: AddOrgMembersInput!) {
    addOrgMembers(input: $input) {
      addedUserIds
    }
  }
`;

const GRANT_ROLE_USERS = /* GraphQL */ `
  mutation OnboardingGrantRoleUsers($input: GrantRoleUsersInput!) {
    grantRoleUsers(input: $input) {
      totalCount
    }
  }
`;

interface UserRow {
  id: string;
  account: string;
  orgs: { id: string }[];
  roles: { id: string }[];
}

/** 這個人應屬的組織:分店 +(總部人員)租戶本身 +(總部是某家分店時)那家店。 */
function orgIdsOf(context: OnboardingContext, user: OnboardingUser): string[] {
  const { plan, state } = context;
  const ids = user.branches.map((name) => requireBranchId(state, name));
  if (user.headquarters) {
    ids.unshift(requireTenant(state).id);
    if (plan.headquartersBranch !== null) {
      ids.push(requireBranchId(state, plan.headquartersBranch));
    }
  }
  return [...new Set(ids)];
}

async function findUser(
  context: OnboardingContext,
  account: string,
): Promise<UserRow | null> {
  const { users } = await context.client.request<{
    users: { items: UserRow[] };
  }>(USERS, { input: { keyword: account, pageSize: 100 } });
  return users.items.find((row) => row.account === account) ?? null;
}

/**
 * 開通清單第 2 點:使用者與總部人員的所屬。
 * - 沒有這個帳號 → 建立(所屬組織與角色一起給;真實租戶寄啟用信,示範資料用示範密碼)
 * - 已有這個帳號 → **只補缺的**所屬組織與角色(`addOrgMembers` / `grantRoleUsers` 都只加不減);
 *   密碼、基本資料、租戶後來加的所屬與角色都不動
 */
export const usersStep: OnboardingStep = {
  key: "users",
  title: "使用者與所屬",
  run: async (context) => {
    const { client, plan, state, activation } = context;
    const lines: string[] = [];
    for (const user of plan.users) {
      const orgIds = orgIdsOf(context, user);
      const roleIds = user.roles.map((role) => requireRoleId(state, role));
      const existing = await findUser(context, user.account);
      if (existing === null) {
        await client.request(CREATE_USER, {
          input: {
            account: user.account,
            email: user.email,
            name: user.name,
            orgIds,
            roleIds,
            activation:
              activation.mode === "PASSWORD"
                ? { mode: "PASSWORD", initialPassword: activation.password }
                : { mode: "EMAIL" },
          },
        });
        lines.push(`建立「${user.name}」`);
        continue;
      }
      const hasOrg = new Set(existing.orgs.map((org) => org.id));
      const hasRole = new Set(existing.roles.map((role) => role.id));
      const missingOrgs = orgIds.filter((id) => !hasOrg.has(id));
      const missingRoles = roleIds.filter((id) => !hasRole.has(id));
      for (const orgId of missingOrgs) {
        await client.request(ADD_ORG_MEMBERS, {
          input: { orgId, userIds: [existing.id] },
        });
      }
      for (const roleId of missingRoles) {
        await client.request(GRANT_ROLE_USERS, {
          input: { roleId, userIds: [existing.id] },
        });
      }
      lines.push(
        missingOrgs.length + missingRoles.length === 0
          ? `「${user.name}」已存在`
          : `「${user.name}」已存在,補上 ${String(missingOrgs.length)} 個所屬組織、${String(missingRoles.length)} 個角色`,
      );
    }
    return lines.length === 0 ? ["沒有要建立的使用者"] : lines;
  },
};
