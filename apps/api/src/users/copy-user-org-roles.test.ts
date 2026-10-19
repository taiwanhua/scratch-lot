import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { RelationService } from "../database/relation.service";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";

const PASSWORD = ["test", "pass", "word"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const COPY = /* GraphQL */ `
  mutation CopyUserOrgRoles($input: CopyUserOrgRolesInput!) {
    copyUserOrgRoles(input: $input) {
      user {
        id
      }
      mode
      applied
      orgs {
        added {
          id
          name
        }
        removed {
          id
        }
        kept {
          id
        }
      }
      roles {
        added {
          id
          name
          ownerOrgName
        }
        removed {
          id
        }
        kept {
          id
        }
      }
      blockers {
        code
        roleId
        orgId
      }
      outOfScopeKept
    }
  }
`;

const ASSIGN_USER_ROLES = /* GraphQL */ `
  mutation AssignUserRoles($input: AssignUserRolesInput!) {
    assignUserRoles(input: $input) {
      user {
        id
      }
    }
  }
`;

interface IdRef {
  id: string;
}

interface CopyPayload {
  user: IdRef;
  mode: string;
  applied: boolean;
  orgs: {
    added: { id: string; name: string }[];
    removed: IdRef[];
    kept: IdRef[];
  };
  roles: {
    added: { id: string; name: string; ownerOrgName: string | null }[];
    removed: IdRef[];
    kept: IdRef[];
  };
  blockers: { code: string; roleId: string | null; orgId: string | null }[];
  outOfScopeKept: boolean;
}

interface CopyResult {
  data: CopyPayload | null;
  code: unknown;
  extensions: Record<string, unknown> | undefined;
}

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
interface AuditRecord {
  action: string;
  after?: Record<string, unknown>;
}

/** 使用者管理的全部一般權限(不含兩個欄位級 key)。 */
const MANAGER_PERMISSIONS = [
  "system.user-manager.view",
  "system.user-manager.create",
  "system.user-manager.edit",
  "system.user-manager.toggle-enabled",
  "system.user-manager.manage-orgs",
  "system.user-manager.assign-roles",
];
const MANAGER_MODULES = ["system", "system.user-manager"];

function expectSameMembers(actual: string[], expected: string[]): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
}

/**
 * 複製使用者的組織與角色(`copyUserOrgRoles`):合併 / 取代、dryRun 預覽、只在管理範圍內。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07)。「中途失敗」一案(正式送出是一個交易,失敗整個回復)需要讓寫入在半途丟錯,
 * GraphQL 端點上做不到,所以經 `app.get(RelationService)` 讓 `unlinkMany` 拋一次錯(TEST-07 的第二接縫)。
 *
 * 組織樹(root 為 seed 建的根組織):
 *   root ─┬─ 租戶甲 ─┬─ 部門一 ── 小組一
 *         │          └─ 部門二
 *         └─ 租戶乙 ── 部門A
 */
describe("複製使用者的組織與角色(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let deptOne: Types.ObjectId;
  let teamOne: Types.ObjectId;
  let deptTwo: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let deptOfB: Types.ObjectId;

  /** 管理範圍 = 租戶甲整棵 */
  let managerToken: string;
  let rootToken: string;

  let sequence = 0;
  function nextAccount(prefix: string): string {
    sequence += 1;
    return `${prefix}-${String(sequence)}`;
  }

  async function login(account: string, password = PASSWORD): Promise<string> {
    const result = await api.graphql<{ login: { accessToken: string } }>(
      LOGIN,
      { input: { account, password } },
    );
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error(`登入失敗:${account}`);
    }
    return token;
  }

  /** 建一個持有指定權限的操作者並登入;`extraRoleOwnerOrgIds` 再各給一個空角色,把管理範圍擴到那些組織。 */
  async function createManager(options: {
    orgIds: Types.ObjectId[];
    ownerOrgId: Types.ObjectId;
    permissionKeys: string[];
    extraRoleOwnerOrgIds?: Types.ObjectId[];
  }): Promise<string> {
    const account = nextAccount("manager");
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds: options.orgIds,
    });
    await createRole(api.app, connection, {
      name: `管理員角色:${account}`,
      ownerOrgId: options.ownerOrgId,
      moduleKeys: MANAGER_MODULES,
      permissionKeys: options.permissionKeys,
      assignTo: [userId],
    });
    for (const ownerOrgId of options.extraRoleOwnerOrgIds ?? []) {
      await createRole(api.app, connection, {
        name: `擴範圍角色:${account}`,
        ownerOrgId,
        assignTo: [userId],
      });
    }
    return login(account);
  }

  function member(
    prefix: string,
    orgIds: Types.ObjectId[],
  ): Promise<Types.ObjectId> {
    return createUser(connection, {
      account: nextAccount(prefix),
      password: PASSWORD,
      orgIds,
    });
  }

  function role(
    name: string,
    ownerOrgId: Types.ObjectId,
    assignTo: Types.ObjectId[],
  ): Promise<Types.ObjectId> {
    return createRole(api.app, connection, { name, ownerOrgId, assignTo });
  }

  async function copy(
    sourceId: Types.ObjectId,
    targetId: Types.ObjectId,
    options: { mode?: string; dryRun?: boolean; token?: string } = {},
  ): Promise<CopyResult> {
    const result = await api.graphql<{ copyUserOrgRoles: CopyPayload }>(
      COPY,
      {
        input: {
          sourceUserId: String(sourceId),
          targetUserId: String(targetId),
          mode: options.mode ?? "MERGE",
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        },
      },
      { accessToken: options.token ?? managerToken },
    );
    return {
      data: result.data?.copyUserOrgRoles ?? null,
      code: result.errors?.[0]?.extensions?.code,
      extensions: result.errors?.[0]?.extensions,
    };
  }

  async function linksOf(
    type: "org_user" | "user_role",
    userId: Types.ObjectId,
  ): Promise<string[]> {
    const links = await connection
      .collection("core_relationships")
      .find<{ firstId: Types.ObjectId; secondId: Types.ObjectId }>({
        type,
        ...(type === "org_user" ? { secondId: userId } : { firstId: userId }),
      })
      .toArray();
    return links.map((link) =>
      String(type === "org_user" ? link.firstId : link.secondId),
    );
  }

  const orgsOf = (userId: Types.ObjectId) => linksOf("org_user", userId);
  const rolesOf = (userId: Types.ObjectId) => linksOf("user_role", userId);

  function auditsOf(targetId: Types.ObjectId): Promise<AuditRecord[]> {
    return connection
      .collection("audit_logs")
      .find<AuditRecord>({ targetId })
      .toArray();
  }

  /** 有擁有者的租戶:擁有者持租戶管理員副本;另一位同租戶的操作者管得到他。 */
  async function createOwnedTenant(): Promise<{
    tenantId: Types.ObjectId;
    childId: Types.ObjectId;
    ownerId: Types.ObjectId;
    tenantAdminRoleId: Types.ObjectId;
    operatorToken: string;
  }> {
    const tenantId = await createOrg(connection, {
      name: nextAccount("受保護租戶"),
    });
    const childId = await createOrg(connection, {
      name: "子部門",
      parentId: tenantId,
    });
    const ownerId = await member("owner", [tenantId]);
    const tenantAdminRoleId = await role("租戶管理員", tenantId, [ownerId]);
    await connection
      .collection("roles")
      .updateOne(
        { _id: tenantAdminRoleId },
        { $set: { "settings.templateKey": "tenant-admin" } },
      );
    await connection
      .collection("orgs")
      .updateOne({ _id: tenantId }, { $set: { ownerUserId: ownerId } });
    const operatorToken = await createManager({
      orgIds: [tenantId],
      ownerOrgId: tenantId,
      permissionKeys: MANAGER_PERMISSIONS,
    });
    return { tenantId, childId, ownerId, tenantAdminRoleId, operatorToken };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-copy-user-org-roles");
    connection = api.connection;

    tenantA = await createOrg(connection, { name: "租戶甲" });
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

    managerToken = await createManager({
      orgIds: [tenantA],
      ownerOrgId: tenantA,
      permissionKeys: MANAGER_PERMISSIONS,
    });
    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("合併", () => {
    it("來源 O1 / R1、目標 O2 / R2 → 目標有 O1+O2、R1+R2,重複的去重", async () => {
      const source = await member("merge-source", [deptOne, deptTwo]);
      const target = await member("merge-target", [deptTwo]);
      const r1 = await role("部門一的角色", deptOne, [source]);
      const r2 = await role("部門二的角色", deptTwo, [target, source]);

      const result = await copy(source, target, { dryRun: false });

      expect(result.code).toBeUndefined();
      expect(result.data?.applied).toBe(true);
      expectSameMembers(await orgsOf(target), [
        String(deptOne),
        String(deptTwo),
      ]);
      expectSameMembers(await rolesOf(target), [String(r1), String(r2)]);
    });

    it("預覽回差異(角色附擁有組織名稱),資料與稽核都不動", async () => {
      const source = await member("preview-source", [deptOne]);
      const target = await member("preview-target", [deptTwo]);
      const r1 = await role("預覽的角色", deptOne, [source]);

      const result = await copy(source, target, { dryRun: true });

      expect(result.data?.applied).toBe(false);
      expect(result.data?.orgs.added).toEqual([
        { id: String(deptOne), name: "部門一" },
      ]);
      expect(result.data?.orgs.kept).toEqual([{ id: String(deptTwo) }]);
      expect(result.data?.roles.added).toEqual([
        { id: String(r1), name: "預覽的角色", ownerOrgName: "部門一" },
      ]);
      expect(await orgsOf(target)).toEqual([String(deptTwo)]);
      expect(await rolesOf(target)).toEqual([]);
      expect(await auditsOf(target)).toEqual([]);
    });

    it("沒給 dryRun 時預設只預覽", async () => {
      const source = await member("default-source", [deptOne]);
      const target = await member("default-target", [deptTwo]);

      const result = await api.graphql<{ copyUserOrgRoles: CopyPayload }>(
        COPY,
        {
          input: {
            sourceUserId: String(source),
            targetUserId: String(target),
            mode: "MERGE",
          },
        },
        { accessToken: managerToken },
      );

      expect(result.data?.copyUserOrgRoles.applied).toBe(false);
      expect(await orgsOf(target)).toEqual([String(deptTwo)]);
    });

    it("無差異:不寫關係、不寫稽核,applied 為 false", async () => {
      const source = await member("same-source", [deptOne]);
      const target = await member("same-target", [deptOne]);
      await role("兩人都有的角色", deptOne, [source, target]);

      const result = await copy(source, target, { dryRun: false });

      expect(result.code).toBeUndefined();
      expect(result.data?.applied).toBe(false);
      expect(await auditsOf(target)).toEqual([]);
    });

    it("稽核沿用四種動作,after 多 copiedFrom 與 mode", async () => {
      const source = await member("audit-source", [deptOne]);
      const target = await member("audit-target", [deptTwo]);
      await role("稽核的角色", deptOne, [source]);

      await copy(source, target, { dryRun: false });

      const audits = await auditsOf(target);
      expectSameMembers(
        audits.map((audit) => audit.action),
        ["user.add-org", "user.grant-role"],
      );
      for (const audit of audits) {
        expect(audit.after).toMatchObject({
          copiedFrom: String(source),
          mode: "MERGE",
        });
      }
    });
  });

  describe("取代", () => {
    it("根組織操作者:目標變成來源的配置,來源不變", async () => {
      const source = await member("root-replace-source", [deptOne]);
      const target = await member("root-replace-target", [deptOfB]);
      const r1 = await role("來源的角色", deptOne, [source]);
      await role("目標原本的角色", deptOfB, [target]);

      const result = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
        token: rootToken,
      });

      expect(result.code).toBeUndefined();
      expect(await orgsOf(target)).toEqual([String(deptOne)]);
      expect(await rolesOf(target)).toEqual([String(r1)]);
      expect(await orgsOf(source)).toEqual([String(deptOne)]);
      expect(await rolesOf(source)).toEqual([String(r1)]);
    });

    it("有限管理範圍:只動範圍內的,範圍外的目標關係不變、範圍外的來源不授予", async () => {
      const source = await member("scoped-source", [deptOne, deptOfB]);
      const target = await member("scoped-target", [deptTwo, deptOfB]);
      const sourceInScope = await role("來源範圍內", deptOne, [source]);
      await role("來源範圍外", tenantB, [source]);
      await role("目標範圍內", deptTwo, [target]);
      const targetOutOfScope = await role("目標範圍外", tenantB, [target]);

      const result = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
      });

      expect(result.code).toBeUndefined();
      expectSameMembers(await orgsOf(target), [
        String(deptOne),
        String(deptOfB),
      ]);
      expectSameMembers(await rolesOf(target), [
        String(sourceInScope),
        String(targetOutOfScope),
      ]);
    });

    it("有限管理範圍:差異的「保留」不列範圍外的組織與角色(留著但不露出)", async () => {
      const source = await member("kept-source", [deptOne]);
      const target = await member("kept-target", [deptOne, deptOfB]);
      const targetOutOfScope = await role("目標範圍外", tenantB, [target]);

      const result = await copy(source, target, { mode: "REPLACE" });

      const keptOrgIds = result.data?.orgs.kept.map((org) => org.id);
      const keptRoleIds = result.data?.roles.kept.map((item) => item.id);
      expect(keptOrgIds).toEqual([String(deptOne)]);
      expect(keptRoleIds).not.toContain(String(targetOutOfScope));
    });

    it("範圍外的角色因取代失去資格:允許執行、角色留著,預覽只回 outOfScopeKept", async () => {
      // 管理範圍 = 部門一 ∪ 部門A(兩個角色的擁有組織子樹);租戶甲擁有的角色在範圍外
      const token = await createManager({
        orgIds: [deptOne],
        ownerOrgId: deptOne,
        permissionKeys: MANAGER_PERMISSIONS,
        extraRoleOwnerOrgIds: [deptOfB],
      });
      const source = await member("lose-source", [deptOfB]);
      const target = await member("lose-target", [deptOne]);
      const tenantRole = await role("租戶甲的角色", tenantA, [target]);

      const preview = await copy(source, target, {
        mode: "REPLACE",
        token,
      });
      expect(preview.data?.outOfScopeKept).toBe(true);
      expect(preview.data?.blockers).toEqual([]);

      const result = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
        token,
      });
      expect(result.code).toBeUndefined();
      expect(await orgsOf(target)).toEqual([String(deptOfB)]);
      expect(await rolesOf(target)).toEqual([String(tenantRole)]);
    });
  });

  describe("授予資格以複製後的所屬組織判斷", () => {
    it("目標原本不合格、加上來源的組織後合格 → 成功", async () => {
      const source = await member("eligible-source", [teamOne]);
      const target = await member("eligible-target", [deptTwo]);
      const teamRole = await role("小組一的角色", teamOne, [source]);

      const result = await copy(source, target, { dryRun: false });

      expect(result.code).toBeUndefined();
      expect(await rolesOf(target)).toEqual([String(teamRole)]);
    });

    it("複製後仍不合格 → 預覽列 blocker,送出回 USER_NOT_ELIGIBLE 且沒有寫入", async () => {
      // 來源持有「組織外」的授予:所屬組織不在該角色擁有組織的子樹內
      const source = await member("ineligible-source", [deptTwo]);
      const target = await member("ineligible-target", [deptTwo]);
      const teamRole = await role("組織外的角色", teamOne, [source]);

      const preview = await copy(source, target);
      expect(preview.data?.blockers).toEqual([
        { code: "USER_NOT_ELIGIBLE", roleId: String(teamRole), orgId: null },
      ]);

      const result = await copy(source, target, { dryRun: false });
      expect(result.code).toBe("USER_NOT_ELIGIBLE");
      expect(result.extensions?.roleId).toBe(String(teamRole));
      expect(await rolesOf(target)).toEqual([]);
    });
  });

  describe("停用的角色不得新授予", () => {
    it("複製:預覽列 ROLE_DISABLED,送出被拒且沒有寫入", async () => {
      const source = await member("disabled-source", [deptOne]);
      const target = await member("disabled-target", [deptTwo]);
      const disabledRole = await role("停用的角色", deptOne, [source]);
      await connection
        .collection("roles")
        .updateOne({ _id: disabledRole }, { $set: { enabled: false } });

      const preview = await copy(source, target);
      expect(preview.data?.blockers).toEqual([
        { code: "ROLE_DISABLED", roleId: String(disabledRole), orgId: null },
      ]);

      const result = await copy(source, target, { dryRun: false });
      expect(result.code).toBe("ROLE_DISABLED");
      expect(await orgsOf(target)).toEqual([String(deptTwo)]);
    });

    it("指派角色(assignUserRoles)同樣回 ROLE_DISABLED", async () => {
      const target = await member("assign-disabled", [deptOne]);
      const disabledRole = await role("停用的角色", deptOne, []);
      await connection
        .collection("roles")
        .updateOne({ _id: disabledRole }, { $set: { enabled: false } });

      const result = await api.graphql(
        ASSIGN_USER_ROLES,
        {
          input: { userId: String(target), roleIds: [String(disabledRole)] },
        },
        { accessToken: managerToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("ROLE_DISABLED");
      expect(await rolesOf(target)).toEqual([]);
    });
  });

  describe("後端拒絕", () => {
    it("缺 manage-orgs → FORBIDDEN", async () => {
      const token = await createManager({
        orgIds: [tenantA],
        ownerOrgId: tenantA,
        permissionKeys: [
          "system.user-manager.view",
          "system.user-manager.assign-roles",
        ],
      });
      const source = await member("no-orgs-source", [deptOne]);
      const target = await member("no-orgs-target", [deptTwo]);

      const result = await copy(source, target, { token });

      expect(result.code).toBe("FORBIDDEN");
    });

    it("缺 assign-roles → FORBIDDEN", async () => {
      const token = await createManager({
        orgIds: [tenantA],
        ownerOrgId: tenantA,
        permissionKeys: [
          "system.user-manager.view",
          "system.user-manager.manage-orgs",
        ],
      });
      const source = await member("no-roles-source", [deptOne]);
      const target = await member("no-roles-target", [deptTwo]);

      const result = await copy(source, target, { token });

      expect(result.code).toBe("FORBIDDEN");
    });

    it("缺 view → FORBIDDEN", async () => {
      const token = await createManager({
        orgIds: [tenantA],
        ownerOrgId: tenantA,
        permissionKeys: [
          "system.user-manager.manage-orgs",
          "system.user-manager.assign-roles",
        ],
      });
      const source = await member("no-view-source", [deptOne]);
      const target = await member("no-view-target", [deptTwo]);

      const result = await copy(source, target, { token });

      expect(result.code).toBe("FORBIDDEN");
    });

    it("來源與目標同一人 → VALIDATION_FAILED", async () => {
      const user = await member("same-person", [deptOne]);

      const result = await copy(user, user);

      expect(result.code).toBe("VALIDATION_FAILED");
    });

    it("目標已刪除 → NOT_FOUND", async () => {
      const source = await member("deleted-source", [deptOne]);
      const target = await member("deleted-target", [deptTwo]);
      await connection
        .collection("users")
        .updateOne({ _id: target }, { $set: { deletedAt: new Date() } });

      const result = await copy(source, target);

      expect(result.code).toBe("NOT_FOUND");
    });

    it("目標在管理範圍外(別的租戶)→ NOT_FOUND", async () => {
      const source = await member("in-scope-source", [deptOne]);
      const target = await member("other-tenant-target", [deptOfB]);

      const result = await copy(source, target);

      expect(result.code).toBe("NOT_FOUND");
    });

    it("目標是操作者本人 → VALIDATION_FAILED(取代會把自己鎖在門外)", async () => {
      const source = await member("self-source", [deptOne]);
      const root = await connection
        .collection("users")
        .findOne<{ _id: Types.ObjectId }>({ account: ROOT_ADMIN.account });
      if (root === null) {
        throw new Error("找不到 root 帳號");
      }

      const result = await copy(source, root._id, { token: rootToken });

      expect(result.code).toBe("VALIDATION_FAILED");
      expect(result.extensions?.fields).toEqual(["targetUserId"]);
    });

    it("根組織操作者、來源沒有存活的所屬組織、取代 → LAST_ORG 且沒有寫入", async () => {
      const doomedOrg = await createOrg(connection, {
        name: "即將刪除的組織",
        parentId: tenantA,
      });
      const source = await member("orphan-source", [doomedOrg]);
      const target = await member("orphan-target", [deptTwo]);
      await connection
        .collection("orgs")
        .updateOne({ _id: doomedOrg }, { $set: { deletedAt: new Date() } });

      const result = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
        token: rootToken,
      });

      expect(result.code).toBe("LAST_ORG");
      expect(await orgsOf(target)).toEqual([String(deptTwo)]);
    });

    it("來源在管理範圍外 → NOT_FOUND", async () => {
      const source = await member("outside-source", [deptOfB]);
      const target = await member("outside-target", [deptTwo]);

      const result = await copy(source, target);

      expect(result.code).toBe("NOT_FOUND");
    });

    it("id 不合法 → VALIDATION_FAILED", async () => {
      const target = await member("bad-id-target", [deptTwo]);
      const result = await api.graphql(
        COPY,
        {
          input: {
            sourceUserId: "not-an-id",
            targetUserId: String(target),
            mode: "MERGE",
          },
        },
        { accessToken: managerToken },
      );

      expect(result.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("擁有者保護(root 例外照現行)", () => {
    it("取代會移出擁有的組織、解除租戶管理員授予 → 預覽列兩筆 blocker,送出回 OWNER_PROTECTED 且沒有寫入", async () => {
      const { tenantId, childId, ownerId, tenantAdminRoleId, operatorToken } =
        await createOwnedTenant();
      const source = await member("plain-source", [childId]);

      const preview = await copy(source, ownerId, {
        mode: "REPLACE",
        token: operatorToken,
      });
      expectSameMembers(
        (preview.data?.blockers ?? []).map(
          (blocker) =>
            `${blocker.code}:${String(blocker.orgId ?? blocker.roleId)}`,
        ),
        [
          `OWNER_PROTECTED:${String(tenantId)}`,
          `OWNER_PROTECTED:${String(tenantAdminRoleId)}`,
        ],
      );

      const result = await copy(source, ownerId, {
        mode: "REPLACE",
        dryRun: false,
        token: operatorToken,
      });
      expect(result.code).toBe("OWNER_PROTECTED");
      expect(await orgsOf(ownerId)).toEqual([String(tenantId)]);
      expect(await rolesOf(ownerId)).toEqual([String(tenantAdminRoleId)]);
    });

    it("根組織操作者可以取代擁有者的配置", async () => {
      const { childId, ownerId } = await createOwnedTenant();
      const source = await member("plain-source-root", [childId]);

      const result = await copy(source, ownerId, {
        mode: "REPLACE",
        dryRun: false,
        token: rootToken,
      });

      expect(result.code).toBeUndefined();
      expect(await orgsOf(ownerId)).toEqual([String(childId)]);
      expect(await rolesOf(ownerId)).toEqual([]);
    });
  });

  it("停用的目標可以複製,複製後仍是停用", async () => {
    const source = await member("to-disabled-source", [deptOne]);
    const target = await createUser(connection, {
      account: nextAccount("disabled-target"),
      password: PASSWORD,
      orgIds: [deptTwo],
      enabled: false,
    });

    const result = await copy(source, target, { dryRun: false });

    expect(result.code).toBeUndefined();
    const stored = await connection
      .collection("users")
      .findOne<{ enabled: boolean }>({ _id: target });
    expect(stored?.enabled).toBe(false);
  });

  describe("中途失敗", () => {
    it("解除角色那一步拋錯 → 回錯、整個回復(已加的組織與角色、稽核都不留);重跑完成", async () => {
      const source = await member("fail-source", [deptOne]);
      const target = await member("fail-target", [deptTwo]);
      const r1 = await role("來源的角色", deptOne, [source]);
      const r2 = await role("目標的角色", deptTwo, [target]);
      const relations = api.app.get(RelationService);
      // 加組織、授角色(ensureLinks + 稽核)都已在交易內寫入,第三步解除角色才拋錯
      const spy = jest
        .spyOn(relations, "unlinkMany")
        .mockRejectedValueOnce(new Error("模擬寫入失敗"));

      const failed = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
      });
      spy.mockRestore();
      expect(failed.data).toBeNull();
      expect(await orgsOf(target)).toEqual([String(deptTwo)]);
      expect(await rolesOf(target)).toEqual([String(r2)]);
      expect(await auditsOf(target)).toEqual([]);

      const retried = await copy(source, target, {
        mode: "REPLACE",
        dryRun: false,
      });
      expect(retried.code).toBeUndefined();
      expect(await orgsOf(target)).toEqual([String(deptOne)]);
      expect(await rolesOf(target)).toEqual([String(r1)]);
    });
  });
});
