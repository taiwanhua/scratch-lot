import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import {
  ALL_MODULE_KEYS,
  ALL_WILDCARD_KEYS,
  type Manager,
  ROOT_ONLY_MODULE_KEYS,
  type RolesWorld,
  createManager,
  createMember,
  login,
  nextAccount,
  startRolesWorld,
  storedModuleKeys,
} from "./roles-test-support";

const ROLE = /* GraphQL */ `
  query Role($id: ID!) {
    role(id: $id) {
      role {
        id
        name
        enabled
        kind
        abilities {
          canEdit
          canEditMatrix
          canToggleEnabled
          canDelete
        }
        ownerOrg {
          id
          name
          tenantTop {
            id
            name
          }
        }
      }
    }
  }
`;

const ROLES = /* GraphQL */ `
  query Roles($input: RolesInput!) {
    roles(input: $input) {
      items {
        id
        name
        kind
        abilities {
          canEdit
          canEditMatrix
          canToggleEnabled
          canDelete
        }
        ownerOrg {
          id
          name
          tenantTop {
            id
            name
          }
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

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation SaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      shrinkOnly
      role {
        id
      }
    }
  }
`;

const ROLE_MATRIX = /* GraphQL */ `
  query RoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      shrinkOnly
      ceiling {
        moduleKeys
        permissionKeys
      }
    }
  }
`;

interface Abilities {
  canEdit: boolean;
  canEditMatrix: boolean;
  canToggleEnabled: boolean;
  canDelete: boolean;
}

interface OrgRef {
  id: string;
  name: string;
}

/** `roleMatrix` 的回傳,本檔只看種類規則相關的兩欄(樹與 granted 由 role-matrix.test.ts 顧)。 */
interface MatrixRow {
  shrinkOnly: boolean;
  /** 預設角色的天花板;其他種類為 null */
  ceiling: { moduleKeys: string[]; permissionKeys: string[] } | null;
}

interface RoleRow {
  id: string;
  name: string;
  enabled: boolean;
  kind: string;
  abilities: Abilities;
  ownerOrg: (OrgRef & { tenantTop: OrgRef | null }) | null;
}

/**
 * 角色種類規則、自鎖保護與 `abilities`(規則表正本 ADR-0004 與
 * `docs/modules/role-manager.md`,純函式正本 `role-rules.ts`)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);案名逐條對應規則表的一格。
 */
describe("角色種類規則 + 自鎖保護(GraphQL 端點 + 真 MongoDB)", () => {
  let world: RolesWorld;
  let connection: Connection;
  /** 租戶甲的管理員(非根組織);他自己持有 `manager.roleId` — 自鎖保護的對象 */
  let manager: Manager;
  /** 根組織的操作者:管理範圍 = 全部,`isRootOperator` = true */
  let root: { token: string; roleId: Types.ObjectId };

  beforeAll(async () => {
    world = await startRolesWorld("cookhome-test-role-kinds");
    connection = world.connection;
    manager = await createManager(world, {
      orgIds: [world.tenantA],
      ownerOrgId: world.tenantA,
    });

    const account = nextAccount("root-kinds");
    const userId = await createMember(world, [world.rootOrgId], "root-kinds");
    await connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { account } });
    // 根組織專屬模組也給:天花板要測的是「操作者搆得到、但模板沒有」,
    // 操作者自己就沒有的話會先被 subset-only 那一道擋掉,測不到天花板
    const roleId = await createRole(world.api.app, connection, {
      name: `根組織操作者-${account}`,
      ownerOrgId: world.rootOrgId,
      moduleKeys: ALL_MODULE_KEYS,
      permissionKeys: ALL_WILDCARD_KEYS,
      assignTo: [userId],
    });
    root = { token: await login(world, account), roleId };
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  /** 開通租戶複製出來的「預設角色」:以 `settings.templateKey` 標記(ADR-0009)。 */
  async function newTemplateCopy(name: string): Promise<Types.ObjectId> {
    const roleId = await createRole(world.api.app, connection, {
      name,
      ownerOrgId: world.deptOne,
      moduleKeys: ["demo", "demo.sample-two"],
      permissionKeys: ["demo.sample-two.*"],
    });
    await connection
      .collection("roles")
      .updateOne(
        { _id: roleId },
        { $set: { "settings.templateKey": "tenant-admin" } },
      );
    return roleId;
  }

  async function roleAs(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<RoleRow> {
    const result = await world.api.graphql<{ role: { role: RoleRow } }>(
      ROLE,
      { id: String(roleId) },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("role 沒有回資料");
    }
    return result.data.role.role;
  }

  async function enabledOf(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<boolean> {
    const row = await roleAs(token, roleId);
    return row.enabled;
  }

  async function abilitiesOf(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<Abilities> {
    const row = await roleAs(token, roleId);
    return row.abilities;
  }

  async function canToggleEnabledOf(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<boolean> {
    const abilities = await abilitiesOf(token, roleId);
    return abilities.canToggleEnabled;
  }

  async function canDeleteOf(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<boolean> {
    const abilities = await abilitiesOf(token, roleId);
    return abilities.canDelete;
  }

  async function tenantTopOf(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<OrgRef | null> {
    const row = await roleAs(token, roleId);
    return row.ownerOrg?.tenantTop ?? null;
  }

  async function seedRoleId(key: string): Promise<Types.ObjectId> {
    const role = await connection
      .collection<{ _id: Types.ObjectId }>("roles")
      .findOne({ key });
    if (!role) {
      throw new Error(`找不到種子角色 ${key}`);
    }
    return role._id;
  }

  interface Failure {
    code: string | undefined;
    reason: string | undefined;
  }

  function failureOf(errors: readonly { extensions?: unknown }[]): Failure {
    const extensions = errors[0]?.extensions as
      { code?: string; reason?: string } | undefined;
    return { code: extensions?.code, reason: extensions?.reason };
  }

  async function setEnabledAs(
    token: string,
    roleId: Types.ObjectId,
    enabled: boolean,
  ): Promise<Failure> {
    const result = await world.api.graphql(
      SET_ROLE_ENABLED,
      { input: { id: String(roleId), enabled } },
      { accessToken: token },
    );
    return failureOf(result.errors ?? []);
  }

  async function saveMatrixAs(
    token: string,
    roleId: Types.ObjectId,
    moduleKeys: string[],
    permissionKeys: string[],
  ): Promise<Failure> {
    const result = await world.api.graphql(
      SAVE_ROLE_MATRIX,
      { input: { roleId: String(roleId), moduleKeys, permissionKeys } },
      { accessToken: token },
    );
    return failureOf(result.errors ?? []);
  }

  async function matrixAs(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<MatrixRow> {
    const result = await world.api.graphql<{ roleMatrix: MatrixRow }>(
      ROLE_MATRIX,
      { roleId: String(roleId) },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("roleMatrix 沒有回資料");
    }
    return result.data.roleMatrix;
  }

  async function shrinkOnlyAs(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<boolean | undefined> {
    const row = await matrixAs(token, roleId);
    return row.shrinkOnly;
  }

  describe("kind 與 abilities:api 依操作者算好,前端不重算", () => {
    it("種子角色 → kind SYSTEM,四個動作全 false", async () => {
      const row = await roleAs(root.token, await seedRoleId("super-admin"));
      expect(row.kind).toBe("SYSTEM");
      expect(row.abilities).toEqual({
        canEdit: false,
        canEditMatrix: false,
        canToggleEnabled: false,
        canDelete: false,
      });
    });

    it("預設角色 → kind TEMPLATE_COPY;可改名與編矩陣、不可刪;停用只有 root 為 true", async () => {
      const roleId = await newTemplateCopy("預設角色(abilities)");

      const asTenant = await roleAs(manager.token, roleId);
      expect(asTenant.kind).toBe("TEMPLATE_COPY");
      expect(asTenant.abilities).toEqual({
        canEdit: true,
        canEditMatrix: true,
        canToggleEnabled: false,
        canDelete: false,
      });

      expect(await canToggleEnabledOf(root.token, roleId)).toBe(true);
    });

    it("自建角色 → kind CUSTOM;無授予時可刪,有人持有就不可刪", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "自建角色(abilities)",
        ownerOrgId: world.deptOne,
      });
      const empty = await roleAs(manager.token, roleId);
      expect(empty.kind).toBe("CUSTOM");
      expect(empty.abilities).toEqual({
        canEdit: true,
        canEditMatrix: true,
        canToggleEnabled: true,
        canDelete: true,
      });

      const granted = await createRole(world.api.app, connection, {
        name: "有人持有的自建角色",
        ownerOrgId: world.deptOne,
        assignTo: [await createMember(world, [world.deptOne])],
      });
      expect(await canDeleteOf(manager.token, granted)).toBe(false);
    });

    it("自鎖:操作者自己正持有的角色 canToggleEnabled = false", async () => {
      const own = await roleAs(manager.token, manager.roleId);
      expect(own.kind).toBe("CUSTOM");
      expect(own.abilities.canToggleEnabled).toBe(false);
      // 別人的同類角色照樣切得動 — 擋的是「自己那一把」
      const other = await createRole(world.api.app, connection, {
        name: "別人的角色",
        ownerOrgId: world.tenantA,
      });
      expect(await canToggleEnabledOf(manager.token, other)).toBe(true);
    });

    it("清單的每一列也帶 kind / abilities(前端的按鈕直接讀它)", async () => {
      const result = await world.api.graphql<{ roles: { items: RoleRow[] } }>(
        ROLES,
        { input: { pageSize: 100 } },
        { accessToken: manager.token },
      );
      expect(result.errors).toBeUndefined();
      const rows = result.data?.roles.items ?? [];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(["SYSTEM", "TEMPLATE_COPY", "CUSTOM"]).toContain(row.kind);
      }
      const own = rows.find((row) => row.id === String(manager.roleId));
      expect(own?.abilities.canToggleEnabled).toBe(false);
    });
  });

  describe("ownerOrg.tenantTop:角色選單依租戶分組用", () => {
    it("擁有組織在租戶底下 → 回該租戶頂層;擁有組織本身是租戶頂層 → 回自己", async () => {
      const deep = await createRole(world.api.app, connection, {
        name: "部門一的角色(tenantTop)",
        ownerOrgId: world.deptOne,
      });
      expect(await tenantTopOf(root.token, deep)).toEqual({
        id: String(world.tenantA),
        name: "租戶甲",
      });

      const top = await createRole(world.api.app, connection, {
        name: "租戶甲的角色(tenantTop)",
        ownerOrgId: world.tenantA,
      });
      expect(await tenantTopOf(root.token, top)).toEqual({
        id: String(world.tenantA),
        name: "租戶甲",
      });
    });

    it("擁有組織是根組織(種子角色)→ tenantTop 為 null(根組織不是租戶)", async () => {
      const row = await roleAs(root.token, await seedRoleId("tenant-admin"));
      expect(row.ownerOrg?.tenantTop).toBeNull();
    });
  });

  describe("種子角色:改名 / 矩陣 / 停用一律 FORBIDDEN + reason SYSTEM_ROLE", () => {
    it("updateRole → SYSTEM_ROLE", async () => {
      const roleId = await seedRoleId("super-admin");
      const result = await world.api.graphql(
        UPDATE_ROLE,
        { input: { id: String(roleId), name: "改不動的名字" } },
        { accessToken: root.token },
      );
      expect(failureOf(result.errors ?? [])).toEqual({
        code: "FORBIDDEN",
        reason: "SYSTEM_ROLE",
      });
    });

    it("saveRoleMatrix → SYSTEM_ROLE(矩陣唯讀)", async () => {
      const roleId = await seedRoleId("tenant-admin");
      const before = await storedModuleKeys(world, roleId);
      expect(await saveMatrixAs(root.token, roleId, [], [])).toEqual({
        code: "FORBIDDEN",
        reason: "SYSTEM_ROLE",
      });
      expect(await storedModuleKeys(world, roleId)).toEqual(before);
    });

    it("setRoleEnabled → SYSTEM_ROLE(啟用與停用都不給)", async () => {
      const roleId = await seedRoleId("super-admin");
      expect(await setEnabledAs(root.token, roleId, false)).toEqual({
        code: "FORBIDDEN",
        reason: "SYSTEM_ROLE",
      });
      expect(await setEnabledAs(root.token, roleId, true)).toEqual({
        code: "FORBIDDEN",
        reason: "SYSTEM_ROLE",
      });
    });
  });

  describe("預設角色的停用:只有 root(TEMPLATE_COPY_ROOT_ONLY)", () => {
    it("租戶的管理員停用 → FORBIDDEN + TEMPLATE_COPY_ROOT_ONLY,且沒有真的停用", async () => {
      const roleId = await newTemplateCopy("預設角色(停用)");
      expect(await setEnabledAs(manager.token, roleId, false)).toEqual({
        code: "FORBIDDEN",
        reason: "TEMPLATE_COPY_ROOT_ONLY",
      });
      expect(await enabledOf(manager.token, roleId)).toBe(true);
    });

    it("根組織的操作者停用得了,再啟用也可以", async () => {
      const roleId = await newTemplateCopy("預設角色(root 停用)");
      expect(await setEnabledAs(root.token, roleId, false)).toEqual({
        code: undefined,
        reason: undefined,
      });
      expect(await enabledOf(root.token, roleId)).toBe(false);

      expect(await setEnabledAs(root.token, roleId, true)).toEqual({
        code: undefined,
        reason: undefined,
      });
      expect(await enabledOf(root.token, roleId)).toBe(true);
    });
  });

  describe("自鎖保護:不可停用自己正持有的角色(SELF_LOCK)", () => {
    it("租戶的管理員停用自己那一把 → FORBIDDEN + SELF_LOCK", async () => {
      expect(await setEnabledAs(manager.token, manager.roleId, false)).toEqual({
        code: "FORBIDDEN",
        reason: "SELF_LOCK",
      });
      expect(await enabledOf(manager.token, manager.roleId)).toBe(true);
    });

    it("根組織的操作者也一樣被擋(自鎖與站在哪裡無關)", async () => {
      expect(await setEnabledAs(root.token, root.roleId, false)).toEqual({
        code: "FORBIDDEN",
        reason: "SELF_LOCK",
      });
    });

    it("自己沒持有的角色照樣停用得了", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "沒人持有的角色(可停用)",
        ownerOrgId: world.deptTwo,
      });
      expect(await setEnabledAs(manager.token, roleId, false)).toEqual({
        code: undefined,
        reason: undefined,
      });
    });

    it("已停用、且自己持有的角色仍可**啟用**(自鎖只擋停用)", async () => {
      const holderId = await createMember(world, [world.tenantA], "self-lock");
      const roleId = await createRole(world.api.app, connection, {
        name: "停用中、操作者持有的角色",
        ownerOrgId: world.tenantA,
        assignTo: [manager.userId, holderId],
      });
      // 先由沒持有它的 root 停用
      expect(await setEnabledAs(root.token, roleId, false)).toEqual({
        code: undefined,
        reason: undefined,
      });
      expect(await setEnabledAs(manager.token, roleId, true)).toEqual({
        code: undefined,
        reason: undefined,
      });
      expect(await enabledOf(manager.token, roleId)).toBe(true);
    });
  });

  describe("shrinkOnly = 非 root 且是預設角色(root 不受限)", () => {
    it("root 看到的 shrinkOnly = false,且加得了新模組", async () => {
      const roleId = await newTemplateCopy("預設角色(root 放寬)");
      expect(await shrinkOnlyAs(root.token, roleId)).toBe(false);

      expect(
        await saveMatrixAs(
          root.token,
          roleId,
          ["demo", "demo.sample-two", "system", "system.role-manager"],
          ["demo.sample-two.*", "system.role-manager.view"],
        ),
      ).toEqual({ code: undefined, reason: undefined });
      expect(await storedModuleKeys(world, roleId)).toContain(
        "system.role-manager",
      );
    });

    it("非 root 看到的 shrinkOnly = true:加模組 → ROLE_OUT_OF_REACH,收窄可以", async () => {
      const roleId = await newTemplateCopy("預設角色(租戶收窄)");
      expect(await shrinkOnlyAs(manager.token, roleId)).toBe(true);

      const widened = await saveMatrixAs(
        manager.token,
        roleId,
        ["demo", "demo.sample-two", "system", "system.role-manager"],
        ["demo.sample-two.*", "system.role-manager.view"],
      );
      expect(widened.code).toBe("ROLE_OUT_OF_REACH");

      const narrowed = await saveMatrixAs(
        manager.token,
        roleId,
        ["demo", "demo.sample-two"],
        [],
      );
      expect(narrowed.code).toBeUndefined();
    });
  });

  /**
   * 預設角色的天花板:上限 = 內建「租戶管理員」模板角色目前的授予
   * (seed = 所有非根組織專屬模組各一筆 `*`)。root 在此範圍內放寬與收窄,**連 root 也開不出模板沒有的**。
   */
  describe("預設角色的天花板 = 內建租戶管理員模板", () => {
    it("root 勾模板外的「模組與權限」→ ROLE_OUT_OF_REACH + TEMPLATE_CEILING,且沒有寫進去", async () => {
      const roleId = await newTemplateCopy("預設角色(天花板外)");

      expect(
        await saveMatrixAs(
          root.token,
          roleId,
          ["demo", "demo.sample-two", "system", "system.module-manager"],
          ["demo.sample-two.*", "system.module-manager.view"],
        ),
      ).toEqual({
        code: "ROLE_OUT_OF_REACH",
        reason: "TEMPLATE_CEILING",
      });
      expect(await storedModuleKeys(world, roleId)).not.toContain(
        "system.module-manager",
      );
    });

    it("root 勾模板內的「欄位管理」→ 成功寫入(天花板內照樣放寬得了)", async () => {
      const roleId = await newTemplateCopy("預設角色(天花板內)");

      expect(
        await saveMatrixAs(
          root.token,
          roleId,
          ["demo", "demo.sample-two", "system", "system.field-manager"],
          ["demo.sample-two.*", "system.field-manager.view"],
        ),
      ).toEqual({ code: undefined, reason: undefined });
      expect(await storedModuleKeys(world, roleId)).toContain(
        "system.field-manager",
      );
    });

    it("ceiling 回模板的授予:含示範模組2、不含根組織專屬模組", async () => {
      const roleId = await newTemplateCopy("預設角色(ceiling 欄位)");
      const { ceiling } = await matrixAs(root.token, roleId);

      expect(ceiling).not.toBeNull();
      expect(ceiling?.moduleKeys).toContain("demo.sample-two");
      expect(ceiling?.moduleKeys).toContain("system.field-manager");
      for (const key of ROOT_ONLY_MODULE_KEYS) {
        expect(ceiling?.moduleKeys).not.toContain(key);
      }
      // 已展開 `*`:同層各筆與 `*` 本身都在(前端直接拿來鎖列)
      expect(ceiling?.permissionKeys).toContain("demo.sample-two.*");
      expect(ceiling?.permissionKeys).toContain("demo.sample-two.view");
      expect(ceiling?.permissionKeys).not.toContain("system.module-manager.*");
    });

    it("自建角色沒有天花板:ceiling 為 null,且擋它的仍是 subset-only(無 reason)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("自建角色(無天花板)"),
        ownerOrgId: world.deptOne,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.*"],
      });
      const custom = await matrixAs(root.token, roleId);
      expect(custom.ceiling).toBeNull();

      // root 自己有「模組與權限」→ 自建角色開得出去(天花板只管預設角色)
      expect(
        await saveMatrixAs(
          root.token,
          roleId,
          ["system", "system.module-manager"],
          ["system.module-manager.view"],
        ),
      ).toEqual({ code: undefined, reason: undefined });
    });
  });
});
