import { type OnboardingStep } from "../context";
import { ROLE_GRANT_SECTIONS } from "../role-grants";
import {
  type ModuleRoleGrants,
  ONBOARDING_ROLES,
  type RoleGrant,
  roleGrantOf,
} from "../roles";

const ROLES = /* GraphQL */ `
  query OnboardingRoles($input: RolesInput!) {
    roles(input: $input) {
      items {
        id
        name
        kind
      }
    }
  }
`;

const CREATE_ROLE = /* GraphQL */ `
  mutation OnboardingCreateRole($input: CreateRoleInput!) {
    createRole(input: $input) {
      role {
        id
      }
    }
  }
`;

// 模組樹最深幾層:群組 → 模組 → 隱藏頁 → …(底座示範模組最深 4 層),多抓一層備用
const ROLE_MATRIX = /* GraphQL */ `
  fragment OnboardingMatrixNode on RoleMatrixModule {
    key
    permissions {
      key
    }
  }
  query OnboardingRoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      granted {
        moduleKeys
        permissionKeys
      }
      modules {
        ...OnboardingMatrixNode
        children {
          ...OnboardingMatrixNode
          children {
            ...OnboardingMatrixNode
            children {
              ...OnboardingMatrixNode
              children {
                ...OnboardingMatrixNode
              }
            }
          }
        }
      }
    }
  }
`;

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation OnboardingSaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      granted {
        moduleKeys
      }
    }
  }
`;

interface MatrixNode {
  key: string;
  permissions: { key: string }[];
  children?: MatrixNode[];
}

interface MatrixData {
  roleMatrix: {
    granted: { moduleKeys: string[]; permissionKeys: string[] };
    modules: MatrixNode[];
  };
}

/** 矩陣上看得到的模組與權限(= 這個租戶有開、租戶管理員授得出去的)。 */
function reachable(nodes: readonly MatrixNode[]): {
  modules: Set<string>;
  permissions: Set<string>;
} {
  const modules = new Set<string>();
  const permissions = new Set<string>();
  const visit = (list: readonly MatrixNode[]): void => {
    for (const node of list) {
      modules.add(node.key);
      // `*` 不一定以一筆權限列在矩陣上:模組看得到,它這一層的 `*` 就授得出去
      permissions.add(`${node.key}.*`);
      for (const permission of node.permissions) {
        permissions.add(permission.key);
      }
      visit(node.children ?? []);
    }
  };
  visit(nodes);
  return { modules, permissions };
}

/** 配方扣掉矩陣上沒有的(租戶沒開的模組),回傳要存的授予與被略過的 key。 */
export function grantWithin(
  grant: RoleGrant,
  nodes: readonly MatrixNode[],
): { grant: RoleGrant; skipped: string[] } {
  const { modules, permissions } = reachable(nodes);
  const moduleKeys = grant.moduleKeys.filter((key) => modules.has(key));
  const permissionKeys = grant.permissionKeys.filter((key) =>
    permissions.has(key),
  );
  const skipped = [
    ...grant.moduleKeys.filter((key) => !modules.has(key)),
    ...grant.permissionKeys.filter((key) => !permissions.has(key)),
  ];
  return { grant: { moduleKeys, permissionKeys }, skipped };
}

/** 找名稱完全相同的角色(租戶自己建的同名角色也算:沿用,不另建)。 */
async function findRoleId(
  client: Parameters<OnboardingStep["run"]>[0]["client"],
  name: string,
): Promise<string | null> {
  const { roles } = await client.request<{
    roles: { items: { id: string; name: string; kind: string }[] };
  }>(ROLES, { input: { keyword: name, pageSize: 100 } });
  const matches = roles.items.filter((role) => role.name === name);
  if (matches.length > 1) {
    throw new Error(
      `租戶裡有 ${String(matches.length)} 個名為「${name}」的角色,無法判斷是哪一個`,
    );
  }
  return matches[0]?.id ?? null;
}

/**
 * 開通清單第 4 點:建立總部管理、店長、店員(規格 3.3;一般角色,沒有「預設角色」標籤)。
 * - 沒有同名角色 → 建立,套用配方(`role-grants/`)
 * - 已有同名角色、而且已有任何權限 → 不覆蓋(租戶可能已自己調整過)
 * - 已有同名角色但一筆權限都沒有(例:上次建好角色後在存權限那一下失敗)→ 套用配方
 */
export function createRolesStep(
  sections: readonly ModuleRoleGrants[] = ROLE_GRANT_SECTIONS,
): OnboardingStep {
  return {
    key: "roles",
    title: "角色",
    run: async ({ client, state }) => {
      const lines: string[] = [];
      for (const role of ONBOARDING_ROLES) {
        let roleId = await findRoleId(client, role.name);
        const created = roleId === null;
        if (roleId === null) {
          const { createRole } = await client.request<{
            createRole: { role: { id: string } };
          }>(CREATE_ROLE, {
            input: { name: role.name, description: role.description },
          });
          roleId = createRole.role.id;
        }
        state.roleIds.set(role.key, roleId);

        const { roleMatrix } = await client.request<MatrixData>(ROLE_MATRIX, {
          roleId,
        });
        if (roleMatrix.granted.moduleKeys.length > 0) {
          lines.push(`「${role.name}」已存在,權限不覆蓋`);
          continue;
        }
        const { grant, skipped } = grantWithin(
          roleGrantOf(role.key, sections),
          roleMatrix.modules,
        );
        await client.request(SAVE_ROLE_MATRIX, {
          input: {
            roleId,
            moduleKeys: grant.moduleKeys,
            permissionKeys: grant.permissionKeys,
          },
        });
        lines.push(
          `${created ? "建立" : "補上權限"}「${role.name}」:${String(grant.moduleKeys.length)} 個模組、${String(grant.permissionKeys.length)} 筆權限`,
        );
        if (skipped.length > 0) {
          lines.push(`  略過(這個租戶沒有開放):${skipped.join("、")}`);
        }
      }
      return lines;
    },
  };
}

export const rolesStep: OnboardingStep = createRolesStep();
