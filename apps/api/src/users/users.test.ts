import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import {
  type AuthTestApp,
  REFRESH_COOKIE_NAME,
  ROOT_ADMIN,
  cookiePair,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { MailService } from "../mail/mail.service";
import { RecordingMailService } from "../mail/recording-mail.service";
import { createRole } from "../permission/test-support/fixtures";

const PASSWORD = ["test", "pass", "word"].join("-");
const NEW_PASSWORD = ["brand", "new", "secret", "9"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const REFRESH = /* GraphQL */ `
  mutation Refresh {
    refresh {
      accessToken
    }
  }
`;

const USERS = /* GraphQL */ `
  query Users($input: UsersInput!) {
    users(input: $input) {
      totalCount
      page
      pageSize
      items {
        id
        account
        name
        enabled
        orgs {
          id
          name
        }
        roles {
          id
          name
          ownerOrgId
          ownerOrgName
          outOfScope
        }
      }
    }
  }
`;

const USER = /* GraphQL */ `
  query User($id: ID!) {
    user(id: $id) {
      id
      account
      name
      email
      nationalId
      enabled
      mustChangePassword
      orgs {
        id
      }
      roles {
        id
        outOfScope
      }
    }
  }
`;

const CREATE_USER = /* GraphQL */ `
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      user {
        id
        account
        email
        mustChangePassword
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

const UPDATE_USER = /* GraphQL */ `
  mutation UpdateUser($input: UpdateUserInput!) {
    updateUser(input: $input) {
      user {
        id
        name
        email
        nickname
        gender
        phone
        nationalId
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

const SET_USER_ORGS = /* GraphQL */ `
  mutation SetUserOrgs($input: SetUserOrgsInput!) {
    setUserOrgs(input: $input) {
      user {
        id
        orgs {
          id
        }
        roles {
          id
        }
      }
      removedOrgs {
        id
        name
      }
      unqualifiedRoles {
        roleId
        roleName
        ownerOrgId
        ownerOrgName
        reasons
        ownerProtected
      }
      revokedRoleIds
    }
  }
`;

const ASSIGN_USER_ROLES = /* GraphQL */ `
  mutation AssignUserRoles($input: AssignUserRolesInput!) {
    assignUserRoles(input: $input) {
      user {
        id
        roles {
          id
        }
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface UserRow {
  id: string;
  account: string;
  name: string;
  enabled: boolean;
  orgs: { id: string; name: string }[];
  roles: {
    id: string;
    name: string;
    ownerOrgId: string | null;
    ownerOrgName: string | null;
    outOfScope: boolean;
  }[];
}

interface UsersData {
  users: {
    totalCount: number;
    page: number;
    pageSize: number;
    items: UserRow[];
  };
}

interface UserData {
  user: {
    id: string;
    nationalId: string | null;
    enabled: boolean;
    mustChangePassword: boolean;
    orgs: { id: string }[];
    roles: { id: string; outOfScope: boolean }[];
  };
}

interface UpdateUserData {
  updateUser: {
    user: {
      id: string;
      name: string;
      email: string;
      nickname: string | null;
      gender: string | null;
      phone: string | null;
      nationalId: string | null;
    };
  };
}

interface CreateUserData {
  createUser: {
    user: {
      id: string;
      account: string;
      email: string;
      mustChangePassword: boolean;
      orgs: { id: string }[];
      roles: { id: string }[];
    };
  };
}

interface UnqualifiedRoleRow {
  roleId: string;
  roleName: string;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  reasons: string[];
  ownerProtected: boolean;
}

interface SetUserOrgsData {
  setUserOrgs: {
    user: { id: string; orgs: { id: string }[]; roles: { id: string }[] };
    removedOrgs: { id: string; name: string }[];
    unqualifiedRoles: UnqualifiedRoleRow[];
    revokedRoleIds: string[];
  };
}

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
interface AuditRecord {
  action: string;
  targetType?: string;
  actorType?: string;
  orgId?: Types.ObjectId | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** 使用者管理權限表(user-manager.md)扣掉兩個欄位級 key —— 一般租戶管理員的組合。 */
const MANAGER_PERMISSIONS = [
  "system.user-manager.view",
  "system.user-manager.create",
  "system.user-manager.edit",
  "system.user-manager.toggle-enabled",
  "system.user-manager.manage-orgs",
  "system.user-manager.assign-roles",
];
/** 模組樹要給完整(綁下層必綁上層,ADR-0011 步驟 3)。 */
const MANAGER_MODULES = ["system", "system.user-manager"];

/** 不看順序、看成員完全相同(auth.test.ts / permission.test.ts 的既有寫法)。 */
function expectSameMembers(actual: string[], expected: string[]): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
}

/**
 * 使用者管理(清單 / 單筆投影 / 新增 / 編輯 / 停用 / 所屬組織三檔 / 指派角色 / 擁有者保護)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);夾具沿用 auth / permission 的 test-support。
 *
 * 組織樹(root 為 seed 建的根組織):
 *   root ─┬─ 租戶甲(settings.visibility = "subtree")─┬─ 部門一 ── 小組一
 *         │                                          └─ 部門二
 *         └─ 租戶乙(未設 visibility ⇒ "own")────────── 部門A
 */
describe("使用者管理(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let mail: RecordingMailService;

  let rootOrgId: Types.ObjectId;
  let tenantA: Types.ObjectId;
  let deptOne: Types.ObjectId;
  let teamOne: Types.ObjectId;
  let deptTwo: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let deptOfB: Types.ObjectId;

  let managerToken: string;
  let fieldManagerToken: string;
  let ownScopeManagerToken: string;
  let rootToken: string;
  let managerRoleId: Types.ObjectId;
  let outOfReachRoleId: Types.ObjectId;

  let accountSequence = 0;

  function nextAccount(prefix: string): string {
    accountSequence += 1;
    return `${prefix}-${String(accountSequence)}`;
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

  /** 建一個「持有使用者管理權限」的操作者並登入。 */
  async function createManager(options: {
    orgIds: Types.ObjectId[];
    ownerOrgId: Types.ObjectId;
    permissionKeys: string[];
  }): Promise<{
    userId: Types.ObjectId;
    token: string;
    roleId: Types.ObjectId;
  }> {
    const account = nextAccount("manager");
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds: options.orgIds,
    });
    const roleId = await createRole(api.app, connection, {
      name: `管理員角色:${account}`,
      ownerOrgId: options.ownerOrgId,
      moduleKeys: MANAGER_MODULES,
      permissionKeys: options.permissionKeys,
      assignTo: [userId],
    });
    return { userId, token: await login(account), roleId };
  }

  /** 找某個動作最近寫入的一筆稽核。 */
  function latestAudit(
    action: string,
    targetId?: Types.ObjectId,
  ): Promise<AuditRecord | null> {
    return connection
      .collection("audit_logs")
      .findOne<AuditRecord>(
        { action, ...(targetId ? { targetId } : {}) },
        { sort: { createdAt: -1, _id: -1 } },
      );
  }

  /** 直接讀 `users` 的那一筆(要看欄位是寫成 `null` 還是根本不存在)。 */
  function rawUser(
    userId: Types.ObjectId,
  ): Promise<Record<string, unknown> | null> {
    return connection
      .collection("users")
      .findOne<Record<string, unknown>>({ _id: userId });
  }

  /** 建一個性別與電話都有值的使用者(清空測試的起點)。 */
  async function createUserWithProfile(
    prefix: string,
  ): Promise<Types.ObjectId> {
    const userId = await createUser(connection, {
      account: nextAccount(prefix),
      password: PASSWORD,
      orgIds: [deptOne],
    });
    const filled = await api.graphql<UpdateUserData>(
      UPDATE_USER,
      { input: { id: String(userId), gender: "male", phone: "0912345678" } },
      { accessToken: managerToken },
    );
    expect(filled.errors).toBeUndefined();
    return userId;
  }

  function countAudit(action: string): Promise<number> {
    return connection.collection("audit_logs").countDocuments({ action });
  }

  async function memberOrgIdsOf(userId: Types.ObjectId): Promise<string[]> {
    const links = await connection
      .collection("core_relationships")
      .find<{ firstId: Types.ObjectId }>({ type: "org_user", secondId: userId })
      .toArray();
    return links.map((link) => String(link.firstId));
  }

  async function roleIdsOf(userId: Types.ObjectId): Promise<string[]> {
    const links = await connection
      .collection("core_relationships")
      .find<{ secondId: Types.ObjectId }>({
        type: "user_role",
        firstId: userId,
      })
      .toArray();
    return links.map((link) => String(link.secondId));
  }

  async function listAs(
    token: string,
    input: Record<string, unknown>,
  ): Promise<UsersData["users"]> {
    const result = await api.graphql<UsersData>(
      USERS,
      { input },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("users 沒有回資料");
    }
    return result.data.users;
  }

  async function setOrgs(
    userId: Types.ObjectId,
    orgIds: Types.ObjectId[],
    extra: Record<string, unknown> = {},
    token?: string,
  ): Promise<{ data: SetUserOrgsData | null; code: string | undefined }> {
    const result = await api.graphql<SetUserOrgsData>(
      SET_USER_ORGS,
      {
        input: { userId: String(userId), orgIds: orgIds.map(String), ...extra },
      },
      { accessToken: token ?? managerToken },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  async function assignRoles(
    userId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    token?: string,
  ): Promise<string | undefined> {
    const result = await api.graphql(
      ASSIGN_USER_ROLES,
      { input: { userId: String(userId), roleIds: roleIds.map(String) } },
      { accessToken: token ?? managerToken },
    );
    return result.errors?.[0]?.extensions?.code;
  }

  /**
   * 多所屬組織的案例:使用者同屬 部門一 與 部門二,持有三個角色 —
   * 部門一的(擁有組織被移除)、小組一的(移除後沒有子樹支撐)、租戶甲的(部門二仍在其子樹內 ⇒ 不失資格)。
   */
  async function createMultiOrgUser(): Promise<{
    userId: Types.ObjectId;
    deptOneRoleId: Types.ObjectId;
    teamOneRoleId: Types.ObjectId;
    tenantRoleId: Types.ObjectId;
  }> {
    const userId = await createUser(connection, {
      account: nextAccount("multi-org"),
      password: PASSWORD,
      orgIds: [deptOne, deptTwo],
    });
    const deptOneRoleId = await createRole(api.app, connection, {
      name: "部門一的角色",
      ownerOrgId: deptOne,
      assignTo: [userId],
    });
    const teamOneRoleId = await createRole(api.app, connection, {
      name: "小組一的角色",
      ownerOrgId: teamOne,
      assignTo: [userId],
    });
    const tenantRoleId = await createRole(api.app, connection, {
      name: "租戶甲的角色",
      ownerOrgId: tenantA,
      assignTo: [userId],
    });
    return { userId, deptOneRoleId, teamOneRoleId, tenantRoleId };
  }

  /** 建一個有擁有者的租戶:含擁有者、其「租戶管理員」副本角色、同租戶的另一位操作者。 */
  async function createOwnedTenant(): Promise<{
    tenantId: Types.ObjectId;
    childId: Types.ObjectId;
    ownerId: Types.ObjectId;
    tenantAdminRoleId: Types.ObjectId;
    operatorToken: string;
  }> {
    const tenantId = await createOrg(connection, {
      name: nextAccount("受保護租戶"),
      settings: { visibility: "subtree" },
    });
    const childId = await createOrg(connection, {
      name: "子部門",
      parentId: tenantId,
    });
    const ownerId = await createUser(connection, {
      account: nextAccount("owner"),
      password: PASSWORD,
      orgIds: [tenantId, childId],
    });
    const tenantAdminRoleId = await createRole(api.app, connection, {
      name: "租戶管理員",
      ownerOrgId: tenantId,
      assignTo: [ownerId],
    });
    // 開通租戶複製模板時要寫的標記(provisionTenant 照此),擁有者保護才認得出這筆授予
    await connection
      .collection("roles")
      .updateOne(
        { _id: tenantAdminRoleId },
        { $set: { "settings.templateKey": "tenant-admin" } },
      );
    await connection
      .collection("orgs")
      .updateOne({ _id: tenantId }, { $set: { ownerUserId: ownerId } });

    // 同租戶的另一位管理員,也持有那個租戶管理員角色 ⇒ 可觸及,驗到的才是擁有者保護而不是防越權
    const operatorAccount = nextAccount("tenant-operator");
    const operatorId = await createUser(connection, {
      account: operatorAccount,
      password: PASSWORD,
      orgIds: [tenantId],
    });
    await createRole(api.app, connection, {
      name: `租戶操作者角色-${operatorAccount}`,
      ownerOrgId: tenantId,
      moduleKeys: MANAGER_MODULES,
      permissionKeys: MANAGER_PERMISSIONS,
      assignTo: [operatorId],
    });
    const now = new Date();
    await connection.collection("core_relationships").insertOne({
      type: "user_role",
      firstId: operatorId,
      secondId: tenantAdminRoleId,
      thirdId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
    return {
      tenantId,
      childId,
      ownerId,
      tenantAdminRoleId,
      operatorToken: await login(operatorAccount),
    };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-users", {
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    });
    connection = api.connection;
    const mailService = api.app.get(MailService);
    if (!(mailService instanceof RecordingMailService)) {
      throw new TypeError(
        "測試環境沒設 RESEND_API_KEY,MailService 應是記錄用 adapter",
      );
    }
    mail = mailService;

    rootOrgId = await findRootOrgId(connection);
    tenantA = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    deptOne = await createOrg(connection, {
      name: "部門一",
      parentId: tenantA,
    });
    teamOne = await createOrg(connection, {
      name: "小組一",
      parentId: deptOne,
    });
    deptTwo = await createOrg(connection, {
      name: "部門二",
      parentId: tenantA,
    });
    tenantB = await createOrg(connection, { name: "租戶乙" });
    deptOfB = await createOrg(connection, { name: "部門A", parentId: tenantB });

    const manager = await createManager({
      orgIds: [tenantA],
      ownerOrgId: tenantA,
      permissionKeys: MANAGER_PERMISSIONS,
    });
    managerToken = manager.token;
    managerRoleId = manager.roleId;

    // 同一個租戶,另外持有兩個欄位級權限(以同層 wildcard 一次給全,ADR-0004)
    const fieldManager = await createManager({
      orgIds: [tenantA],
      ownerOrgId: tenantA,
      permissionKeys: ["system.user-manager.*"],
    });
    fieldManagerToken = fieldManager.token;

    // 租戶乙:可見範圍只有自己所屬組織("own")
    const ownScopeManager = await createManager({
      orgIds: [tenantB],
      ownerOrgId: tenantB,
      permissionKeys: MANAGER_PERMISSIONS,
    });
    ownScopeManagerToken = ownScopeManager.token;

    // 擁有組織在操作者**管理範圍外**的角色(防越權用;判準是擁有組織,不是「操作者持不持有」)
    outOfReachRoleId = await createRole(api.app, connection, {
      name: "管理範圍外的角色",
      ownerOrgId: tenantB,
    });

    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("清單:子樹 ∩ 管理範圍(user-manager.md「清單範圍」、ADR-0005 的分工表)", () => {
    let inDeptOne: Types.ObjectId;
    let inTeamOne: Types.ObjectId;
    let inDeptTwo: Types.ObjectId;
    let inDeptOfB: Types.ObjectId;

    beforeAll(async () => {
      inDeptOne = await createUser(connection, {
        account: nextAccount("list-dept-one"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      inTeamOne = await createUser(connection, {
        account: nextAccount("list-team-one"),
        password: PASSWORD,
        orgIds: [teamOne],
      });
      inDeptTwo = await createUser(connection, {
        account: nextAccount("list-dept-two"),
        password: PASSWORD,
        orgIds: [deptTwo],
      });
      inDeptOfB = await createUser(connection, {
        account: nextAccount("list-dept-of-b"),
        password: PASSWORD,
        orgIds: [deptOfB],
      });
    }, HOOK_TIMEOUT_MS);

    it("選租戶頂層即列出整棵子樹的成員", async () => {
      const page = await listAs(managerToken, {
        orgId: String(tenantA),
        pageSize: 100,
      });
      const ids = page.items.map((item) => item.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          String(inDeptOne),
          String(inTeamOne),
          String(inDeptTwo),
        ]),
      );
      // 別的租戶不會出現(租戶隔離,ADR-0005)
      expect(ids).not.toContain(String(inDeptOfB));
    });

    it("選中下層組織只列該子樹", async () => {
      const page = await listAs(managerToken, {
        orgId: String(deptOne),
        pageSize: 100,
      });
      const ids = page.items.map((item) => item.id);
      expect(ids).toEqual(
        expect.arrayContaining([String(inDeptOne), String(inTeamOne)]),
      );
      expect(ids).not.toContain(String(inDeptTwo));
    });

    it("可見性開關為 own 也列得出下層組織的成員:清單吃管理範圍,不吃可見範圍(ADR-0005)", async () => {
      // 這位管理員的角色擁有組織 = 租戶乙頂層 → 管理範圍 = 整個租戶乙,與開關無關
      const page = await listAs(ownScopeManagerToken, {
        orgId: String(tenantB),
        pageSize: 100,
      });
      const ids = page.items.map((item) => item.id);
      expect(ids).toContain(String(inDeptOfB));
      // 別的租戶照樣進不來(管理範圍是子樹,不是全部)
      expect(ids).not.toContain(String(inDeptOne));
    });

    it("管理範圍外的組織當成查無:回空清單而不是別人的資料", async () => {
      const page = await listAs(ownScopeManagerToken, {
        orgId: String(tenantA),
        pageSize: 100,
      });
      expect(page.items).toHaveLength(0);
      expect(page.totalCount).toBe(0);
    });

    it("分頁:totalCount 是全部、items 只有該頁", async () => {
      const first = await listAs(managerToken, {
        orgId: String(tenantA),
        page: 1,
        pageSize: 1,
      });
      expect(first.items).toHaveLength(1);
      expect(first.totalCount).toBeGreaterThan(1);
      expect(first.page).toBe(1);
      expect(first.pageSize).toBe(1);

      const second = await listAs(managerToken, {
        orgId: String(tenantA),
        page: 2,
        pageSize: 1,
      });
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    });

    it("關鍵字:比對帳號 / 姓名 / Email 的部分字串", async () => {
      const target = await connection
        .collection("users")
        .findOne<{ account: string }>({ _id: inTeamOne });
      const searched = await listAs(managerToken, {
        orgId: String(tenantA),
        keyword: target?.account,
        pageSize: 100,
      });
      expectSameMembers(
        searched.items.map((item) => item.id),
        [String(inTeamOne)],
      );
    });

    it("每列附所屬組織與角色;角色欄以 outOfScope 標示「組織外」(ADR-0003)", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("list-marks"),
        password: PASSWORD,
        orgIds: [deptTwo],
      });
      const tenantRoleId = await createRole(api.app, connection, {
        name: "租戶甲的角色",
        ownerOrgId: tenantA,
        assignTo: [userId],
      });
      const teamRoleId = await createRole(api.app, connection, {
        name: "小組一的角色",
        ownerOrgId: teamOne,
        assignTo: [userId],
      });

      const page = await listAs(managerToken, {
        orgId: String(deptTwo),
        pageSize: 100,
      });
      const row = page.items.find((item) => item.id === String(userId));
      expect(row?.orgs).toEqual([{ id: String(deptTwo), name: "部門二" }]);
      // 部門二 落在 租戶甲 的子樹內 ⇒ 有支撐
      expect(
        row?.roles.find((role) => role.id === String(tenantRoleId)),
      ).toMatchObject({
        ownerOrgId: String(tenantA),
        ownerOrgName: "租戶甲",
        outOfScope: false,
      });
      // 部門二 不在 小組一 的子樹內 ⇒ 組織外
      expect(
        row?.roles.find((role) => role.id === String(teamRoleId)),
      ).toMatchObject({
        ownerOrgId: String(teamOne),
        ownerOrgName: "小組一",
        outOfScope: true,
      });
    });

    it("沒有 view 權限進不去清單(FORBIDDEN);未登入為 UNAUTHENTICATED", async () => {
      const noPermission = await createManager({
        orgIds: [tenantA],
        ownerOrgId: tenantA,
        permissionKeys: [],
      });
      const forbidden = await api.graphql(
        USERS,
        { input: { orgId: String(tenantA) } },
        { accessToken: noPermission.token },
      );
      expect(forbidden.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const anonymous = await api.graphql(USERS, {
        input: { orgId: String(tenantA) },
      });
      expect(anonymous.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("單筆:nationalId 欄位級投影(ADR-0007、user-manager.md 權限表)", () => {
    let targetId: string;

    beforeAll(async () => {
      const account = nextAccount("national-id");
      const created = await api.graphql<CreateUserData>(
        CREATE_USER,
        {
          input: {
            name: "身分證測試",
            account,
            email: `${account}@example.com`,
            nationalId: "A123456789",
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: fieldManagerToken },
      );
      expect(created.errors).toBeUndefined();
      targetId = created.data?.createUser.user.id ?? "";
    }, HOOK_TIMEOUT_MS);

    it("持 show-national-id:回傳解密後的值", async () => {
      const result = await api.graphql<UserData>(
        USER,
        { id: targetId },
        { accessToken: fieldManagerToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.user.nationalId).toBe("A123456789");
    });

    it("不持 show-national-id:投影排除,一律 null", async () => {
      const result = await api.graphql<UserData>(
        USER,
        { id: targetId },
        { accessToken: managerToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.user.nationalId).toBeNull();
    });

    it("資料庫裡是密文,不是明文(ADR-0007 欄位級加密)", async () => {
      const stored = await connection
        .collection("users")
        .findOne<{ nationalId?: string }>({
          _id: new Types.ObjectId(targetId),
        });
      expect(stored?.nationalId).toBeDefined();
      expect(stored?.nationalId).not.toBe("A123456789");
      expect(stored?.nationalId?.startsWith("enc:v1:")).toBe(true);
    });

    it("不持 edit-national-id 硬送寫入 → FORBIDDEN", async () => {
      const result = await api.graphql(
        UPDATE_USER,
        { input: { id: targetId, nationalId: "B222222222" } },
        { accessToken: managerToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("可見範圍外的使用者視為不存在(NOT_FOUND)", async () => {
      const result = await api.graphql(
        USER,
        { id: targetId },
        { accessToken: ownScopeManagerToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });
  });

  describe("新增:兩種啟用方式與唯一性(ADR-0009 / ADR-0003)", () => {
    it("寄啟用信:不設可用密碼、mustChangePassword 為 false,信寄到該 Email", async () => {
      const account = nextAccount("activation-email");
      const email = `${account}@example.com`;
      const before = mail.sent.length;
      const result = await api.graphql<CreateUserData>(
        CREATE_USER,
        {
          input: {
            name: "啟用信使用者",
            account,
            email,
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.createUser.user.mustChangePassword).toBe(false);
      expect(result.data?.createUser.user.orgs).toEqual([
        { id: String(deptOne) },
      ]);

      const sent = mail.sent.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind: "activation", to: email });
      expect(sent[0]?.link).toContain("/set-password?token=");
    });

    it("寫稽核那一步拋錯 → 整個回復:使用者、所屬組織與角色關聯都不留,也不寄啟用信(ADR-0013)", async () => {
      const account = nextAccount("create-rollback");
      const email = `${account}@example.com`;
      const before = mail.sent.length;
      const relationCounts = async () => ({
        orgUser: await connection
          .collection("core_relationships")
          .countDocuments({ type: "org_user", firstId: deptOne }),
        userRole: await connection
          .collection("core_relationships")
          .countDocuments({ type: "user_role", secondId: managerRoleId }),
      });
      const relationsBefore = await relationCounts();
      const auditBefore = await countAudit("user.create");
      // 使用者與關聯都已在交易內寫入,第三步稽核才拋錯(GraphQL 端點上做不到,經 app.get 接縫)
      const spy = jest
        .spyOn(api.app.get(AuditService), "record")
        .mockRejectedValueOnce(new Error("模擬寫入失敗"));
      const result = await api.graphql<CreateUserData>(
        CREATE_USER,
        {
          input: {
            name: "回復的使用者",
            account,
            email,
            orgIds: [String(deptOne)],
            roleIds: [String(managerRoleId)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      spy.mockRestore();
      expect(result.data).toBeNull();
      expect(
        await connection.collection("users").countDocuments({ account }),
      ).toBe(0);
      expect(await relationCounts()).toEqual(relationsBefore);
      expect(await countAudit("user.create")).toBe(auditBefore);
      expect(mail.sent.slice(before)).toEqual([]);
    });

    it("直接設定初始密碼:mustChangePassword 為 true,且該密碼可以登入", async () => {
      const account = nextAccount("activation-password");
      const result = await api.graphql<CreateUserData>(
        CREATE_USER,
        {
          input: {
            name: "初始密碼使用者",
            account,
            email: `${account}@example.com`,
            orgIds: [String(deptOne)],
            activation: { mode: "PASSWORD", initialPassword: NEW_PASSWORD },
          },
        },
        { accessToken: managerToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.createUser.user.mustChangePassword).toBe(true);

      const loggedIn = await api.graphql<LoginData>(LOGIN, {
        input: { account, password: NEW_PASSWORD },
      });
      expect(loggedIn.errors).toBeUndefined();
      expect(loggedIn.data?.login.accessToken).toBeTruthy();
    });

    it("初始密碼不合規則 → VALIDATION_FAILED(規則正本 @repo/domain/password)", async () => {
      const account = nextAccount("weak-password");
      const result = await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "弱密碼",
            account,
            email: `${account}@example.com`,
            orgIds: [String(deptOne)],
            activation: { mode: "PASSWORD", initialPassword: "123" },
          },
        },
        { accessToken: managerToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    });

    it("帳號重複 → VALIDATION_FAILED 並列出欄位", async () => {
      const account = nextAccount("duplicate");
      await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "第一個",
            account,
            email: `${account}@example.com`,
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      const clash = await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "第二個",
            account,
            email: `${account}-other@example.com`,
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      expect(clash.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["account"],
      });
    });

    it("Email 重複 → VALIDATION_FAILED 並列出欄位", async () => {
      const account = nextAccount("duplicate-email");
      const email = `${account}@example.com`;
      await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "第一個",
            account,
            email,
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      const clash = await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "第二個",
            account: `${account}-other`,
            email,
            orgIds: [String(deptOne)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      expect(clash.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["email"],
      });
    });

    it("所屬組織在可見範圍外 → FORBIDDEN", async () => {
      const account = nextAccount("cross-tenant");
      const result = await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "跨租戶",
            account,
            email: `${account}@example.com`,
            orgIds: [String(tenantB)],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("沒有所屬組織 → VALIDATION_FAILED(至少要一個)", async () => {
      const account = nextAccount("no-org");
      const result = await api.graphql(
        CREATE_USER,
        {
          input: {
            name: "無組織",
            account,
            email: `${account}@example.com`,
            orgIds: [],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: managerToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["orgIds"],
      });
    });
  });

  describe("編輯基本欄位", () => {
    it("改姓名,稽核 before / after 只放有變的欄位", async () => {
      const account = nextAccount("edit");
      const userId = await createUser(connection, {
        account,
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const result = await api.graphql<{
        updateUser: { user: { name: string } };
      }>(
        UPDATE_USER,
        { input: { id: String(userId), name: "改過的名字" } },
        { accessToken: managerToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.updateUser.user.name).toBe("改過的名字");

      const record = await latestAudit("user.edit", userId);
      expect(record).toMatchObject({
        action: "user.edit",
        targetType: "user",
        before: { name: account },
        after: { name: "改過的名字" },
      });
      expect(Object.keys(record?.after ?? {})).toEqual(["name"]);
    });

    it("身分證字號的變更不寫明文進 audit_logs(只記「已變更」)", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("edit-national-id"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const result = await api.graphql(
        UPDATE_USER,
        { input: { id: String(userId), nationalId: "C123456789" } },
        { accessToken: fieldManagerToken },
      );
      expect(result.errors).toBeUndefined();

      const record = await latestAudit("user.edit", userId);
      expect(record?.after).toMatchObject({ nationalId: "(已變更)" });
      expect(JSON.stringify(record)).not.toContain("C123456789");
    });

    // 前端「沒填」送的是 null,原本的 `given.trim()` 直接炸
    // `Cannot read properties of null (reading 'trim')`。
    // 語意照 GQL-06:缺席 = 不動、null = 清空;落庫寫 null 而不是 $unset(ADR-0002)。
    describe("選填欄位的 null(GQL-06:缺席 = 不動、null = 清空)", () => {
      it("送 null 清空選填欄位,落庫寫 null(不是 $unset)", async () => {
        const userId = await createUserWithProfile("null-clear");
        const result = await api.graphql<UpdateUserData>(
          UPDATE_USER,
          { input: { id: String(userId), gender: null } },
          { accessToken: managerToken },
        );

        expect(result.errors).toBeUndefined();
        expect(result.data?.updateUser.user.gender).toBeNull();
        // 同一次沒送的 phone 不受影響(缺席 = 不動)
        expect(result.data?.updateUser.user.phone).toBe("0912345678");

        const stored = await rawUser(userId);
        expect(stored).toHaveProperty("gender", null);
        expect(stored?.phone).toBe("0912345678");

        const record = await latestAudit("user.edit", userId);
        expect(record?.after).toMatchObject({ gender: null });
      });

      it("本來就沒值的選填欄位送 null 是 no-op(不留稽核)", async () => {
        const userId = await createUser(connection, {
          account: nextAccount("null-noop"),
          password: PASSWORD,
          orgIds: [deptOne],
        });
        const before = await countAudit("user.edit");

        const result = await api.graphql<UpdateUserData>(
          UPDATE_USER,
          { input: { id: String(userId), nickname: null, address: null } },
          { accessToken: managerToken },
        );

        expect(result.errors).toBeUndefined();
        expect(result.data?.updateUser.user.nickname).toBeNull();
        expect(await countAudit("user.edit")).toBe(before);
      });

      it("必填欄位送 null → VALIDATION_FAILED(與送空字串同義)", async () => {
        const userId = await createUserWithProfile("null-required");
        const result = await api.graphql(
          UPDATE_USER,
          { input: { id: String(userId), name: null } },
          { accessToken: managerToken },
        );

        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["name"],
        });
        // 擋下來的那一次什麼都沒寫
        const stored = await rawUser(userId);
        expect(stored?.gender).toBe("male");
      });

      it("新增時選填欄位送 null 與缺席同義:不落庫,也不要求身分證權限", async () => {
        const account = nextAccount("null-create");
        const result = await api.graphql<CreateUserData>(
          CREATE_USER,
          {
            input: {
              name: "選填全空",
              account,
              email: `${account}@example.com`,
              nickname: null,
              gender: null,
              phone: null,
              address: null,
              // 沒有 edit-national-id 的操作者送 null 不算「帶值」,不該 FORBIDDEN
              nationalId: null,
              orgIds: [String(deptOne)],
              activation: { mode: "EMAIL" },
            },
          },
          { accessToken: managerToken },
        );

        expect(result.errors).toBeUndefined();
        const created = result.data?.createUser.user.id;
        expect(created).toBeDefined();
        const stored = await connection
          .collection("users")
          .findOne<Record<string, unknown>>({
            _id: new Types.ObjectId(created),
          });
        expect(stored).not.toHaveProperty("gender");
        expect(stored).not.toHaveProperty("nationalId");
      });
    });
  });

  describe("停用:作廢全部 refresh token(user-manager.md)", () => {
    it("停用後原本的 refresh cookie 換不到票(UNAUTHENTICATED),且不能再登入", async () => {
      const account = nextAccount("disable");
      const userId = await createUser(connection, {
        account,
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const loggedIn = await api.graphql<LoginData>(LOGIN, {
        input: { account, password: PASSWORD },
      });
      const cookie = cookiePair(loggedIn.setCookies, REFRESH_COOKIE_NAME);
      expect(cookie).toBeDefined();

      const beforeDisable = await api.graphql(REFRESH, {}, { cookie });
      expect(beforeDisable.errors).toBeUndefined();
      const rotated = cookiePair(beforeDisable.setCookies, REFRESH_COOKIE_NAME);

      const disabled = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(userId), enabled: false } },
        { accessToken: managerToken },
      );
      expect(disabled.errors).toBeUndefined();

      const afterDisable = await api.graphql(
        REFRESH,
        {},
        { cookie: rotated ?? cookie },
      );
      expect(afterDisable.errors?.[0]?.extensions?.code).toBe(
        "UNAUTHENTICATED",
      );

      const relogin = await api.graphql(LOGIN, {
        input: { account, password: PASSWORD },
      });
      expect(relogin.errors?.[0]?.extensions?.code).toBe("ACCOUNT_DISABLED");

      const record = await latestAudit("user.toggle-enabled", userId);
      expect(record).toMatchObject({
        before: { enabled: true },
        after: { enabled: false },
      });
    });

    it("重新啟用後可以再登入", async () => {
      const account = nextAccount("re-enable");
      const userId = await createUser(connection, {
        account,
        password: PASSWORD,
        orgIds: [deptOne],
        enabled: false,
      });
      const result = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(userId), enabled: true } },
        { accessToken: managerToken },
      );
      expect(result.errors).toBeUndefined();
      const relogin = await api.graphql<LoginData>(LOGIN, {
        input: { account, password: PASSWORD },
      });
      expect(relogin.errors).toBeUndefined();
    });
  });

  describe("所屬組織:dry-run 與移除三檔(ADR-0003「從組織移除使用者」)", () => {
    it("dryRun:逐筆列出失去資格的角色與原因,資料完全不動", async () => {
      const { userId, deptOneRoleId, teamOneRoleId, tenantRoleId } =
        await createMultiOrgUser();
      const auditBefore = await countAudit("user.remove-org");

      const { data, code } = await setOrgs(userId, [deptTwo], { dryRun: true });
      expect(code).toBeUndefined();
      const payload = data?.setUserOrgs;
      expect(payload?.removedOrgs).toEqual([
        { id: String(deptOne), name: "部門一" },
      ]);
      expect(payload?.revokedRoleIds).toEqual([]);

      const byRole = new Map(
        (payload?.unqualifiedRoles ?? []).map((entry) => [entry.roleId, entry]),
      );
      expectSameMembers(
        [...byRole.keys()],
        [String(deptOneRoleId), String(teamOneRoleId)],
      );
      expect(byRole.get(String(deptOneRoleId))?.reasons).toEqual(
        expect.arrayContaining([
          "OWNED_BY_REMOVED_ORG",
          "NO_REMAINING_SUBTREE_SUPPORT",
        ]),
      );
      expect(byRole.get(String(teamOneRoleId))?.reasons).toEqual([
        "NO_REMAINING_SUBTREE_SUPPORT",
      ]);
      // 租戶甲的角色:剩下的 部門二 還在它的子樹內 ⇒ 沒失去資格
      expect(byRole.has(String(tenantRoleId))).toBe(false);

      // dry-run 不寫入、不留稽核
      const stillMember = await memberOrgIdsOf(userId);
      expectSameMembers(stillMember, [String(deptOne), String(deptTwo)]);
      expect(await countAudit("user.remove-org")).toBe(auditBefore);
    });

    it("(a) 全部保留:移除組織但三個授予都留著", async () => {
      const { userId, deptOneRoleId, teamOneRoleId, tenantRoleId } =
        await createMultiOrgUser();
      const { data, code } = await setOrgs(userId, [deptTwo], {
        removalPolicy: "KEEP_ALL",
      });
      expect(code).toBeUndefined();
      expect(data?.setUserOrgs.revokedRoleIds).toEqual([]);
      const kept = await roleIdsOf(userId);
      expectSameMembers(kept, [
        String(deptOneRoleId),
        String(teamOneRoleId),
        String(tenantRoleId),
      ]);
      expect(await memberOrgIdsOf(userId)).toEqual([String(deptTwo)]);
    });

    it("(b) 解除該組織擁有的角色:只解除部門一的那一個", async () => {
      const { userId, deptOneRoleId, teamOneRoleId, tenantRoleId } =
        await createMultiOrgUser();
      const { data } = await setOrgs(userId, [deptTwo], {
        removalPolicy: "REVOKE_OWNED_BY_ORG",
      });
      expect(data?.setUserOrgs.revokedRoleIds).toEqual([String(deptOneRoleId)]);
      const kept = await roleIdsOf(userId);
      expectSameMembers(kept, [String(teamOneRoleId), String(tenantRoleId)]);
    });

    it("(c) 解除所有失去資格的角色(預設):部門一與小組一的都解除,租戶甲的留著", async () => {
      const { userId, deptOneRoleId, teamOneRoleId, tenantRoleId } =
        await createMultiOrgUser();
      const { data } = await setOrgs(userId, [deptTwo]);
      expectSameMembers(data?.setUserOrgs.revokedRoleIds ?? [], [
        String(deptOneRoleId),
        String(teamOneRoleId),
      ]);
      expect(await roleIdsOf(userId)).toEqual([String(tenantRoleId)]);

      const record = await latestAudit("user.remove-org", userId);
      expect(record?.after).toMatchObject({
        orgIds: [String(deptOne)],
        removalPolicy: "REVOKE_ALL_UNQUALIFIED",
      });
    });

    it("加入組織:寫入關聯並留 user.add-org 稽核", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("add-org"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const { code } = await setOrgs(userId, [deptOne, deptTwo]);
      expect(code).toBeUndefined();
      const after = await memberOrgIdsOf(userId);
      expectSameMembers(after, [String(deptOne), String(deptTwo)]);
      const record = await latestAudit("user.add-org", userId);
      expect(record?.after).toMatchObject({ orgIds: [String(deptTwo)] });
    });

    it("最後一個所屬組織不可移除 → LAST_ORG", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("last-org"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const { code } = await setOrgs(userId, []);
      expect(code).toBe("LAST_ORG");
      expect(await memberOrgIdsOf(userId)).toEqual([String(deptOne)]);
    });

    it("勾到可見範圍外的組織 → FORBIDDEN", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("orgs-forbidden"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      const { code } = await setOrgs(userId, [deptOne, tenantB]);
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("指派角色:全量覆蓋 + 防越權(ADR-0003)", () => {
    it("只能給擁有組織在管理範圍內的角色;範圍外 → ROLE_OUT_OF_REACH", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("out-of-reach"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      expect(await assignRoles(userId, [outOfReachRoleId])).toBe(
        "ROLE_OUT_OF_REACH",
      );
      expect(await roleIdsOf(userId)).toEqual([]);

      expect(await assignRoles(userId, [managerRoleId])).toBeUndefined();
      expect(await roleIdsOf(userId)).toEqual([String(managerRoleId)]);

      const granted = await latestAudit("user.grant-role", userId);
      expect(granted?.after).toMatchObject({
        roleIds: [String(managerRoleId)],
      });
    });

    it("全量覆蓋:送空陣列即解除操作者可觸及的授予,並留 user.revoke-role 稽核", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("revoke"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      expect(await assignRoles(userId, [managerRoleId])).toBeUndefined();
      expect(await assignRoles(userId, [])).toBeUndefined();
      expect(await roleIdsOf(userId)).toEqual([]);

      const record = await latestAudit("user.revoke-role", userId);
      expect(record?.after).toMatchObject({ roleIds: [String(managerRoleId)] });
    });

    it("操作者觸及不到的既有授予不會被順手解除", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("keep-out-of-reach"),
        password: PASSWORD,
        orgIds: [deptOne],
      });
      await createRole(api.app, connection, {
        name: "既有但管理範圍外的角色",
        ownerOrgId: tenantB,
        assignTo: [userId],
      });
      const existing = await roleIdsOf(userId);
      expect(await assignRoles(userId, [managerRoleId])).toBeUndefined();
      const after = await roleIdsOf(userId);
      expectSameMembers(after, [...existing, String(managerRoleId)]);
    });

    it("使用者的所屬組織都不在角色擁有組織的子樹內 → USER_NOT_ELIGIBLE 附 roleId / ownerOrgName", async () => {
      const userId = await createUser(connection, {
        account: nextAccount("unqualified-grant"),
        password: PASSWORD,
        orgIds: [deptTwo],
      });
      // 擁有組織(小組一)在操作者管理範圍內,防越權這關先過,才驗得到資格這一關
      const teamRoleId = await createRole(api.app, connection, {
        name: "小組一專屬角色",
        ownerOrgId: teamOne,
      });
      // 與角色頁的 grantRoleUsers 同一個 helper、同一個碼(不再是 VALIDATION_FAILED);
      // extensions 帶著角色與擁有組織名稱,前端才講得出「只能授予 <擁有組織> 及其下層的使用者」
      const result = await api.graphql(
        ASSIGN_USER_ROLES,
        { input: { userId: String(userId), roleIds: [String(teamRoleId)] } },
        { accessToken: managerToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "USER_NOT_ELIGIBLE",
        roleId: String(teamRoleId),
        ownerOrgName: "小組一",
      });
    });

    it("超級管理員(根組織)不受角色可觸及範圍限制", async () => {
      // 角色的擁有組織是租戶乙,所以使用者也要在租戶乙底下才過得了「授予資格」那一關
      const userId = await createUser(connection, {
        account: nextAccount("root-assign"),
        password: PASSWORD,
        orgIds: [deptOfB],
      });
      expect(
        await assignRoles(userId, [outOfReachRoleId], rootToken),
      ).toBeUndefined();
      expect(await roleIdsOf(userId)).toEqual([String(outOfReachRoleId)]);
    });
  });

  describe("擁有者保護三種 + 根組織例外(ADR-0009)", () => {
    it("(1) 擁有者不可被停用;根組織操作者可以", async () => {
      const { ownerId, operatorToken } = await createOwnedTenant();
      const blocked = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(ownerId), enabled: false } },
        { accessToken: operatorToken },
      );
      expect(blocked.errors?.[0]?.extensions?.code).toBe("OWNER_PROTECTED");

      const byRoot = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(ownerId), enabled: false } },
        { accessToken: rootToken },
      );
      expect(byRoot.errors).toBeUndefined();
    });

    it("(2) 擁有者不可被移出租戶(dry-run 也擋);根組織操作者可以", async () => {
      const { tenantId, childId, ownerId, operatorToken } =
        await createOwnedTenant();
      const dryRun = await setOrgs(
        ownerId,
        [childId],
        { dryRun: true },
        operatorToken,
      );
      expect(dryRun.code).toBe("OWNER_PROTECTED");

      const blocked = await setOrgs(ownerId, [childId], {}, operatorToken);
      expect(blocked.code).toBe("OWNER_PROTECTED");
      const unchanged = await memberOrgIdsOf(ownerId);
      expectSameMembers(unchanged, [String(tenantId), String(childId)]);

      const byRoot = await setOrgs(
        ownerId,
        [childId],
        { removalPolicy: "KEEP_ALL" },
        rootToken,
      );
      expect(byRoot.code).toBeUndefined();
      expect(await memberOrgIdsOf(ownerId)).toEqual([String(childId)]);
    });

    it("(3) 擁有者的「租戶管理員」授予不可被解除;根組織操作者可以", async () => {
      const { ownerId, tenantAdminRoleId, operatorToken } =
        await createOwnedTenant();
      expect(await assignRoles(ownerId, [], operatorToken)).toBe(
        "OWNER_PROTECTED",
      );
      expect(await roleIdsOf(ownerId)).toEqual([String(tenantAdminRoleId)]);

      expect(await assignRoles(ownerId, [], rootToken)).toBeUndefined();
      expect(await roleIdsOf(ownerId)).toEqual([]);
    });

    it("擁有者以外的成員不受保護(同一個租戶內照樣可停用)", async () => {
      const { childId, operatorToken } = await createOwnedTenant();
      const plainId = await createUser(connection, {
        account: nextAccount("plain-member"),
        password: PASSWORD,
        orgIds: [childId],
      });
      const result = await api.graphql(
        SET_USER_ENABLED,
        { input: { id: String(plainId), enabled: false } },
        { accessToken: operatorToken },
      );
      expect(result.errors).toBeUndefined();
    });
  });

  describe("稽核:每個寫入動作各留一筆(ADR-0004、user-manager.md「審計」)", () => {
    it("新增使用者留 user.create,actor / orgId 由操作者上下文填,不含身分證字號明文", async () => {
      const account = nextAccount("audit-create");
      const created = await api.graphql<CreateUserData>(
        CREATE_USER,
        {
          input: {
            name: "稽核測試",
            account,
            email: `${account}@example.com`,
            nationalId: "E123456789",
            orgIds: [String(deptOne)],
            roleIds: [],
            activation: { mode: "EMAIL" },
          },
        },
        { accessToken: fieldManagerToken },
      );
      expect(created.errors).toBeUndefined();
      const userId = new Types.ObjectId(created.data?.createUser.user.id);

      const record = await latestAudit("user.create", userId);
      expect(record).toMatchObject({
        action: "user.create",
        targetType: "user",
        actorType: "user",
      });
      expect(record?.after).toMatchObject({
        account,
        activationMode: "EMAIL",
        nationalId: "(已變更)",
        orgIds: [String(deptOne)],
      });
      expect(JSON.stringify(record)).not.toContain("E123456789");
      // 動作發生的組織脈絡 = 操作者的當前組織(租戶甲)
      expect(String(record?.orgId)).toBe(String(tenantA));
    });

    it("七個動作名稱都用過:create / edit / toggle-enabled / add-org / remove-org / grant-role / revoke-role", async () => {
      for (const action of [
        "user.create",
        "user.edit",
        "user.toggle-enabled",
        "user.add-org",
        "user.remove-org",
        "user.grant-role",
        "user.revoke-role",
      ]) {
        expect(await countAudit(action)).toBeGreaterThan(0);
      }
    });
  });

  describe("根組織視角", () => {
    it("不給 orgId 時攤開整個可見範圍(根組織 = 全部)", async () => {
      const page = await listAs(rootToken, { pageSize: 100 });
      expect(page.items.map((item) => item.account)).toContain(
        ROOT_ADMIN.account,
      );
      expect(page.totalCount).toBeGreaterThan(1);
    });

    it("rootOrgId 是 seed 建的根組織(parentId 為 null),夾具前提成立", async () => {
      const root = await connection
        .collection("orgs")
        .findOne<{ parentId: Types.ObjectId | null }>({ _id: rootOrgId });
      expect(root?.parentId).toBeNull();
    });
  });
});
