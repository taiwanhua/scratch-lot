import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password/password.service";
import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import {
  SAMPLE_ONE_MODULE_KEY,
  dataScopeTargetIdOf,
} from "../data-scope/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { MailService } from "../mail/mail.service";
import { RecordingMailService } from "../mail/recording-mail.service";
import { createRole } from "../permission/test-support/fixtures";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const SAVE_DATA_SCOPE_RULE = /* GraphQL */ `
  mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
    saveDataScopeRule(input: $input) {
      rule {
        collection
      }
    }
  }
`;

const TENANT_MODULE_OPTIONS = /* GraphQL */ `
  query TenantModuleOptions {
    tenantModuleOptions {
      id
      key
      name
      parentId
      sidebarType
      order
    }
  }
`;

const PROVISION_TENANT = /* GraphQL */ `
  mutation ProvisionTenant($input: ProvisionTenantInput!) {
    provisionTenant(input: $input) {
      org {
        id
        name
        parentId
        enabled
        ownerUserId
        visibility
        logoUrl
        slug
        isDemo
      }
      ownerUserId
      roleId
      moduleKeys
      activationMailSent
    }
  }
`;

const REVOKE_TENANT_PROVISION = /* GraphQL */ `
  mutation RevokeTenantProvision($input: RevokeTenantProvisionInput!) {
    revokeTenantProvision(input: $input) {
      success
      revokedOrgId
      revokedOwnerUserId
      revokedRoleId
    }
  }
`;

const TRANSFER_ORG_OWNER = /* GraphQL */ `
  mutation TransferOrgOwner($input: TransferOrgOwnerInput!) {
    transferOrgOwner(input: $input) {
      org {
        id
        ownerUserId
      }
    }
  }
`;

const SET_ORG_VISIBILITY = /* GraphQL */ `
  mutation SetOrgVisibility($input: SetOrgVisibilityInput!) {
    setOrgVisibility(input: $input) {
      org {
        id
        visibility
      }
    }
  }
`;

const ORG_TREE = /* GraphQL */ `
  fragment NodeFields on OrgNode {
    id
    outOfScope
    ownerUserId
  }
  query OrgTree {
    orgTree {
      ...NodeFields
      children {
        ...NodeFields
        children {
          ...NodeFields
        }
      }
    }
  }
`;

const USERS = /* GraphQL */ `
  query Users($input: UsersInput!) {
    users(input: $input) {
      totalCount
      items {
        id
        account
      }
    }
  }
`;

const SET_USER_ENABLED = /* GraphQL */ `
  mutation SetUserEnabled($input: SetUserEnabledInput!) {
    setUserEnabled(input: $input) {
      user {
        id
        enabled
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface ModuleOptionRow {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  sidebarType: string;
  order: number;
}

interface TenantModuleOptionsData {
  tenantModuleOptions: ModuleOptionRow[];
}

interface ProvisionTenantData {
  provisionTenant: {
    org: {
      id: string;
      name: string;
      parentId: string | null;
      enabled: boolean;
      ownerUserId: string | null;
      visibility: string | null;
      logoUrl: string | null;
      slug: string | null;
      isDemo: boolean;
    };
    ownerUserId: string;
    roleId: string;
    moduleKeys: string[];
    activationMailSent: boolean;
  };
}

interface RevokeTenantProvisionData {
  revokeTenantProvision: {
    success: boolean;
    revokedOrgId: string;
    revokedOwnerUserId: string | null;
    revokedRoleId: string | null;
  };
}

interface TransferOrgOwnerData {
  transferOrgOwner: { org: { id: string; ownerUserId: string | null } };
}

interface SetOrgVisibilityData {
  setOrgVisibility: { org: { id: string; visibility: string | null } };
}

interface TreeNode {
  id: string;
  outOfScope: boolean;
  ownerUserId: string | null;
  children?: TreeNode[];
}

interface OrgTreeData {
  orgTree: TreeNode[];
}

interface UsersData {
  users: { totalCount: number; items: { id: string; account: string }[] };
}

interface OrgRow {
  _id: Types.ObjectId;
  name: string;
  parentId: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  enabled: boolean;
  isSystem: boolean;
  logoPath?: string;
  ownerUserId?: Types.ObjectId;
  isDemo?: boolean;
  settings: Record<string, unknown>;
}

interface RoleRow {
  _id: Types.ObjectId;
  key?: string;
  name: string;
  enabled: boolean;
  isSystem: boolean;
  settings: Record<string, unknown>;
}

interface UserRow {
  _id: Types.ObjectId;
  account: string;
  email: string;
  name: string;
  enabled: boolean;
  passwordHash: string;
  settings: Record<string, unknown>;
}

interface ModuleRow {
  _id: Types.ObjectId;
  key: string;
}

interface PermissionRow {
  _id: Types.ObjectId;
  key: string;
}

interface AuditRow {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const PASSWORD = ["tenant", "ops", "pass"].join("-");
const LOGO_PATH = "org-logos/0c0f8f1e-2b3a-4c5d-8e9f-a0b1c2d3e4f5.png";
const ORG_MANAGER_MODULE = "system.org-manager";
const USER_MANAGER_MODULE = "system.user-manager";
const TENANT_OPS_MODULE = "system.org-manager.tenant-ops";
/** 根組織專屬模組(seed 標 isRootOnly,模板綁定時被扣除,ADR-0009 第 3 步)。 */
const ROOT_ONLY_MODULES = [
  TENANT_OPS_MODULE,
  "system.module-manager",
  "system.data-scope",
];
const TENANT_OPS_PERMISSIONS = [
  `${TENANT_OPS_MODULE}.provision`,
  `${TENANT_OPS_MODULE}.revoke-provision`,
  `${TENANT_OPS_MODULE}.transfer-owner`,
];

/** 字串排序的比較函式(`toSorted()` 不給比較函式在非 ASCII 下不可靠)。 */
function byText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hant");
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/**
 * 租戶作業(開通租戶 / 轉移擁有者 / 設定可見範圍),對真 Nest + 真 MongoDB(TEST-07)。
 * 夾具沿用 auth / permission 的 test-support;開通後的最終狀態一律回資料庫查,不信回傳值。
 *
 * 操作者:
 *   rootOps    根組織 + 三筆 tenant-ops 權限(正常路徑)
 *   rootView   根組織但只有 org-manager.view(驗 @RequirePermission)
 *   tenantOps  既有租戶 + 同樣三筆權限(驗「非根組織即使持權限也拒」)
 */
describe("租戶作業(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let mail: RecordingMailService;

  let rootOrgId: Types.ObjectId;
  let rootOpsId: Types.ObjectId;
  let rootOpsToken: string;
  let rootViewToken: string;

  /** 既有租戶(不是本檔開通出來的),用於轉移擁有者 / 可見範圍 */
  let legacyTenantId: Types.ObjectId;
  let legacyDeptId: Types.ObjectId;
  let legacySubDeptId: Types.ObjectId;
  let tenantOpsToken: string;
  /** 租戶內的使用者管理員(部門層,用來驗擁有者保護對象換人與可見範圍) */
  let tenantManagerToken: string;
  /** 只有 `system.user-manager.view`(完全沒有組織管理的權限);驗讀組織樹的多選一守門 */
  let userManagerOnlyToken: string;
  /** 有登入、完全沒有角色 */
  let nobodyToken: string;
  let legacyOwnerId: Types.ObjectId;
  let legacySuccessorId: Types.ObjectId;
  let subDeptUserId: Types.ObjectId;

  let accountSequence = 0;

  function nextAccount(prefix: string): string {
    accountSequence += 1;
    return `${prefix}-${String(accountSequence)}`;
  }

  /** 每次開通一個新的租戶短碼(`^[a-z][a-z0-9_]{1,19}$`、全域唯一)。 */
  function nextSlug(): string {
    accountSequence += 1;
    return `tenant_${String(accountSequence)}`;
  }

  async function login(account: string, password = PASSWORD): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password },
    });
    expect(result.errors).toBeUndefined();
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error(`登入失敗:${account}`);
    }
    return token;
  }

  function orgRow(id: string | Types.ObjectId): Promise<OrgRow | null> {
    return api.connection
      .collection("orgs")
      .findOne<OrgRow>({ _id: new Types.ObjectId(String(id)) });
  }

  function roleRow(id: string | Types.ObjectId): Promise<RoleRow | null> {
    return api.connection
      .collection("roles")
      .findOne<RoleRow>({ _id: new Types.ObjectId(String(id)) });
  }

  function userRow(id: string | Types.ObjectId): Promise<UserRow | null> {
    return api.connection
      .collection("users")
      .findOne<UserRow>({ _id: new Types.ObjectId(String(id)) });
  }

  function userRowByAccount(account: string): Promise<UserRow | null> {
    return api.connection.collection("users").findOne<UserRow>({ account });
  }

  /** 某個角色綁到的模組 key(role_module → modules.key)。 */
  async function boundModuleKeys(roleId: string): Promise<string[]> {
    const links = await api.connection
      .collection("core_relationships")
      .find<{ secondId: Types.ObjectId }>({
        type: "role_module",
        firstId: new Types.ObjectId(roleId),
      })
      .toArray();
    const modules = await api.connection
      .collection("modules")
      .find<ModuleRow>({ _id: { $in: links.map((link) => link.secondId) } })
      .toArray();
    return modules.map((module) => module.key).toSorted(byText);
  }

  /** 某個角色綁到的權限 key(role_permission → permissions.key)。 */
  async function boundPermissionKeys(roleId: string): Promise<string[]> {
    const links = await api.connection
      .collection("core_relationships")
      .find<{ secondId: Types.ObjectId }>({
        type: "role_permission",
        firstId: new Types.ObjectId(roleId),
      })
      .toArray();
    const permissions = await api.connection
      .collection("permissions")
      .find<PermissionRow>({
        _id: { $in: links.map((link) => link.secondId) },
      })
      .toArray();
    return permissions.map((permission) => permission.key).toSorted(byText);
  }

  function countLinks(
    type: string,
    firstId: string | Types.ObjectId,
    secondId: string | Types.ObjectId,
  ): Promise<number> {
    return api.connection.collection("core_relationships").countDocuments({
      type,
      firstId: new Types.ObjectId(String(firstId)),
      secondId: new Types.ObjectId(String(secondId)),
    });
  }

  function latestAudit(
    action: string,
    targetId: Types.ObjectId | string,
  ): Promise<AuditRow | null> {
    return api.connection
      .collection("audit_logs")
      .findOne<AuditRow>(
        { action, targetId: new Types.ObjectId(String(targetId)) },
        { sort: { createdAt: -1, _id: -1 } },
      );
  }

  /** 開通一個租戶(預設只開兩個治理模組),回傳 payload。 */
  async function provision(
    overrides: Partial<{
      name: string;
      slug: string;
      adminAccount: string;
      adminEmail: string;
      logoPath: string | null;
      moduleKeys: string[];
      demo: boolean;
      adminInitialPassword: string;
    }> = {},
    accessToken = rootOpsToken,
  ) {
    const account = overrides.adminAccount ?? nextAccount("tenant-admin");
    return api.graphql<ProvisionTenantData>(
      PROVISION_TENANT,
      {
        input: {
          ...(overrides.demo === undefined ? {} : { demo: overrides.demo }),
          ...(overrides.adminInitialPassword === undefined
            ? {}
            : { adminInitialPassword: overrides.adminInitialPassword }),
          name: overrides.name ?? `租戶 ${account}`,
          slug: overrides.slug ?? nextSlug(),
          adminAccount: account,
          adminEmail: overrides.adminEmail ?? `${account}@example.com`,
          logoPath: overrides.logoPath ?? null,
          moduleKeys: overrides.moduleKeys ?? [
            ORG_MANAGER_MODULE,
            USER_MANAGER_MODULE,
          ],
        },
      },
      { accessToken },
    );
  }

  /** 開通一個租戶並回帳號與 payload(撤銷開通的測試前置都從這裡開始)。 */
  async function provisionOne(prefix: string) {
    const account = nextAccount(prefix);
    const result = await provision({ adminAccount: account });
    expect(result.errors).toBeUndefined();
    const payload = result.data?.provisionTenant;
    if (!payload) {
      throw new Error("provisionTenant 沒有回 payload");
    }
    return { account, payload };
  }

  function revokeProvision(orgId: string, accessToken = rootOpsToken) {
    return api.graphql<RevokeTenantProvisionData>(
      REVOKE_TENANT_PROVISION,
      { input: { orgId } },
      { accessToken },
    );
  }

  /** 這幾個 id 身上還剩幾筆核心關聯(撤銷後應為 0,不留孤兒)。 */
  function linkCountOf(ids: string[]): Promise<number> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    return api.connection.collection("core_relationships").countDocuments({
      $or: [{ firstId: { $in: objectIds } }, { secondId: { $in: objectIds } }],
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-tenant-ops");
    const mailService = api.app.get(MailService);
    if (!(mailService instanceof RecordingMailService)) {
      throw new TypeError(
        "測試環境沒設 RESEND_API_KEY,MailService 應是記錄用 adapter",
      );
    }
    mail = mailService;

    rootOrgId = await findRootOrgId(api.connection);

    // 根組織 + 三筆租戶作業權限(不是超級管理員 — 要真的走 @RequirePermission)
    const rootOpsAccount = nextAccount("root-ops");
    rootOpsId = await createUser(api.connection, {
      account: rootOpsAccount,
      password: PASSWORD,
      orgIds: [rootOrgId],
    });
    await createRole(api.app, api.connection, {
      name: "根組織 租戶作業員",
      ownerOrgId: rootOrgId,
      moduleKeys: [ORG_MANAGER_MODULE, TENANT_OPS_MODULE, USER_MANAGER_MODULE],
      permissionKeys: [
        `${ORG_MANAGER_MODULE}.*`,
        `${USER_MANAGER_MODULE}.*`,
        ...TENANT_OPS_PERMISSIONS,
      ],
      assignTo: [rootOpsId],
    });
    rootOpsToken = await login(rootOpsAccount);

    // 根組織但沒有租戶作業權限
    const rootViewAccount = nextAccount("root-view");
    const rootViewId = await createUser(api.connection, {
      account: rootViewAccount,
      password: PASSWORD,
      orgIds: [rootOrgId],
    });
    await createRole(api.app, api.connection, {
      name: "根組織 唯讀",
      ownerOrgId: rootOrgId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.view`],
      assignTo: [rootViewId],
    });
    rootViewToken = await login(rootViewAccount);

    // 既有租戶:租戶頂層 > 部門 > 子部門
    legacyTenantId = await createOrg(api.connection, { name: "既有租戶" });
    legacyDeptId = await createOrg(api.connection, {
      name: "既有部門",
      parentId: legacyTenantId,
    });
    legacySubDeptId = await createOrg(api.connection, {
      name: "既有子部門",
      parentId: legacyDeptId,
    });

    // 租戶內持有同樣三筆權限的人(驗「非根組織即使持權限也拒」)
    const tenantOpsAccount = nextAccount("tenant-ops");
    const tenantOpsId = await createUser(api.connection, {
      account: tenantOpsAccount,
      password: PASSWORD,
      orgIds: [legacyTenantId],
    });
    await createRole(api.app, api.connection, {
      name: "租戶內 租戶作業員(不該生效)",
      ownerOrgId: legacyTenantId,
      moduleKeys: [ORG_MANAGER_MODULE, TENANT_OPS_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.*`, ...TENANT_OPS_PERMISSIONS],
      assignTo: [tenantOpsId],
    });
    tenantOpsToken = await login(tenantOpsAccount);

    // 既有租戶的擁有者與接任者:都掛在部門層,讓部門管理員(可見範圍 own)看得到 —
    // 擁有者保護要在「看得到、也有權限」的前提下才驗得出來(看不到只會得到 NOT_FOUND)
    legacyOwnerId = await createUser(api.connection, {
      account: nextAccount("legacy-owner"),
      password: PASSWORD,
      orgIds: [legacyDeptId],
    });
    legacySuccessorId = await createUser(api.connection, {
      account: nextAccount("legacy-successor"),
      password: PASSWORD,
      orgIds: [legacyDeptId],
    });
    subDeptUserId = await createUser(api.connection, {
      account: nextAccount("sub-dept-user"),
      password: PASSWORD,
      orgIds: [legacySubDeptId],
    });
    await api.connection
      .collection("orgs")
      .updateOne(
        { _id: legacyTenantId },
        { $set: { ownerUserId: legacyOwnerId } },
      );

    // 部門層的使用者管理員:驗擁有者保護對象換人,以及可見範圍開關的效果
    const tenantManagerAccount = nextAccount("tenant-manager");
    const tenantManagerId = await createUser(api.connection, {
      account: tenantManagerAccount,
      password: PASSWORD,
      orgIds: [legacyDeptId],
    });
    await createRole(api.app, api.connection, {
      name: "既有部門 使用者管理員",
      ownerOrgId: legacyDeptId,
      moduleKeys: [ORG_MANAGER_MODULE, USER_MANAGER_MODULE],
      permissionKeys: [
        `${ORG_MANAGER_MODULE}.view`,
        `${USER_MANAGER_MODULE}.*`,
      ],
      assignTo: [tenantManagerId],
    });
    tenantManagerToken = await login(tenantManagerAccount);

    // 只有使用者管理的檢視權(完全沒有組織管理的權限):使用者管理頁的左樹也要組織樹
    const userManagerOnlyAccount = nextAccount("user-manager-only");
    const userManagerOnlyId = await createUser(api.connection, {
      account: userManagerOnlyAccount,
      password: PASSWORD,
      orgIds: [legacyDeptId],
    });
    await createRole(api.app, api.connection, {
      name: "只有使用者管理檢視權",
      ownerOrgId: legacyDeptId,
      moduleKeys: [USER_MANAGER_MODULE],
      permissionKeys: [`${USER_MANAGER_MODULE}.view`],
      assignTo: [userManagerOnlyId],
    });
    userManagerOnlyToken = await login(userManagerOnlyAccount);

    // 有登入、完全沒有角色
    const nobodyAccount = nextAccount("nobody");
    await createUser(api.connection, {
      account: nobodyAccount,
      password: PASSWORD,
      orgIds: [legacyDeptId],
    });
    nobodyToken = await login(nobodyAccount);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("tenantModuleOptions:勾選清單 = 模板綁的模組", () => {
    it("回模板綁的模組,根組織專屬模組不在其中(isRootOnly 不落庫,判準是模板有沒有綁)", async () => {
      const result = await api.graphql<TenantModuleOptionsData>(
        TENANT_MODULE_OPTIONS,
        {},
        { accessToken: rootOpsToken },
      );

      expect(result.errors).toBeUndefined();
      const keys = (result.data?.tenantModuleOptions ?? []).map(
        (option) => option.key,
      );
      expect(keys).toEqual(
        expect.arrayContaining([
          "system",
          ORG_MANAGER_MODULE,
          USER_MANAGER_MODULE,
        ]),
      );
      for (const rootOnly of ROOT_ONLY_MODULES) {
        expect(keys).not.toContain(rootOnly);
      }
    });

    it("上層在清單內時給 parentId,前端據此組勾選樹", async () => {
      const result = await api.graphql<TenantModuleOptionsData>(
        TENANT_MODULE_OPTIONS,
        {},
        { accessToken: rootOpsToken },
      );

      const options = result.data?.tenantModuleOptions ?? [];
      const system = options.find((option) => option.key === "system");
      const orgManager = options.find(
        (option) => option.key === ORG_MANAGER_MODULE,
      );
      expect(system?.parentId).toBeNull();
      expect(orgManager?.parentId).toBe(system?.id);
    });

    it("非根組織的操作者即使持有權限也拒(FORBIDDEN)", async () => {
      const result = await api.graphql(
        TENANT_MODULE_OPTIONS,
        {},
        { accessToken: tenantOpsToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("orgTree / org:讀取權限多選一與 OrgNode.ownerUserId", () => {
    it("只有 system.user-manager.view 也讀得到組織樹與單筆組織", async () => {
      const tree = await api.graphql<OrgTreeData>(
        ORG_TREE,
        {},
        { accessToken: userManagerOnlyToken },
      );
      expect(tree.errors).toBeUndefined();
      expect(
        flatten(tree.data?.orgTree ?? []).map((node) => node.id),
      ).toContain(String(legacyDeptId));

      const one = await api.graphql(
        /* GraphQL */ `
          query Org($id: ID!) {
            org(id: $id) {
              id
              name
            }
          }
        `,
        { id: String(legacyDeptId) },
        { accessToken: userManagerOnlyToken },
      );
      expect(one.errors).toBeUndefined();
    });

    it("兩個檢視權都沒有:FORBIDDEN(多選一不是不設防)", async () => {
      const result = await api.graphql(
        ORG_TREE,
        {},
        { accessToken: nobodyToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("樹上租戶頂層帶 ownerUserId,子組織為 null(前端不必逐筆查 org(id))", async () => {
      const tree = await api.graphql<OrgTreeData>(
        ORG_TREE,
        {},
        { accessToken: rootOpsToken },
      );

      expect(tree.errors).toBeUndefined();
      const nodes = flatten(tree.data?.orgTree ?? []);
      const tenantTop = nodes.find(
        (node) => node.id === String(legacyTenantId),
      );
      const dept = nodes.find((node) => node.id === String(legacyDeptId));
      expect(tenantTop?.ownerUserId).toBe(String(legacyOwnerId));
      expect(dept?.ownerUserId).toBeNull();
    });
  });

  describe("provisionTenant:ADR-0009 四步 + 擁有者 + 啟用信", () => {
    it("開通後資料五件齊:租戶 Org、角色副本、首任管理員、兩組關聯、ownerUserId", async () => {
      const account = nextAccount("five-pieces");
      const before = mail.sent.length;
      const result = await provision({
        name: "五件齊租戶",
        slug: "five_pieces",
        adminAccount: account,
        adminEmail: `${account}@example.com`,
        logoPath: LOGO_PATH,
      });

      expect(result.errors).toBeUndefined();
      const payload = result.data?.provisionTenant;
      expect(payload?.activationMailSent).toBe(true);
      if (!payload) {
        throw new Error("provisionTenant 沒有回 payload");
      }

      // 1. 租戶 Org = 根組織的直接子組織
      const org = await orgRow(payload.org.id);
      expect(org).toMatchObject({
        name: "五件齊租戶",
        enabled: true,
        isSystem: false,
        logoPath: LOGO_PATH,
      });
      expect(String(org?.parentId)).toBe(String(rootOrgId));
      expect(org?.ancestors.map(String)).toEqual([String(rootOrgId)]);

      // 2. 角色副本:沒有 key,以 settings.templateKey 標記來源(ADR-0009,使用者管理的擁有者保護靠它)
      const role = await roleRow(payload.roleId);
      expect(role?.key).toBeUndefined();
      expect(role?.isSystem).toBe(false);
      expect(role?.settings.templateKey).toBe("tenant-admin");
      expect(await countLinks("org_role", payload.org.id, payload.roleId)).toBe(
        1,
      );

      // 3. 首任管理員:不設可用密碼、不需首登強改(由啟用信自行設定)
      const user = await userRow(payload.ownerUserId);
      expect(user).toMatchObject({
        account,
        email: `${account}@example.com`,
        enabled: true,
      });
      expect(user?.settings.mustChangePassword).toBe(false);

      // 4. 兩組關聯
      expect(
        await countLinks("org_user", payload.org.id, payload.ownerUserId),
      ).toBe(1);
      expect(
        await countLinks("user_role", payload.ownerUserId, payload.roleId),
      ).toBe(1);

      // 5. 擁有者
      expect(String(org?.ownerUserId)).toBe(payload.ownerUserId);
      expect(payload.org.ownerUserId).toBe(payload.ownerUserId);
      // 可見範圍未設 ⇒ 保守預設 OWN(ADR-0005)
      expect(payload.org.visibility).toBe("OWN");
      expect(payload.org.logoUrl).toEqual(expect.stringContaining(LOGO_PATH));

      // 啟用信寄到首任管理員的 Email,連結是「設定新密碼」頁
      const sent = mail.sent.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        kind: "activation",
        to: `${account}@example.com`,
      });
      expect(sent[0]?.link).toContain("/set-password?token=");

      // 審計
      const audit = await latestAudit("org.provision", payload.org.id);
      expect(audit?.targetType).toBe("org");
      expect(audit?.after).toMatchObject({
        name: "五件齊租戶",
        adminAccount: account,
        ownerUserId: payload.ownerUserId,
      });
    });

    it("租戶短碼:落庫到租戶頂層並回在 org.slug;格式不符、已被用都是 VALIDATION_FAILED 並標 slug 欄", async () => {
      const created = await provision({ slug: "slug_owner" });
      expect(created.errors).toBeUndefined();
      expect(created.data?.provisionTenant.org.slug).toBe("slug_owner");

      for (const bad of ["Bad", "1abc", "a", "has-dash", "a".repeat(21)]) {
        const result = await provision({ slug: bad });
        expect({ bad, error: result.errors?.[0]?.extensions }).toEqual({
          bad,
          error: expect.objectContaining({
            code: "VALIDATION_FAILED",
            fields: ["slug"],
          }),
        });
      }

      const taken = await provision({ slug: "slug_owner" });
      expect(taken.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["slug"],
      });
    });

    it("副本只綁勾選的模組 + 各該模組的 `*`,沒勾的模組一筆都沒有", async () => {
      const result = await provision({
        moduleKeys: [ORG_MANAGER_MODULE, USER_MANAGER_MODULE],
      });

      expect(result.errors).toBeUndefined();
      const payload = result.data?.provisionTenant;
      if (!payload) {
        throw new Error("provisionTenant 沒有回 payload");
      }
      // 上層 `system` 自動補上(勾下層必連動勾上層,ADR-0004),示範家族沒勾就完全沒有
      const expectedModules = [
        "system",
        ORG_MANAGER_MODULE,
        USER_MANAGER_MODULE,
      ].toSorted(byText);
      expect(await boundModuleKeys(payload.roleId)).toEqual(expectedModules);
      expect(payload.moduleKeys.toSorted(byText)).toEqual(expectedModules);
      // role_permission 與 role_module 一一對應:每個綁定的模組各一筆該模組的 `*`(ADR-0004)
      expect(await boundPermissionKeys(payload.roleId)).toEqual(
        [
          "system.*",
          `${ORG_MANAGER_MODULE}.*`,
          `${USER_MANAGER_MODULE}.*`,
        ].toSorted(byText),
      );
    });

    it("首任管理員真的能用啟用信設定密碼並登入(整條線接得起來)", async () => {
      const account = nextAccount("activation-flow");
      const before = mail.sent.length;
      const result = await provision({ adminAccount: account });
      expect(result.errors).toBeUndefined();

      const link = mail.sent.slice(before)[0]?.link ?? "";
      const token = new URL(link).searchParams.get("token");
      expect(token).not.toBeNull();

      const newPassword = ["set", "by", "owner", "7"].join("-");
      const set = await api.graphql(
        /* GraphQL */ `
          mutation SetPassword($input: SetPasswordInput!) {
            setPassword(input: $input) {
              accessToken
            }
          }
        `,
        { input: { token, newPassword } },
      );
      expect(set.errors).toBeUndefined();
      expect(await login(account, newPassword)).toEqual(expect.any(String));
    });

    it("勾到根組織專屬模組:不在選項內,VALIDATION_FAILED", async () => {
      const result = await provision({
        moduleKeys: [ORG_MANAGER_MODULE, TENANT_OPS_MODULE],
      });

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        fields: ["moduleKeys"],
      });
    });

    it("一個模組都沒勾:VALIDATION_FAILED(沒有模組的租戶管理員進不了任何頁面)", async () => {
      const result = await provision({ moduleKeys: [] });

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    });

    it("帳號或 Email 已被使用:VALIDATION_FAILED 並指出是哪一欄", async () => {
      const account = nextAccount("duplicate");
      const first = await provision({ adminAccount: account });
      expect(first.errors).toBeUndefined();

      const again = await provision({ adminAccount: account });
      expect(again.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(again.errors?.[0]?.extensions).toMatchObject({
        fields: expect.arrayContaining(["adminAccount", "adminEmail"]),
      });
    });

    it("logoPath 不是 createUploadUrl 簽出來的路徑:VALIDATION_FAILED", async () => {
      const result = await provision({ logoPath: "../secrets/other.png" });

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        fields: ["logoPath"],
      });
    });

    it("非根組織的操作者即使持有權限也拒(FORBIDDEN),且什麼都沒建起來", async () => {
      const account = nextAccount("from-tenant");
      const result = await provision({ adminAccount: account }, tenantOpsToken);

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await userRowByAccount(account)).toBeNull();
    });

    it("站在根組織、但管理範圍只到某個租戶:FORBIDDEN(不讓 ownerUserId 靜默漏寫)", async () => {
      // 刻意造一個怪設定:人在根組織,卻只持有擁有組織 = 既有租戶的角色 →
      // 管理範圍不是整個平台,租戶作業當場拒絕,而不是建完租戶卻寫不進擁有者
      const account = nextAccount("root-narrow-scope");
      const userId = await createUser(api.connection, {
        account,
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      await createRole(api.app, api.connection, {
        name: "站在根組織但擁有組織是租戶",
        ownerOrgId: legacyTenantId,
        moduleKeys: [ORG_MANAGER_MODULE, TENANT_OPS_MODULE],
        permissionKeys: [`${ORG_MANAGER_MODULE}.*`, ...TENANT_OPS_PERMISSIONS],
        assignTo: [userId],
      });
      const token = await login(account);

      const before = await api.connection.collection("orgs").countDocuments();
      const result = await provision({}, token);

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      const after = await api.connection.collection("orgs").countDocuments();
      expect(after).toBe(before);
    });

    it("根組織但沒有 provision 權限:FORBIDDEN(@RequirePermission 守門)", async () => {
      const result = await provision({}, rootViewToken);

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("中途失敗整個交易回復:沒有殘留組織 / 角色 / 使用者 / 關聯 / 稽核,同一組帳號可以重新開通", async () => {
      const account = nextAccount("rollback");
      const audits = api.app.get(AuditService);
      const relations = api.connection.collection("core_relationships");
      const roles = api.connection.collection("roles");
      const relationsBefore = await relations.countDocuments({});
      const copiesBefore = await roles.countDocuments({
        "settings.templateKey": "tenant-admin",
      });
      const mailsBefore = mail.sent.length;
      // 稽核是交易內最後一筆寫入(組織、副本、使用者、關聯、ownerUserId 都已寫了);讓它炸一次
      // (TEST-07 的第二個接縫:「資料庫寫到一半失敗」在 GraphQL 端點上沒有辦法觸發)
      const spy = jest
        .spyOn(audits, "record")
        .mockRejectedValueOnce(new Error("injected failure at audit"));

      const failed = await provision({ adminAccount: account });
      expect(failed.errors).toHaveLength(1);
      expect(await userRowByAccount(account)).toBeNull();
      expect(
        await api.connection
          .collection("orgs")
          .countDocuments({ name: `租戶 ${account}` }),
      ).toBe(0);
      expect(
        await roles.countDocuments({ "settings.templateKey": "tenant-admin" }),
      ).toBe(copiesBefore);
      expect(await relations.countDocuments({})).toBe(relationsBefore);
      // 啟用信排在交易成功之後:交易回復就不寄
      expect(mail.sent).toHaveLength(mailsBefore);

      spy.mockRestore();
      const retried = await provision({ adminAccount: account });
      expect(retried.errors).toBeUndefined();
      expect(await userRowByAccount(account)).not.toBeNull();
    });

    it("啟用信在交易提交後才寄;寄不出去只記 log,開通照樣成立、回 activationMailSent = false", async () => {
      const account = nextAccount("mail-down");
      const passwords = api.app.get(PasswordService);
      let userAtSend: UserRow | null = null;
      const spy = jest
        .spyOn(passwords, "sendActivationEmail")
        .mockImplementationOnce(async () => {
          // 交易已提交:交易外讀得到首任管理員
          userAtSend = await userRowByAccount(account);
          throw new Error("mail provider down");
        });

      const result = await provision({ adminAccount: account });
      expect(result.errors).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(userAtSend).not.toBeNull();
      const payload = result.data?.provisionTenant;
      // 回傳告訴畫面信沒寄出(提示首任管理員走「忘記密碼」)
      expect(payload?.activationMailSent).toBe(false);
      expect(await orgRow(payload?.org.id ?? "")).toMatchObject({
        ownerUserId: new Types.ObjectId(payload?.ownerUserId),
      });
      spy.mockRestore();
    });
  });

  describe("provisionTarget:開通的寫入目標(demo 指令比對確認字串用)", () => {
    const PROVISION_TARGET = /* GraphQL */ `
      query ProvisionTarget {
        provisionTarget {
          databaseName
        }
      }
    `;

    it("根組織:回這個 api 連到的資料庫名(只有資料庫名)", async () => {
      const result = await api.graphql<{
        provisionTarget: { databaseName: string };
      }>(PROVISION_TARGET, {}, { accessToken: rootOpsToken });

      expect(result.errors).toBeUndefined();
      expect(result.data?.provisionTarget).toEqual({
        databaseName: api.connection.name,
      });
    });

    it("非根組織即使持有權限也拒(FORBIDDEN);沒有 provision 權限也拒", async () => {
      for (const accessToken of [tenantOpsToken, rootViewToken]) {
        const result = await api.graphql(PROVISION_TARGET, {}, { accessToken });
        expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      }
    });
  });

  describe("provisionTenant:示範機構(demo + adminInitialPassword)", () => {
    const DEMO_PASSWORD = ["demo", "only", "pass", "9"].join("-");

    it("示範機構:組織標 isDemo、首任管理員用給的密碼直接登入(不強改、不寄啟用信),稽核只記標記不記密碼", async () => {
      const account = nextAccount("demo-admin");
      const before = mail.sent.length;
      const result = await provision({
        adminAccount: account,
        demo: true,
        adminInitialPassword: DEMO_PASSWORD,
      });

      expect(result.errors).toBeUndefined();
      const payload = result.data?.provisionTenant;
      if (!payload) {
        throw new Error("provisionTenant 沒有回 payload");
      }
      expect(payload.org.isDemo).toBe(true);
      expect(payload.activationMailSent).toBe(false);
      expect(mail.sent.slice(before)).toHaveLength(0);
      const org = await orgRow(payload.org.id);
      expect(org?.isDemo).toBe(true);

      const user = await userRow(payload.ownerUserId);
      expect(user?.settings.mustChangePassword).toBe(false);
      expect(user?.passwordHash).not.toContain(DEMO_PASSWORD);
      const token = await login(account, DEMO_PASSWORD);
      const me = await api.graphql<{ me: { mustChangePassword: boolean } }>(
        /* GraphQL */ `
          query Me {
            me {
              mustChangePassword
            }
          }
        `,
        {},
        { accessToken: token },
      );
      expect(me.errors).toBeUndefined();
      expect(me.data?.me.mustChangePassword).toBe(false);

      const audit = await latestAudit("org.provision", payload.org.id);
      expect(audit?.after).toMatchObject({ isDemo: true });
      expect(JSON.stringify(audit)).not.toContain(DEMO_PASSWORD);
    });

    it("一般開通:isDemo 為 false,資料庫不寫標記", async () => {
      const { payload } = await provisionOne("not-demo");

      expect(payload.org.isDemo).toBe(false);
      const org = await orgRow(payload.org.id);
      expect(org?.isDemo).toBeUndefined();
    });

    it("只給密碼不標示範、標示範卻沒給密碼、密碼不合規則:VALIDATION_FAILED 並標 adminInitialPassword,什麼都沒建", async () => {
      const cases = [
        { adminInitialPassword: DEMO_PASSWORD },
        { demo: false, adminInitialPassword: DEMO_PASSWORD },
        { demo: true },
        { demo: true, adminInitialPassword: "" },
      ];
      for (const overrides of cases) {
        const account = nextAccount("demo-invalid");
        const result = await provision({ adminAccount: account, ...overrides });
        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["adminInitialPassword"],
        });
        expect(await userRowByAccount(account)).toBeNull();
      }

      const weak = nextAccount("demo-weak");
      const result = await provision({
        adminAccount: weak,
        demo: true,
        adminInitialPassword: "x",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(await userRowByAccount(weak)).toBeNull();
    });
  });

  describe("revokeTenantProvision:撤銷開通(開通的反向動作)", () => {
    it("撤銷後三樣都不見(硬刪除)、關聯不留孤兒,同一組帳號可以重新開通", async () => {
      const { account, payload } = await provisionOne("revoke-happy");

      const result = await revokeProvision(payload.org.id);

      expect(result.errors).toBeUndefined();
      expect(result.data?.revokeTenantProvision).toMatchObject({
        success: true,
        revokedOrgId: payload.org.id,
        revokedOwnerUserId: payload.ownerUserId,
        revokedRoleId: payload.roleId,
      });
      // 硬刪除:三個文件在庫裡真的不存在(不是 deletedAt 有值)——
      // `users` 的 account / email 唯一索引含已軟刪除的文件,留殭屍就再也開不了同一組帳號
      expect(await orgRow(payload.org.id)).toBeNull();
      expect(await userRow(payload.ownerUserId)).toBeNull();
      expect(await roleRow(payload.roleId)).toBeNull();
      expect(await userRowByAccount(account)).toBeNull();
      expect(
        await linkCountOf([
          payload.org.id,
          payload.ownerUserId,
          payload.roleId,
        ]),
      ).toBe(0);

      // 審計留著(ADR-0004 只增不改,不在抹除範圍內)
      const audit = await latestAudit("org.revoke-provision", payload.org.id);
      expect(audit?.targetType).toBe("org");
      expect(audit?.before).toMatchObject({
        ownerUserId: payload.ownerUserId,
        roleId: payload.roleId,
      });

      // 同一組帳號 / Email 可以重新開通(撤銷的重點)
      const again = await provision({
        adminAccount: account,
        adminEmail: `${account}@example.com`,
      });
      expect(again.errors).toBeUndefined();
    });

    it("底下還有子組織:PROVISION_NOT_REVOKABLE + HAS_CHILDREN", async () => {
      const { payload } = await provisionOne("revoke-children");
      await createOrg(api.connection, {
        name: "撤銷不了的部門",
        parentId: new Types.ObjectId(payload.org.id),
      });

      const result = await revokeProvision(payload.org.id);

      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "PROVISION_NOT_REVOKABLE",
        reasons: ["HAS_CHILDREN"],
      });
      expect(await orgRow(payload.org.id)).not.toBeNull();
    });

    it("除擁有者外還有別的成員:PROVISION_NOT_REVOKABLE + HAS_MEMBERS", async () => {
      const { payload } = await provisionOne("revoke-members");
      await createUser(api.connection, {
        account: nextAccount("extra-member"),
        password: PASSWORD,
        orgIds: [new Types.ObjectId(payload.org.id)],
      });

      const result = await revokeProvision(payload.org.id);

      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "PROVISION_NOT_REVOKABLE",
        reasons: ["HAS_MEMBERS"],
      });
    });

    it("除租戶管理員副本外還擁有別的角色:PROVISION_NOT_REVOKABLE + OWNS_ROLES", async () => {
      const { payload } = await provisionOne("revoke-roles");
      await createRole(api.app, api.connection, {
        name: "租戶自建角色",
        ownerOrgId: new Types.ObjectId(payload.org.id),
      });

      const result = await revokeProvision(payload.org.id);

      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "PROVISION_NOT_REVOKABLE",
        reasons: ["OWNS_ROLES"],
      });
    });

    it("還有業務資料掛著:PROVISION_NOT_REVOKABLE + HAS_BUSINESS_DATA", async () => {
      const { payload } = await provisionOne("revoke-business");
      const now = new Date();
      const customerAccount = nextAccount("revoke-customer");
      await api.connection.collection("customers").insertOne({
        name: "租戶會員",
        account: customerAccount,
        email: `${customerAccount}@example.com`,
        orgId: new Types.ObjectId(payload.org.id),
        enabled: true,
        settings: {},
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });

      const result = await revokeProvision(payload.org.id);

      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "PROVISION_NOT_REVOKABLE",
        reasons: ["HAS_BUSINESS_DATA"],
      });
    });

    /**
     * 只有這一張業務表掛著資料也要擋(撤銷開通問的是租戶頂層):五張表的組織歸屬欄各不相同 ——
     * forms 是 `ownerOrgId`、workflows / workflow_tasks 是 `tenantId`、提交與流程實例是 `orgId`。
     */
    it.each([
      [
        "forms",
        (tenantId: Types.ObjectId) => ({
          key: `revoke-form-${String(tenantId)}`,
          name: "客製表單",
          moduleKey: "demo-form",
          ownerOrgId: tenantId,
        }),
      ],
      [
        "form_submissions",
        (tenantId: Types.ObjectId) => ({
          orgId: tenantId,
          tenantId,
          moduleKey: "demo-form",
          formKey: "demo-form",
          version: 1,
          status: "draft",
          clientRequestId: `revoke-${String(tenantId)}`,
        }),
      ],
      [
        "workflows",
        (tenantId: Types.ObjectId) => ({
          key: `revoke-workflow-${String(tenantId)}`,
          name: "客製流程",
          ownerOrgId: tenantId,
          tenantId,
        }),
      ],
      [
        "workflow_instances",
        (tenantId: Types.ObjectId) => ({
          orgId: tenantId,
          tenantId,
          moduleKey: "demo-form",
          status: "running",
        }),
      ],
      [
        "workflow_tasks",
        (tenantId: Types.ObjectId) => ({
          tenantId,
          moduleKey: "demo-form",
          instanceId: new Types.ObjectId(),
          status: "pending",
        }),
      ],
    ] as const)(
      "只有 %s 掛著資料:PROVISION_NOT_REVOKABLE + HAS_BUSINESS_DATA",
      async (collection, documentOf) => {
        const { payload } = await provisionOne(`revoke-${collection}`);
        const now = new Date();
        await api.connection.collection(collection).insertOne({
          ...documentOf(new Types.ObjectId(payload.org.id)),
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });

        const result = await revokeProvision(payload.org.id);

        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "PROVISION_NOT_REVOKABLE",
          reasons: ["HAS_BUSINESS_DATA"],
        });
        expect(await orgRow(payload.org.id)).not.toBeNull();
      },
    );

    it("業務資料的前置檢查不受資料範圍規則收窄:規則讓操作者看不到那筆,照樣不可撤銷", async () => {
      const { payload } = await provisionOne("revoke-rule-narrowed");
      const tenantId = new Types.ObjectId(payload.org.id);
      const now = new Date();
      // 別人建的示範資料(createdBy 不是操作者);規則「僅本人」會把它從操作者眼前收掉
      await api.connection.collection("demo_items_one").insertOne({
        name: "別人建的示範資料",
        status: "draft",
        orgId: tenantId,
        moduleKey: SAMPLE_ONE_MODULE_KEY,
        tenantId,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      const rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
      const targetId = await dataScopeTargetIdOf(
        api.connection,
        SAMPLE_ONE_MODULE_KEY,
      );
      const saveRule = (rules: Record<string, unknown>[]) =>
        api.graphql(
          SAVE_DATA_SCOPE_RULE,
          { input: { targetId, combineOp: "OR", rules } },
          { accessToken: rootToken },
        );
      const saved = await saveRule([
        {
          audience: {
            mode: "match",
            filter: {
              field: "user",
              cond: "in",
              value: { kind: "static", values: [String(rootOpsId)] },
            },
          },
          filter: {
            op: "AND",
            children: [
              {
                field: "createdBy",
                cond: "in",
                value: { kind: "dynamic", ref: "current-user" },
              },
            ],
          },
        },
      ]);
      expect(saved.errors).toBeUndefined();

      try {
        const result = await revokeProvision(payload.org.id);

        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "PROVISION_NOT_REVOKABLE",
          reasons: ["HAS_BUSINESS_DATA"],
        });
        expect(await orgRow(payload.org.id)).not.toBeNull();
      } finally {
        await saveRule([]);
      }
    });

    it("非根組織的操作者即使持有權限也拒(FORBIDDEN),租戶原封不動", async () => {
      const { payload } = await provisionOne("revoke-from-tenant");

      const result = await revokeProvision(payload.org.id, tenantOpsToken);

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await orgRow(payload.org.id)).not.toBeNull();
      expect(await userRow(payload.ownerUserId)).not.toBeNull();
    });

    it("根組織但沒有 revoke-provision 權限:FORBIDDEN(@RequirePermission 守門)", async () => {
      const { payload } = await provisionOne("revoke-no-permission");

      const result = await revokeProvision(payload.org.id, rootViewToken);

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await orgRow(payload.org.id)).not.toBeNull();
    });

    it("目標不是租戶頂層:VALIDATION_FAILED(撤銷的對象只有租戶頂層)", async () => {
      const result = await revokeProvision(String(legacyDeptId));

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        fields: ["orgId"],
      });
    });
  });

  describe("transferOrgOwner:擁有者保護的對象隨之換人", () => {
    it("轉移前:租戶內的管理員停用不了擁有者(OWNER_PROTECTED)", async () => {
      const result = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(legacyOwnerId), enabled: false } },
        { accessToken: tenantManagerToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("OWNER_PROTECTED");
    });

    it("根組織轉移擁有者:資料庫換人、留審計 before / after", async () => {
      const result = await api.graphql<TransferOrgOwnerData>(
        TRANSFER_ORG_OWNER,
        {
          input: {
            orgId: String(legacyTenantId),
            newOwnerUserId: String(legacySuccessorId),
          },
        },
        { accessToken: rootOpsToken },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.transferOrgOwner.org.ownerUserId).toBe(
        String(legacySuccessorId),
      );
      const org = await orgRow(legacyTenantId);
      expect(String(org?.ownerUserId)).toBe(String(legacySuccessorId));

      const audit = await latestAudit("org.transfer-owner", legacyTenantId);
      expect(audit?.before).toEqual({ ownerUserId: String(legacyOwnerId) });
      expect(audit?.after).toEqual({
        ownerUserId: String(legacySuccessorId),
      });
    });

    it("轉移後:前任不再受保護、新任換上(保護對象真的跟著擁有者走)", async () => {
      const former = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(legacyOwnerId), enabled: false } },
        { accessToken: tenantManagerToken },
      );
      expect(former.errors).toBeUndefined();

      const current = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(legacySuccessorId), enabled: false } },
        { accessToken: tenantManagerToken },
      );
      expect(current.errors?.[0]?.extensions?.code).toBe("OWNER_PROTECTED");
    });

    it("對象不是租戶頂層:VALIDATION_FAILED(擁有者只存在於租戶頂層)", async () => {
      const result = await api.graphql(
        TRANSFER_ORG_OWNER,
        {
          input: {
            orgId: String(legacyDeptId),
            newOwnerUserId: String(legacySuccessorId),
          },
        },
        { accessToken: rootOpsToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        fields: ["orgId"],
      });
    });

    it("新擁有者不是這個租戶的人:VALIDATION_FAILED", async () => {
      const outsider = await createUser(api.connection, {
        account: nextAccount("outsider"),
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const result = await api.graphql(
        TRANSFER_ORG_OWNER,
        {
          input: {
            orgId: String(legacyTenantId),
            newOwnerUserId: String(outsider),
          },
        },
        { accessToken: rootOpsToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        fields: ["newOwnerUserId"],
      });
    });

    it("非根組織的操作者即使持有權限也拒(FORBIDDEN)", async () => {
      const result = await api.graphql(
        TRANSFER_ORG_OWNER,
        {
          input: {
            orgId: String(legacyTenantId),
            newOwnerUserId: String(legacyOwnerId),
          },
        },
        { accessToken: tenantOpsToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("可見性開關與治理頁的分工(ADR-0005「管理範圍與可見範圍的分工」)", () => {
    it("開關為 own 時:部門管理員照樣看得到子部門的樹節點與使用者(治理頁吃管理範圍)", async () => {
      // 這位管理員的角色擁有組織 = 既有部門 → 管理範圍 = 既有部門子樹,與開關無關
      const before = await orgRow(legacyTenantId);
      expect(before?.settings.visibility).toBeUndefined();

      const tree = await api.graphql<OrgTreeData>(
        ORG_TREE,
        {},
        { accessToken: tenantManagerToken },
      );
      const nodes = flatten(tree.data?.orgTree ?? []);
      expect(nodes.map((node) => node.id)).toContain(String(legacySubDeptId));
      expect(nodes.every((node) => !node.outOfScope)).toBe(true);
      // 租戶頂層不是這個角色的擁有組織,不在管理範圍內
      expect(nodes.map((node) => node.id)).not.toContain(
        String(legacyTenantId),
      );

      const users = await api.graphql<UsersData>(
        USERS,
        { input: { orgId: String(legacyDeptId) } },
        { accessToken: tenantManagerToken },
      );
      expect(users.data?.users.items.map((item) => item.id)).toContain(
        String(subDeptUserId),
      );
    });

    it("租戶內持 set-visibility 者設得了自己租戶的頂層(不再是根組織專屬),且治理頁不因此改變", async () => {
      const result = await api.graphql<SetOrgVisibilityData>(
        SET_ORG_VISIBILITY,
        { input: { orgId: String(legacyTenantId), visibility: "SUBTREE" } },
        { accessToken: tenantOpsToken },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.setOrgVisibility.org.visibility).toBe("SUBTREE");
      const stored = await orgRow(legacyTenantId);
      expect(stored?.settings.visibility).toBe("subtree");

      const audit = await latestAudit("org.set-visibility", legacyTenantId);
      expect(audit?.before).toEqual({ visibility: "OWN" });
      expect(audit?.after).toEqual({ visibility: "SUBTREE" });

      // 開關切換不觸發任何重算:部門管理員的樹根仍是既有部門,租戶頂層仍不在管理範圍內
      const tree = await api.graphql<OrgTreeData>(
        ORG_TREE,
        {},
        { accessToken: tenantManagerToken },
      );
      expect(tree.data?.orgTree.map((node) => node.id)).toEqual([
        String(legacyDeptId),
      ]);
    });

    it("根組織設別人的租戶:管理範圍是全部,照樣設得了", async () => {
      const result = await api.graphql<SetOrgVisibilityData>(
        SET_ORG_VISIBILITY,
        { input: { orgId: String(legacyTenantId), visibility: "OWN" } },
        { accessToken: rootOpsToken },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.setOrgVisibility.org.visibility).toBe("OWN");
      const stored = await orgRow(legacyTenantId);
      expect(stored?.settings.visibility).toBe("own");
    });
  });
});
