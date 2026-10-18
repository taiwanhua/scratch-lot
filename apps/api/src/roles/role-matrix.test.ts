import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  createRole,
  setModuleEnabled,
  setPermissionEnabled,
} from "../permission/test-support/fixtures";
import {
  type Manager,
  type RolesWorld,
  SAMPLE_TWO_INDIVIDUAL_KEYS,
  createManager,
  expectSameMembers,
  latestAudit,
  startRolesWorld,
  storedModuleKeys,
  storedPermissionKeys,
} from "./roles-test-support";

const ROLE_MATRIX = /* GraphQL */ `
  query RoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      role {
        id
        name
      }
      shrinkOnly
      granted {
        moduleKeys
        permissionKeys
      }
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
      action
    }
  }
`;

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation SaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      role {
        id
      }
      shrinkOnly
      granted {
        moduleKeys
        permissionKeys
      }
    }
  }
`;

interface MatrixModuleNode {
  key: string;
  permissions: { key: string; action?: string }[];
  children?: MatrixModuleNode[];
}

interface MatrixPayload {
  role: { id: string; name: string };
  shrinkOnly: boolean;
  granted: { moduleKeys: string[]; permissionKeys: string[] };
  modules: MatrixModuleNode[];
}

interface MatrixData {
  roleMatrix: MatrixPayload;
}

interface SaveMatrixData {
  saveRoleMatrix: MatrixPayload;
}

/** 攤平樹,方便斷言「樹上有沒有這個 key」。 */
function flatten(nodes: MatrixModuleNode[]): MatrixModuleNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/**
 * 權限矩陣:`*` 正規化三案、勾下層補上層、subset-only 防越權、
 * 租戶副本只能縮不能擴、停用的模組 / 權限不進矩陣(TEST-07,對真 MongoDB)。
 * 規則正本:ADR-0004、docs/modules/role-manager.md「權限矩陣規則」。
 */
describe("角色管理:權限矩陣(GraphQL 端點 + 真 MongoDB)", () => {
  let world: RolesWorld;
  let connection: Connection;
  let manager: Manager;

  beforeAll(async () => {
    world = await startRolesWorld("cookhome-test-role-matrix");
    connection = world.connection;
    // 操作者 = 租戶管理員型的人:全部非根組織專屬模組 + 各模組的 `*`(ADR-0009 模板的形狀)
    manager = await createManager(world, {
      orgIds: [world.tenantA],
      ownerOrgId: world.tenantA,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  async function newRole(name: string): Promise<Types.ObjectId> {
    return createRole(world.api.app, connection, {
      name,
      ownerOrgId: world.deptOne,
    });
  }

  async function readMatrix(
    roleId: Types.ObjectId,
    token = manager.token,
  ): Promise<MatrixPayload> {
    const result = await world.api.graphql<MatrixData>(
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

  async function save(
    roleId: Types.ObjectId,
    moduleKeys: string[],
    permissionKeys: string[],
    token = manager.token,
  ): Promise<{ data: SaveMatrixData | null; code: string | undefined }> {
    const result = await world.api.graphql<SaveMatrixData>(
      SAVE_ROLE_MATRIX,
      { input: { roleId: String(roleId), moduleKeys, permissionKeys } },
      { accessToken: token },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  describe("矩陣的樹(只回 enabled 且操作者授得出去的)", () => {
    it("回巢狀的模組樹,每個模組帶自己這一層的權限(含 `*` 的「全部」列)", async () => {
      const roleId = await newRole("看樹用的角色");
      const matrix = await readMatrix(roleId);
      const flat = flatten(matrix.modules);
      const keys = flat.map((node) => node.key);

      expect(keys).toContain("system.role-manager");
      expect(keys).toContain("demo.sample-two");
      // 根組織專屬模組不在租戶管理員的權限集內 ⇒ 矩陣上根本看不到(ADR-0004 防越權)
      expect(keys).not.toContain("system.module-manager");
      expect(keys).not.toContain("system.data-scope");

      const sampleTwo = flat.find((node) => node.key === "demo.sample-two");
      expectSameMembers(
        (sampleTwo?.permissions ?? []).map((permission) => permission.key),
        ["demo.sample-two.*", ...SAMPLE_TWO_INDIVIDUAL_KEYS],
      );
      // 「全部」列排在同層第一個(矩陣的固定第一列)
      expect(sampleTwo?.permissions[0]?.action).toBe("*");
    });

    it("停用的模組連子樹、停用的權限都不進矩陣(ADR-0011 的剔除規則)", async () => {
      const roleId = await newRole("停用剔除用的角色");
      await setModuleEnabled(connection, "demo.sub", false);
      await setPermissionEnabled(connection, "demo.sample-two.delete", false);
      try {
        const matrix = await readMatrix(roleId);
        const flat = flatten(matrix.modules);
        const keys = flat.map((node) => node.key);
        expect(keys).not.toContain("demo.sub");
        expect(keys).not.toContain("demo.sub.sample-one");
        expect(keys).toContain("demo.sample-two");

        const sampleTwo = flat.find((node) => node.key === "demo.sample-two");
        expect(
          (sampleTwo?.permissions ?? []).map((permission) => permission.key),
        ).not.toContain("demo.sample-two.delete");
      } finally {
        await setModuleEnabled(connection, "demo.sub", true);
        await setPermissionEnabled(connection, "demo.sample-two.delete", true);
      }
    });
  });

  describe("`*` 正規化三案(ADR-0004「儲存」)", () => {
    it("勾同層全部 → 只存一筆 `*`", async () => {
      const roleId = await newRole("同層全勾");
      const { code } = await save(
        roleId,
        ["demo", "demo.sample-two"],
        SAMPLE_TWO_INDIVIDUAL_KEYS,
      );
      expect(code).toBeUndefined();
      const stored = await storedPermissionKeys(world, roleId);
      // 群組模組 `demo` 自己這一層沒有個別權限,沒勾就不存 —— `*` 是同層語意(ADR-0004)
      expect(stored).toEqual(["demo.sample-two.*"]);
    });

    it("直接送 `*` → 存 `*`(含未來新增的語意)", async () => {
      const roleId = await newRole("直接送星號");
      await save(roleId, ["demo", "demo.sample-two"], ["demo.sample-two.*"]);
      const stored = await storedPermissionKeys(world, roleId);
      expect(stored).toContain("demo.sample-two.*");
    });

    it("已存 `*` 後取消其中一筆 → 刪 `*`、存其餘個別筆", async () => {
      const roleId = await newRole("取消一筆");
      await save(roleId, ["demo", "demo.sample-two"], ["demo.sample-two.*"]);
      expect(await storedPermissionKeys(world, roleId)).toContain(
        "demo.sample-two.*",
      );

      const remaining = SAMPLE_TWO_INDIVIDUAL_KEYS.filter(
        (key) => key !== "demo.sample-two.delete",
      );
      const { code } = await save(
        roleId,
        ["demo", "demo.sample-two"],
        remaining,
      );
      expect(code).toBeUndefined();
      const stored = await storedPermissionKeys(world, roleId);
      expect(stored).not.toContain("demo.sample-two.*");
      expectSameMembers(stored, remaining);
    });

    it("`*` 是同層語意:父模組的 `*` 不涵蓋子模組", async () => {
      const roleId = await newRole("同層語意");
      await save(
        roleId,
        [
          "demo",
          "demo.sub",
          "demo.sub.sample-one",
          "demo.sub.sample-one.edit-page",
        ],
        ["demo.sub.sample-one.*"],
      );
      const stored = await storedPermissionKeys(world, roleId);
      expect(stored).toContain("demo.sub.sample-one.*");
      // 編輯頁自己的權限不因父模組的 `*` 而被授出
      expect(stored).not.toContain("demo.sub.sample-one.edit-page.*");
      expect(stored).not.toContain(
        "demo.sub.sample-one.edit-page.show-history",
      );
    });
  });

  describe("勾下層必補上層(ADR-0004 / role-manager.md)", () => {
    it("只送最底層的模組,上層模組自動補齊", async () => {
      const roleId = await newRole("補上層");
      const { code } = await save(roleId, ["demo.sub.sample-one"], []);
      expect(code).toBeUndefined();
      expectSameMembers(await storedModuleKeys(world, roleId), [
        "demo",
        "demo.sub",
        "demo.sub.sample-one",
      ]);
    });

    it("只送權限、完全不送模組,擁有模組與其祖先一併補上", async () => {
      const roleId = await newRole("由權限補模組");
      const { code } = await save(roleId, [], ["demo.sample-two.view"]);
      expect(code).toBeUndefined();
      expectSameMembers(await storedModuleKeys(world, roleId), [
        "demo",
        "demo.sample-two",
      ]);
      expect(await storedPermissionKeys(world, roleId)).toEqual([
        "demo.sample-two.view",
      ]);
    });

    it("硬把上層模組拿掉也會被補回來(存檔面的不變量)", async () => {
      const roleId = await newRole("硬拿掉上層");
      await save(roleId, ["demo.sample-two"], ["demo.sample-two.view"]);
      expect(await storedModuleKeys(world, roleId)).toContain("demo");
    });
  });

  describe("subset-only 防越權(ADR-0004)", () => {
    it("送操作者沒有的模組 → ROLE_OUT_OF_REACH", async () => {
      const roleId = await newRole("越權模組");
      const { code } = await save(roleId, ["system.module-manager"], []);
      expect(code).toBe("ROLE_OUT_OF_REACH");
      expect(await storedModuleKeys(world, roleId)).toEqual([]);
    });

    it("送操作者沒有的權限 → ROLE_OUT_OF_REACH", async () => {
      const roleId = await newRole("越權權限");
      const { code } = await save(
        roleId,
        ["system", "system.data-scope"],
        ["system.data-scope.edit"],
      );
      expect(code).toBe("ROLE_OUT_OF_REACH");
    });

    it("持有個別權限但不持有 `*` 時,授不出 `*`(含未來新增)", async () => {
      // 只持有示範模組2 的 view / edit 兩筆個別權限,沒有 `demo.sample-two.*`
      const narrow = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: [
          "system",
          "system.role-manager",
          "demo",
          "demo.sample-two",
        ],
        permissionKeys: [
          "system.role-manager.view",
          "system.role-manager.edit-matrix",
          "demo.sample-two.view",
          "demo.sample-two.edit",
        ],
      });
      const roleId = await newRole("窄操作者的角色");

      // 他的矩陣上,示範模組2 只看得到那兩列,沒有「全部」列
      const matrix = await readMatrix(roleId, narrow.token);
      const sampleTwo = flatten(matrix.modules).find(
        (node) => node.key === "demo.sample-two",
      );
      expectSameMembers(
        (sampleTwo?.permissions ?? []).map((permission) => permission.key),
        ["demo.sample-two.view", "demo.sample-two.edit"],
      );

      // 硬送 `*` → 被擋
      const blocked = await save(
        roleId,
        ["demo", "demo.sample-two"],
        ["demo.sample-two.*"],
        narrow.token,
      );
      expect(blocked.code).toBe("ROLE_OUT_OF_REACH");

      // 勾滿他看得到的兩列 → 存兩筆個別權限,**不**收斂成 `*`(收斂了就等於擴權)
      const allowed = await save(
        roleId,
        ["demo", "demo.sample-two"],
        ["demo.sample-two.view", "demo.sample-two.edit"],
        narrow.token,
      );
      expect(allowed.code).toBeUndefined();
      expectSameMembers(await storedPermissionKeys(world, roleId), [
        "demo.sample-two.view",
        "demo.sample-two.edit",
      ]);
    });

    it("操作者搆不到的既有綁定不被整份覆蓋清掉", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "含越權綁定的角色",
        ownerOrgId: world.deptOne,
        moduleKeys: ["system", "system.data-scope", "demo", "demo.sample-two"],
        permissionKeys: ["system.data-scope.view", "demo.sample-two.view"],
      });
      const { code } = await save(roleId, [], []);
      expect(code).toBeUndefined();
      // 租戶管理員型操作者看不到 system.data-scope ⇒ 那兩筆留著;看得到的 demo 被清掉
      const modules = await storedModuleKeys(world, roleId);
      expect(modules).toContain("system.data-scope");
      expect(modules).not.toContain("demo.sample-two");
      expect(await storedPermissionKeys(world, roleId)).toEqual([
        "system.data-scope.view",
      ]);
    });
  });

  /** 開通租戶複製出來的「租戶管理員」副本:以 `settings.templateKey` 標記(ADR-0009)。 */
  async function newCopy(): Promise<Types.ObjectId> {
    const roleId = await createRole(world.api.app, connection, {
      name: "租戶管理員(副本)",
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

  describe("租戶管理員副本只能縮不能擴(ADR-0009)", () => {
    it("矩陣回 shrinkOnly = true", async () => {
      const roleId = await newCopy();
      const matrix = await readMatrix(roleId);
      expect(matrix.shrinkOnly).toBe(true);
    });

    it("縮小(拿掉一筆權限)可以", async () => {
      const roleId = await newCopy();
      const remaining = SAMPLE_TWO_INDIVIDUAL_KEYS.filter(
        (key) => key !== "demo.sample-two.delete",
      );
      const { code } = await save(
        roleId,
        ["demo", "demo.sample-two"],
        remaining,
      );
      expect(code).toBeUndefined();
      expectSameMembers(await storedPermissionKeys(world, roleId), remaining);
    });

    it("擴張(加一個原本沒有的模組)→ ROLE_OUT_OF_REACH", async () => {
      const roleId = await newCopy();
      const { code } = await save(
        roleId,
        ["demo", "demo.sample-two", "system", "system.role-manager"],
        ["demo.sample-two.*", "system.role-manager.view"],
      );
      expect(code).toBe("ROLE_OUT_OF_REACH");
      expect(await storedModuleKeys(world, roleId)).not.toContain(
        "system.role-manager",
      );
    });

    it("一般角色不受此限,加得了新模組", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "一般角色",
        ownerOrgId: world.deptOne,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.*"],
      });
      const { code } = await save(
        roleId,
        ["demo", "demo.sample-two", "system", "system.role-manager"],
        ["demo.sample-two.*", "system.role-manager.view"],
      );
      expect(code).toBeUndefined();
      expect(await storedModuleKeys(world, roleId)).toContain(
        "system.role-manager",
      );
    });
  });

  describe("回傳與稽核", () => {
    it("granted 展開 `*` 給 UI 顯示,儲存後立刻反映新狀態", async () => {
      const roleId = await newRole("回傳形狀");
      const saved = await save(
        roleId,
        ["demo", "demo.sample-two"],
        ["demo.sample-two.*"],
      );
      const granted = saved.data?.saveRoleMatrix.granted;
      expect(granted?.moduleKeys).toEqual(
        expect.arrayContaining(["demo", "demo.sample-two"]),
      );
      // 「全部」列本身與展開後的同層各筆都在(矩陣兩種列都要顯示勾選)
      expect(granted?.permissionKeys).toEqual(
        expect.arrayContaining([
          "demo.sample-two.*",
          ...SAMPLE_TWO_INDIVIDUAL_KEYS,
        ]),
      );
      expect(saved.data?.saveRoleMatrix.shrinkOnly).toBe(false);
    });

    it("寫 role.edit-matrix 稽核,before / after 為綁定差異;沒變更不寫", async () => {
      const roleId = await newRole("稽核用的角色");
      await save(roleId, ["demo", "demo.sample-two"], ["demo.sample-two.view"]);
      const audit = await latestAudit(world, "role.edit-matrix", roleId);
      expect(audit?.targetType).toBe("role");
      expect(audit?.before?.permissionKeys).toEqual([]);
      expect(audit?.after?.permissionKeys).toEqual(["demo.sample-two.view"]);

      const countBefore = await connection
        .collection("audit_logs")
        .countDocuments({ action: "role.edit-matrix", targetId: roleId });
      await save(roleId, ["demo", "demo.sample-two"], ["demo.sample-two.view"]);
      const countAfter = await connection
        .collection("audit_logs")
        .countDocuments({ action: "role.edit-matrix", targetId: roleId });
      expect(countAfter).toBe(countBefore);
    });

    it("缺 edit-matrix 權限 → FORBIDDEN", async () => {
      const viewer = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: ["system.role-manager.view"],
      });
      const roleId = await newRole("守門用的角色");
      const { code } = await save(roleId, [], [], viewer.token);
      expect(code).toBe("FORBIDDEN");
    });
  });
});
