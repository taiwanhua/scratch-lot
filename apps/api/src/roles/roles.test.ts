import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import {
  type Manager,
  ROLE_MANAGER_PERMISSIONS,
  type RolesWorld,
  createManager,
  createMember,
  latestAudit,
  login,
  nextAccount,
  startRolesWorld,
} from "./roles-test-support";

const ROLES = /* GraphQL */ `
  query Roles($input: RolesInput!) {
    roles(input: $input) {
      totalCount
      page
      pageSize
      items {
        id
        name
        description
        enabled
        isSystem
        isTemplateCopy
        userCount
        ownerOrg {
          id
          name
        }
      }
    }
  }
`;

const ROLE = /* GraphQL */ `
  query Role($id: ID!) {
    role(id: $id) {
      role {
        id
        name
        description
        enabled
        ownerOrg {
          id
          name
        }
        userCount
      }
    }
  }
`;

const CREATE_ROLE = /* GraphQL */ `
  mutation CreateRole($input: CreateRoleInput!) {
    createRole(input: $input) {
      role {
        id
        name
        description
        enabled
        ownerOrg {
          id
          name
        }
      }
    }
  }
`;

const UPDATE_ROLE = /* GraphQL */ `
  mutation UpdateRole($input: UpdateRoleInput!) {
    updateRole(input: $input) {
      role {
        id
        name
        description
      }
    }
  }
`;

const SET_ROLE_ENABLED = /* GraphQL */ `
  mutation SetRoleEnabled($input: SetRoleEnabledInput!) {
    setRoleEnabled(input: $input) {
      role {
        id
        enabled
      }
    }
  }
`;

const DELETE_ROLE = /* GraphQL */ `
  mutation DeleteRole($input: DeleteRoleInput!) {
    deleteRole(input: $input) {
      success
      deletedId
    }
  }
`;

const ME_MODULES = /* GraphQL */ `
  query Me {
    me {
      modules {
        key
        permissions
      }
    }
  }
`;

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  isSystem: boolean;
  isTemplateCopy: boolean;
  userCount: number;
  ownerOrg: { id: string; name: string } | null;
}

interface RolesData {
  roles: {
    totalCount: number;
    page: number;
    pageSize: number;
    items: RoleRow[];
  };
}

interface RoleData {
  role: { role: RoleRow };
}

interface CreateRoleData {
  createRole: { role: RoleRow };
}

interface MeData {
  me: { modules: { key: string; permissions: string[] }[] };
}

/**
 * 角色管理的清單 / CRUD / 刪除前置 / 停用連動(規則正本 docs/modules/role-manager.md)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 */
describe("角色管理:清單與 CRUD(GraphQL 端點 + 真 MongoDB)", () => {
  let world: RolesWorld;
  let connection: Connection;
  let manager: Manager;
  let rootToken: string;

  beforeAll(async () => {
    world = await startRolesWorld("cookhome-test-roles");
    connection = world.connection;
    manager = await createManager(world, {
      orgIds: [world.tenantA],
      ownerOrgId: world.tenantA,
    });
    const rootAccount = nextAccount("root-operator");
    const rootUserId = await createMember(
      world,
      [world.rootOrgId],
      "root-operator",
    );
    await connection
      .collection("users")
      .updateOne({ _id: rootUserId }, { $set: { account: rootAccount } });
    await createRole(world.api.app, connection, {
      name: `根組織操作者-${rootAccount}`,
      ownerOrgId: world.rootOrgId,
      moduleKeys: ["system", "system.role-manager"],
      permissionKeys: ROLE_MANAGER_PERMISSIONS,
      assignTo: [rootUserId],
    });
    rootToken = await login(world, rootAccount);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  async function listAs(
    token: string,
    input: Record<string, unknown> = {},
  ): Promise<RolesData["roles"]> {
    const result = await world.api.graphql<RolesData>(
      ROLES,
      { input },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("roles 沒有回資料");
    }
    return result.data.roles;
  }

  async function createRoleAs(
    token: string,
    input: Record<string, unknown>,
  ): Promise<{ data: CreateRoleData | null; code: string | undefined }> {
    const result = await world.api.graphql<CreateRoleData>(
      CREATE_ROLE,
      { input },
      { accessToken: token },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  describe("清單:擁有組織在管理範圍內(ADR-0003 / ADR-0005)", () => {
    it("只列擁有組織落在操作者管理範圍內的角色,並附 ownerOrg / userCount", async () => {
      const inScope = await createRole(world.api.app, connection, {
        name: "部門一的角色",
        ownerOrgId: world.deptOne,
      });
      const outOfScope = await createRole(world.api.app, connection, {
        name: "租戶乙的角色",
        ownerOrgId: world.tenantB,
      });
      const holder = await createMember(world, [world.deptOne]);
      await world.connection.collection("core_relationships").insertOne({
        type: "user_role",
        firstId: holder,
        secondId: inScope,
        thirdId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });

      const page = await listAs(manager.token);
      const ids = page.items.map((role) => role.id);
      expect(ids).toContain(String(inScope));
      expect(ids).not.toContain(String(outOfScope));

      const row = page.items.find((role) => role.id === String(inScope));
      expect(row?.ownerOrg).toEqual({
        id: String(world.deptOne),
        name: "部門一",
      });
      expect(row?.userCount).toBe(1);
      expect(row?.isSystem).toBe(false);
      expect(row?.isTemplateCopy).toBe(false);
    });

    it("種子角色只有根組織的操作者看得到(擁有組織 = 根組織)", async () => {
      const rootPage = await listAs(rootToken, { pageSize: 100 });
      const rootNames = rootPage.items.map((role) => role.name);
      expect(rootNames).toContain("超級管理員");
      expect(rootNames).toContain("租戶管理員");

      const tenantPage = await listAs(manager.token, { pageSize: 100 });
      const tenantNames = tenantPage.items.map((role) => role.name);
      expect(tenantNames).not.toContain("超級管理員");
      expect(tenantNames).not.toContain("租戶管理員");
    });

    it("keyword 比對名稱與描述,分頁回 page / pageSize / totalCount", async () => {
      await createRole(world.api.app, connection, {
        name: "夜班值勤",
        ownerOrgId: world.deptTwo,
      });
      const page = await listAs(manager.token, {
        keyword: "夜班",
        page: 1,
        pageSize: 5,
      });
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(5);
      expect(page.totalCount).toBe(1);
      expect(page.items[0]?.name).toBe("夜班值勤");
    });

    it("ownerOrgId 只留擁有組織正好是它的角色,不含子樹", async () => {
      const onDeptTwo = await createRole(world.api.app, connection, {
        name: "篩選用:部門二的角色",
        ownerOrgId: world.deptTwo,
      });
      const onTeamOne = await createRole(world.api.app, connection, {
        name: "篩選用:小組一的角色",
        ownerOrgId: world.teamOne,
      });

      const page = await listAs(manager.token, {
        ownerOrgId: String(world.deptOne),
        pageSize: 100,
      });
      const ids = page.items.map((role) => role.id);
      expect(ids).not.toContain(String(onDeptTwo));
      // 小組一在部門一底下,但「擁有組織」是小組一 ⇒ 篩部門一時不該出現
      expect(ids).not.toContain(String(onTeamOne));
      expect(
        page.items.every((role) => role.ownerOrg?.id === String(world.deptOne)),
      ).toBe(true);
      expect(page.totalCount).toBe(page.items.length);
    });

    it("ownerOrgId 與 keyword 可疊加", async () => {
      await createRole(world.api.app, connection, {
        name: "疊加測試:日間值勤",
        ownerOrgId: world.deptTwo,
      });
      await createRole(world.api.app, connection, {
        name: "疊加測試:日間巡檢",
        ownerOrgId: world.deptOne,
      });
      const page = await listAs(manager.token, {
        ownerOrgId: String(world.deptTwo),
        keyword: "疊加測試",
        pageSize: 100,
      });
      expect(page.items.map((role) => role.name)).toEqual([
        "疊加測試:日間值勤",
      ]);
    });

    it("ownerOrgId 指到管理範圍外的組織 → 空清單(不透露該組織存在)", async () => {
      await createRole(world.api.app, connection, {
        name: "租戶乙的篩選對象",
        ownerOrgId: world.tenantB,
      });
      const page = await listAs(manager.token, {
        ownerOrgId: String(world.tenantB),
        pageSize: 100,
      });
      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
    });

    it("ownerOrgId 不給 / 給 null = 不篩(整個管理範圍)", async () => {
      const all = await listAs(manager.token, { pageSize: 100 });
      const withNull = await listAs(manager.token, {
        ownerOrgId: null,
        pageSize: 100,
      });
      expect(withNull.totalCount).toBe(all.totalCount);
    });

    it("管理範圍外的角色:單筆查詢回 NOT_FOUND(不透露存在與否的差別)", async () => {
      const outOfScope = await createRole(world.api.app, connection, {
        name: "租戶乙的另一個角色",
        ownerOrgId: world.tenantB,
      });
      const result = await world.api.graphql<RoleData>(
        ROLE,
        { id: String(outOfScope) },
        { accessToken: manager.token },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });
  });

  describe("新增 / 編輯 / 停用", () => {
    it("新增:擁有組織限管理範圍內,並寫 role.create 稽核", async () => {
      const { data, code } = await createRoleAs(manager.token, {
        name: "南港店管理員",
        description: "只管南港店子樹",
        ownerOrgId: String(world.deptOne),
      });
      expect(code).toBeUndefined();
      const role = data?.createRole.role;
      expect(role?.name).toBe("南港店管理員");
      expect(role?.enabled).toBe(true);
      expect(role?.ownerOrg?.id).toBe(String(world.deptOne));

      const audit = await latestAudit(
        world,
        "role.create",
        new Types.ObjectId(role?.id),
      );
      expect(audit?.targetType).toBe("role");
      expect(audit?.after?.ownerOrgId).toBe(String(world.deptOne));
    });

    it("新增:不給 ownerOrgId 時預設操作者的當前組織", async () => {
      const { data, code } = await createRoleAs(manager.token, {
        name: "預設擁有組織的角色",
      });
      expect(code).toBeUndefined();
      // 操作者只屬租戶甲 ⇒ 登入時的當前組織就是租戶甲
      expect(data?.createRole.role.ownerOrg?.id).toBe(String(world.tenantA));
    });

    it("新增:擁有組織在管理範圍外 → FORBIDDEN", async () => {
      const { code } = await createRoleAs(manager.token, {
        name: "越界的角色",
        ownerOrgId: String(world.tenantB),
      });
      expect(code).toBe("FORBIDDEN");
    });

    it("新增:空白名稱 → VALIDATION_FAILED", async () => {
      const { code } = await createRoleAs(manager.token, {
        name: " ".repeat(3),
      });
      expect(code).toBe("VALIDATION_FAILED");
    });

    it("編輯:名稱與描述;description 送 null 即清空(GQL-06)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "待改名",
        ownerOrgId: world.deptOne,
      });
      await world.connection
        .collection("roles")
        .updateOne({ _id: roleId }, { $set: { description: "舊描述" } });

      const renamed = await world.api.graphql<{
        updateRole: { role: RoleRow };
      }>(
        UPDATE_ROLE,
        { input: { id: String(roleId), name: "已改名" } },
        { accessToken: manager.token },
      );
      expect(renamed.errors).toBeUndefined();
      expect(renamed.data?.updateRole.role.name).toBe("已改名");
      // 缺席 = 不動
      expect(renamed.data?.updateRole.role.description).toBe("舊描述");

      const cleared = await world.api.graphql<{
        updateRole: { role: RoleRow };
      }>(
        UPDATE_ROLE,
        { input: { id: String(roleId), description: null } },
        { accessToken: manager.token },
      );
      expect(cleared.data?.updateRole.role.description).toBeNull();

      const audit = await latestAudit(world, "role.edit", roleId);
      expect(audit?.before?.description).toBe("舊描述");
    });

    it("停用後 PermissionResolver 立即排除該角色(ADR-0011 步驟 2)", async () => {
      const holderAccount = nextAccount("holder");
      const holderId = await createMember(world, [world.deptOne], "holder");
      await connection
        .collection("users")
        .updateOne({ _id: holderId }, { $set: { account: holderAccount } });
      const roleId = await createRole(world.api.app, connection, {
        name: "示範模組2 的角色",
        ownerOrgId: world.deptOne,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.view"],
        assignTo: [holderId],
      });
      const holderToken = await login(world, holderAccount);

      const before = await world.api.graphql<MeData>(
        ME_MODULES,
        {},
        { accessToken: holderToken },
      );
      expect(before.data?.me.modules.map((module) => module.key)).toContain(
        "demo.sample-two",
      );

      const toggled = await world.api.graphql(
        SET_ROLE_ENABLED,
        { input: { id: String(roleId), enabled: false } },
        { accessToken: manager.token },
      );
      expect(toggled.errors).toBeUndefined();

      const after = await world.api.graphql<MeData>(
        ME_MODULES,
        {},
        { accessToken: holderToken },
      );
      expect(after.data?.me.modules).toHaveLength(0);

      const audit = await latestAudit(world, "role.toggle-enabled", roleId);
      expect(audit?.before?.enabled).toBe(true);
      expect(audit?.after?.enabled).toBe(false);
    });
  });

  async function deleteAs(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<{
    code: string | undefined;
    reasons: string[] | undefined;
    deletedId: string | undefined;
  }> {
    const result = await world.api.graphql<{
      deleteRole: { success: boolean; deletedId: string };
    }>(DELETE_ROLE, { input: { id: String(roleId) } }, { accessToken: token });
    const extensions = result.errors?.[0]?.extensions;
    return {
      code: extensions?.code,
      reasons: (extensions as { reasons?: string[] } | undefined)?.reasons,
      deletedId: result.data?.deleteRole.deletedId,
    };
  }

  describe("刪除前置(無授予 / 非種子 / 非租戶副本)", () => {
    it("前置全過:軟刪除、清單不再出現、寫 role.delete 稽核", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "可刪除的角色",
        ownerOrgId: world.deptTwo,
      });
      const { code, deletedId } = await deleteAs(manager.token, roleId);
      expect(code).toBeUndefined();
      expect(deletedId).toBe(String(roleId));

      const stored = await connection
        .collection("roles")
        .findOne<{ deletedAt: Date | null }>({ _id: roleId });
      expect(stored?.deletedAt).not.toBeNull();

      const page = await listAs(manager.token, { pageSize: 100 });
      expect(page.items.map((role) => role.id)).not.toContain(String(roleId));

      const audit = await latestAudit(world, "role.delete", roleId);
      expect(audit?.before?.name).toBe("可刪除的角色");
    });

    it("還有授予 → ROLE_NOT_DELETABLE(reasons 含 HAS_GRANTS)", async () => {
      const holderId = await createMember(world, [world.deptOne]);
      const roleId = await createRole(world.api.app, connection, {
        name: "有人持有的角色",
        ownerOrgId: world.deptOne,
        assignTo: [holderId],
      });
      const { code, reasons } = await deleteAs(manager.token, roleId);
      expect(code).toBe("ROLE_NOT_DELETABLE");
      expect(reasons).toContain("HAS_GRANTS");
    });

    it("種子角色 → reasons 含 SYSTEM_ROLE(以根組織操作者才碰得到)", async () => {
      const template = await connection
        .collection("roles")
        .findOne<{ _id: Types.ObjectId }>({ key: "tenant-admin" });
      if (!template) {
        throw new Error("測試資料庫沒有種子角色 tenant-admin(seed 未跑?)");
      }
      const { code, reasons } = await deleteAs(rootToken, template._id);
      expect(code).toBe("ROLE_NOT_DELETABLE");
      expect(reasons).toContain("SYSTEM_ROLE");
    });

    it("租戶管理員副本 → reasons 含 TEMPLATE_COPY", async () => {
      const copyId = await createRole(world.api.app, connection, {
        name: "租戶管理員(副本)",
        ownerOrgId: world.deptTwo,
      });
      await connection
        .collection("roles")
        .updateOne(
          { _id: copyId },
          { $set: { "settings.templateKey": "tenant-admin" } },
        );
      const { code, reasons } = await deleteAs(manager.token, copyId);
      expect(code).toBe("ROLE_NOT_DELETABLE");
      expect(reasons).toEqual(["TEMPLATE_COPY"]);
    });

    it("多項不過時 reasons 逐項列出", async () => {
      const holderId = await createMember(world, [world.deptOne]);
      const roleId = await createRole(world.api.app, connection, {
        name: "又有人又是副本",
        ownerOrgId: world.deptOne,
        assignTo: [holderId],
      });
      await connection
        .collection("roles")
        .updateOne(
          { _id: roleId },
          { $set: { "settings.templateKey": "tenant-admin" } },
        );
      const { reasons } = await deleteAs(manager.token, roleId);
      expect(reasons).toEqual(["HAS_GRANTS", "TEMPLATE_COPY"]);
    });
  });

  describe("守門(@RequirePermission;role-manager.md 權限表)", () => {
    it("只有 view 的操作者:清單可讀,但新增 / 刪除 FORBIDDEN", async () => {
      const viewer = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: ["system.role-manager.view"],
      });
      const page = await listAs(viewer.token);
      expect(page.totalCount).toBeGreaterThan(0);

      const { code } = await createRoleAs(viewer.token, {
        name: "不該建得起來",
      });
      expect(code).toBe("FORBIDDEN");
    });

    it("完全沒有角色管理權限 → FORBIDDEN", async () => {
      const outsider = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.user-manager"],
        permissionKeys: ["system.user-manager.view"],
      });
      const result = await world.api.graphql(
        ROLES,
        { input: {} },
        { accessToken: outsider.token },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  function failNextAudit() {
    return jest
      .spyOn(world.api.app.get(AuditService), "record")
      .mockRejectedValueOnce(new Error("模擬稽核寫入失敗"));
  }

  function mutate(query: string, input: Record<string, unknown>) {
    return world.api.graphql(query, { input }, { accessToken: manager.token });
  }

  async function roleRow(roleId: Types.ObjectId) {
    return connection
      .collection("roles")
      .findOne<{ name: string; enabled: boolean; deletedAt: Date | null }>({
        _id: roleId,
      });
  }

  describe("交易(TX-01):最後一步稽核寫入失敗,前面的寫入整個回復", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("createRole:角色與擁有組織關聯都不留下", async () => {
      const audit = failNextAudit();
      const { code } = await createRoleAs(manager.token, {
        name: "回復用的新角色",
        ownerOrgId: String(world.deptOne),
      });

      expect(code).toBeDefined();
      expect(audit).toHaveBeenCalledTimes(1);
      await expect(
        connection
          .collection("roles")
          .countDocuments({ name: "回復用的新角色" }),
      ).resolves.toBe(0);
    });

    it("updateRole / setRoleEnabled / deleteRole:角色維持原樣", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "回復用的角色",
        ownerOrgId: world.deptOne,
      });

      const audit = failNextAudit();
      const updated = await mutate(UPDATE_ROLE, {
        id: String(roleId),
        name: "改過的名稱",
      });
      failNextAudit();
      const disabled = await mutate(SET_ROLE_ENABLED, {
        id: String(roleId),
        enabled: false,
      });
      failNextAudit();
      const removed = await mutate(DELETE_ROLE, { id: String(roleId) });

      expect(updated.errors).toBeDefined();
      expect(disabled.errors).toBeDefined();
      expect(removed.errors).toBeDefined();
      expect(audit).toHaveBeenCalledTimes(3);
      await expect(roleRow(roleId)).resolves.toMatchObject({
        name: "回復用的角色",
        enabled: true,
        deletedAt: null,
      });
    });
  });
});
