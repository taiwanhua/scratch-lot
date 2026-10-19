import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { hash } from "@node-rs/argon2";
import { type Connection, Types } from "mongoose";

import {
  type MatrixModuleNode,
  type PermissionGrant,
  toggleWholeGroup,
} from "@repo/domain/permission";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createUser, findRootOrgId } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const TENANT_MODULE_OPTIONS = /* GraphQL */ `
  query TenantModuleOptions {
    tenantModuleOptions {
      key
    }
  }
`;

const PROVISION_TENANT = /* GraphQL */ `
  mutation ProvisionTenant($input: ProvisionTenantInput!) {
    provisionTenant(input: $input) {
      org {
        id
      }
      ownerUserId
      roleId
      moduleKeys
    }
  }
`;

const CREATE_ROLE = /* GraphQL */ `
  mutation CreateRole($input: CreateRoleInput!) {
    createRole(input: $input) {
      role {
        id
      }
    }
  }
`;

const ROLE_MATRIX = /* GraphQL */ `
  query RoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      modules {
        ...MatrixNode
        children {
          ...MatrixNode
          children {
            ...MatrixNode
            children {
              ...MatrixNode
            }
          }
        }
      }
    }
  }

  fragment MatrixNode on RoleMatrixModule {
    key
    permissions {
      key
    }
  }
`;

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation SaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      granted {
        moduleKeys
        permissionKeys
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface TenantModuleOptionsData {
  tenantModuleOptions: { key: string }[];
}

interface ProvisionTenantData {
  provisionTenant: {
    org: { id: string };
    ownerUserId: string;
    roleId: string;
    moduleKeys: string[];
  };
}

interface CreateRoleData {
  createRole: { role: { id: string } };
}

interface MatrixNode {
  key: string;
  permissions: { key: string }[];
  children?: MatrixNode[];
}

interface MatrixData {
  roleMatrix: { modules: MatrixNode[] };
}

interface SaveMatrixData {
  saveRoleMatrix: {
    granted: { moduleKeys: string[]; permissionKeys: string[] };
  };
}

const PASSWORD = ["tenant", "owner", "pass"].join("-");
const ORG_MANAGER_MODULE = "system.org-manager";
const TENANT_OPS_MODULE = "system.org-manager.tenant-ops";
const USER_MANAGER_MODULE = "system.user-manager";

/** 示範模組1 的三個隱藏頁與其父模組(本檔的操作對象)。 */
const SAMPLE_ONE = "demo.sub.sample-one";

/**
 * 驗收缺口:**租戶擁有者(持租戶管理員副本)**為自建角色勾示範家族權限被
 * `ROLE_OUT_OF_REACH` 誤擋。既有的 `role-matrix.test.ts` 用手工組的「租戶管理員型」操作者,
 * 少了開通流程這一段;本檔照驗收劇本走真的 `provisionTenant`(TEST-07,真 Nest + 真 MongoDB)。
 *
 * 劇本:root 開通租戶A(模組全勾,含示範群組)→ 租戶管理員副本的首任管理員登入
 * (currentOrg = 租戶頂層)→ 建 CUSTOM 角色(ownerOrg = 租戶A)→ 儲存權限矩陣。
 */
describe("權限矩陣:租戶擁有者為自建角色勾示範家族", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenantOrgId: string;
  let ownerToken: string;
  let displayTree: MatrixNode[];

  let accountSequence = 0;

  function nextAccount(prefix: string): string {
    accountSequence += 1;
    return `${prefix}-363-${String(accountSequence)}`;
  }

  async function login(account: string): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password: PASSWORD },
    });
    expect(result.errors).toBeUndefined();
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error(`登入失敗:${account}`);
    }
    return token;
  }

  async function newCustomRole(name: string): Promise<string> {
    const result = await api.graphql<CreateRoleData>(
      CREATE_ROLE,
      { input: { name, ownerOrgId: tenantOrgId } },
      { accessToken: ownerToken },
    );
    expect(result.errors).toBeUndefined();
    const id = result.data?.createRole.role.id;
    if (!id) {
      throw new Error(`建立角色失敗:${name}`);
    }
    return id;
  }

  async function save(
    roleId: string,
    grant: PermissionGrant,
  ): Promise<{ data: SaveMatrixData | null; code: string | undefined }> {
    const result = await api.graphql<SaveMatrixData>(
      SAVE_ROLE_MATRIX,
      {
        input: {
          roleId,
          moduleKeys: [...grant.moduleKeys],
          permissionKeys: [...grant.permissionKeys],
        },
      },
      { accessToken: ownerToken },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-role-matrix-tenant-owner");
    connection = api.connection;
    const rootOrgId = await findRootOrgId(connection);

    // root 端的租戶作業員(走真的 @RequirePermission,不是超級管理員)
    const rootOpsAccount = nextAccount("root-ops");
    const rootOpsId = await createUser(connection, {
      account: rootOpsAccount,
      password: PASSWORD,
      orgIds: [rootOrgId],
    });
    await createRole(api.app, connection, {
      name: "根組織 租戶作業員",
      ownerOrgId: rootOrgId,
      moduleKeys: [ORG_MANAGER_MODULE, TENANT_OPS_MODULE, USER_MANAGER_MODULE],
      permissionKeys: [
        `${ORG_MANAGER_MODULE}.*`,
        `${USER_MANAGER_MODULE}.*`,
        `${TENANT_OPS_MODULE}.provision`,
      ],
      assignTo: [rootOpsId],
    });
    const rootOpsToken = await login(rootOpsAccount);

    // 開通彈窗預設全勾:選項清單原樣送回(含示範群組與隱藏的 api 樹)
    const options = await api.graphql<TenantModuleOptionsData>(
      TENANT_MODULE_OPTIONS,
      {},
      { accessToken: rootOpsToken },
    );
    expect(options.errors).toBeUndefined();
    const moduleKeys = (options.data?.tenantModuleOptions ?? []).map(
      (option) => option.key,
    );
    expect(moduleKeys).toContain("demo");
    expect(moduleKeys).toContain(SAMPLE_ONE);

    const ownerAccount = nextAccount("tenant-admin");
    const provisioned = await api.graphql<ProvisionTenantData>(
      PROVISION_TENANT,
      {
        input: {
          name: "租戶A",
          // 短碼 `^[a-z][a-z0-9_]{1,19}$`:取帳號尾段(含流水號)才不會撞
          slug: `t${ownerAccount.replaceAll("-", "_").slice(-19)}`,
          adminAccount: ownerAccount,
          adminEmail: `${ownerAccount}@example.com`,
          logoPath: null,
          moduleKeys,
        },
      },
      { accessToken: rootOpsToken },
    );
    expect(provisioned.errors).toBeUndefined();
    const payload = provisioned.data?.provisionTenant;
    if (!payload) {
      throw new Error("開通租戶失敗");
    }
    tenantOrgId = payload.org.id;

    // 開通時不設可用密碼(由啟用信自訂);測試直接補一組可登入的雜湊
    await connection
      .collection("users")
      .updateOne(
        { _id: new Types.ObjectId(payload.ownerUserId) },
        { $set: { passwordHash: await hash(PASSWORD) } },
      );
    ownerToken = await login(ownerAccount);

    // 顯示樹(matrixTree):前端矩陣勾選的依據
    const probeRoleId = await newCustomRole("讀顯示樹用的角色");
    const matrix = await api.graphql<MatrixData>(
      ROLE_MATRIX,
      { roleId: probeRoleId },
      { accessToken: ownerToken },
    );
    expect(matrix.errors).toBeUndefined();
    displayTree = matrix.data?.roleMatrix.modules ?? [];
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("案一:dev 上被擋下的那份 input 原樣送出 → 存得起來", async () => {
    const roleId = await newCustomRole("客服(dev 原樣)");
    const { code } = await save(roleId, {
      moduleKeys: [
        "demo",
        "demo.sub",
        SAMPLE_ONE,
        `${SAMPLE_ONE}.view-page`,
        `${SAMPLE_ONE}.create-page`,
        `${SAMPLE_ONE}.edit-page`,
        "api",
      ],
      permissionKeys: [
        "demo.*",
        "demo.sub.*",
        `${SAMPLE_ONE}.create`,
        `${SAMPLE_ONE}.delete`,
        `${SAMPLE_ONE}.edit`,
        `${SAMPLE_ONE}.view`,
        `${SAMPLE_ONE}.view-page.*`,
        `${SAMPLE_ONE}.edit-page.*`,
        "api.*",
      ],
    });
    expect(code).toBeUndefined();
  });

  it("案二:對顯示樹按「全選整組」示範群組 → 存得起來", async () => {
    const roleId = await newCustomRole("客服(整組全選)");
    const grant = toggleWholeGroup(
      displayTree,
      { moduleKeys: [], permissionKeys: [] },
      "demo",
      true,
    );
    const { code } = await save(roleId, grant);
    expect(code).toBeUndefined();
  });

  it("案三:全選整組後再逐一取消四筆欄位級 / 頁面自有權限 → 存得起來", async () => {
    const roleId = await newCustomRole("客服(全選後取消)");
    const whole = toggleWholeGroup(
      displayTree,
      { moduleKeys: [], permissionKeys: [] },
      "demo",
      true,
    );
    // 使用者實際取消的四筆:兩筆欄位級(綁父模組)+ 兩筆頁面自有
    const dropped = new Set([
      `${SAMPLE_ONE}.show-internal-note`,
      `${SAMPLE_ONE}.edit-internal-note`,
      `${SAMPLE_ONE}.create-page.show-tips`,
      `${SAMPLE_ONE}.edit-page.show-history`,
    ]);
    // 取消個別權限 = 該層的 `*` 要拆成其餘個別鍵(前端 `expandGrant` 後的形狀)
    const expanded = expandForTree(displayTree, whole);
    const { code } = await save(roleId, {
      moduleKeys: expanded.moduleKeys,
      permissionKeys: expanded.permissionKeys.filter(
        (key) => !dropped.has(key),
      ),
    });
    expect(code).toBeUndefined();
  });

  /**
   * 真正的缺口:顯示樹上的模組**不保證**帶得出 `*` 列 ——
   * 操作者只是因為「勾下層補上層」而看得到那個群組(`normalizeGrant` 會把祖先模組補進
   * 有效權限集),但他手上沒有該層的 `<群組>.*`,所以那一列被顯示樹剪掉了。
   * 這正是 ADR-0009「既有租戶的副本不會自動拿到新模組」之後的常態:底座新增了中間群組,
   * 舊副本只綁著底下的葉模組。此時按「全選整組」會寫出一筆使用者在矩陣上**看不到也取消不了**
   * 的 `<群組>.*`,送出必吃 `ROLE_OUT_OF_REACH`。
   */
  describe("顯示樹上沒有 `*` 列的群組(既有副本沒跟上新群組)", () => {
    let legacyToken: string;
    let legacyTree: MatrixNode[];
    let legacyOrgId: string;

    beforeAll(async () => {
      const account = nextAccount("legacy-admin");
      const userId = await createUser(connection, {
        account,
        password: PASSWORD,
        orgIds: [new Types.ObjectId(tenantOrgId)],
      });
      // 舊副本的形狀:綁得到葉模組與它們的 `*`,但中間群組 `demo` / `demo.sub` 沒綁
      await createRole(api.app, connection, {
        name: "租戶管理員(舊副本)",
        ownerOrgId: new Types.ObjectId(tenantOrgId),
        moduleKeys: [
          "system",
          "system.role-manager",
          SAMPLE_ONE,
          `${SAMPLE_ONE}.view-page`,
          `${SAMPLE_ONE}.create-page`,
          `${SAMPLE_ONE}.edit-page`,
        ],
        permissionKeys: [
          "system.*",
          "system.role-manager.*",
          `${SAMPLE_ONE}.*`,
          `${SAMPLE_ONE}.view-page.*`,
          `${SAMPLE_ONE}.create-page.*`,
          `${SAMPLE_ONE}.edit-page.*`,
        ],
        assignTo: [userId],
      });
      legacyToken = await login(account);
      legacyOrgId = tenantOrgId;

      const probeResult = await api.graphql<CreateRoleData>(
        CREATE_ROLE,
        { input: { name: "舊副本:讀顯示樹", ownerOrgId: legacyOrgId } },
        { accessToken: legacyToken },
      );
      expect(probeResult.errors).toBeUndefined();
      const probeRoleId = probeResult.data?.createRole.role.id ?? "";
      const matrix = await api.graphql<MatrixData>(
        ROLE_MATRIX,
        { roleId: probeRoleId },
        { accessToken: legacyToken },
      );
      expect(matrix.errors).toBeUndefined();
      legacyTree = matrix.data?.roleMatrix.modules ?? [];
    }, HOOK_TIMEOUT_MS);

    it("顯示樹看得到 `demo` 群組,但那一層一列權限都沒有(`demo.*` 被剪掉)", () => {
      const demo = legacyTree.find((node) => node.key === "demo");
      expect(demo).toBeDefined();
      expect(demo?.permissions ?? []).toHaveLength(0);
    });

    it("對顯示樹按「全選整組」示範群組 → 存得起來(不該寫出取消不掉的 `demo.*`)", async () => {
      const roleResult = await api.graphql<CreateRoleData>(
        CREATE_ROLE,
        { input: { name: "客服(舊副本開的)", ownerOrgId: legacyOrgId } },
        { accessToken: legacyToken },
      );
      expect(roleResult.errors).toBeUndefined();
      const roleId = roleResult.data?.createRole.role.id ?? "";
      const grant = toggleWholeGroup(
        legacyTree,
        { moduleKeys: [], permissionKeys: [] },
        "demo",
        true,
      );
      const result = await api.graphql<SaveMatrixData>(
        SAVE_ROLE_MATRIX,
        {
          input: {
            roleId,
            moduleKeys: [...grant.moduleKeys],
            permissionKeys: [...grant.permissionKeys],
          },
        },
        { accessToken: legacyToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBeUndefined();
      // 「全選整組」不得寫出顯示樹上根本沒有、使用者也取消不掉的那一列
      expect(grant.permissionKeys).not.toContain("demo.*");
    });
  });
});

/** 把一份帶 `*` 的授予攤成「顯示樹上每一列」的形狀(模擬矩陣勾選的中間狀態)。 */
function expandForTree(
  tree: MatrixModuleNode[],
  grant: PermissionGrant,
): { moduleKeys: string[]; permissionKeys: string[] } {
  const wildcards = new Set(grant.permissionKeys);
  const moduleKeys: string[] = [];
  const permissionKeys: string[] = [];
  const visit = (nodes: readonly MatrixModuleNode[]): void => {
    for (const node of nodes) {
      moduleKeys.push(node.key);
      const hasWildcard = wildcards.has(`${node.key}.*`);
      for (const permission of node.permissions ?? []) {
        if (hasWildcard || wildcards.has(permission.key)) {
          permissionKeys.push(permission.key);
        }
      }
      visit(node.children ?? []);
    }
  };
  visit(tree);
  return { moduleKeys, permissionKeys };
}
