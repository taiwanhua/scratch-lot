import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  createRole,
  findModuleIdByKey,
  findPermissionIdByKey,
} from "../permission/test-support/fixtures";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

/** GraphQL 沒有遞迴 fragment,深度只能展開;模組樹最深四層(demo > sub > sample-one > view-page)。 */
const MODULE_TREE = /* GraphQL */ `
  query ModuleTree {
    moduleTree {
      ...Node
      children {
        ...Node
        children {
          ...Node
          children {
            ...Node
            children {
              ...Node
            }
          }
        }
      }
    }
  }

  fragment Node on ModuleAdminNode {
    id
    key
    name
    parentId
    sidebarType
    route
    order
    description
    icon
    engine
    enabled
    permissions {
      id
      key
      name
      description
      enabled
    }
  }
`;

const SET_MODULE_ENABLED = /* GraphQL */ `
  mutation SetModuleEnabled($input: SetModuleEnabledInput!) {
    setModuleEnabled(input: $input) {
      module {
        id
        key
        enabled
        children {
          key
          enabled
          children {
            key
            enabled
          }
        }
      }
    }
  }
`;

const SET_MODULE_ICON = /* GraphQL */ `
  mutation SetModuleIcon($input: SetModuleIconInput!) {
    setModuleIcon(input: $input) {
      module {
        id
        key
        icon
        enabled
        children {
          key
          icon
        }
      }
    }
  }
`;

const SET_PERMISSION_ENABLED = /* GraphQL */ `
  mutation SetPermissionEnabled($input: SetPermissionEnabledInput!) {
    setPermissionEnabled(input: $input) {
      permission {
        id
        key
        name
        enabled
      }
    }
  }
`;

const ME_MODULES = /* GraphQL */ `
  query MeModules {
    me {
      modules {
        key
        icon
        permissions
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface PermissionAdmin {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

interface ModuleAdminNode {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  sidebarType: string;
  route: string | null;
  order: number;
  description: string | null;
  icon: string | null;
  engine: string;
  enabled: boolean;
  permissions: PermissionAdmin[];
  children?: ModuleAdminNode[];
}

interface ModuleTreeData {
  moduleTree: ModuleAdminNode[];
}

interface SetModuleEnabledData {
  setModuleEnabled: { module: ModuleAdminNode };
}

interface SetModuleIconData {
  setModuleIcon: { module: ModuleAdminNode };
}

interface SetPermissionEnabledData {
  setPermissionEnabled: { permission: PermissionAdmin };
}

interface MeModulesData {
  me: {
    modules: { key: string; icon: string | null; permissions: string[] }[];
  };
}

const PASSWORD = ["test", "pass", "word"].join("-");
const MODULE_MANAGER = "system.module-manager";
const SAMPLE_ONE = "demo.sub.sample-one";
const SAMPLE_TWO = "demo.sample-two";

/** 攤平整棵回傳的樹(只在測試裡用:斷言「某個 key 的節點長什麼樣」)。 */
function flatten(nodes: ModuleAdminNode[]): ModuleAdminNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function byKey(nodes: ModuleAdminNode[], key: string): ModuleAdminNode {
  const found = flatten(nodes).find((node) => node.key === key);
  if (!found) {
    throw new Error(`moduleTree 沒有 ${key}`);
  }
  return found;
}

describe("模組與權限(moduleTree / setModuleEnabled / setModuleIcon / setPermissionEnabled;根組織專屬,對真 Nest app + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenantId: Types.ObjectId;
  let rootToken: string;
  let userSequence = 0;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-module-manager");
    tenantId = await createOrg(api.connection, { name: "租戶甲" });
    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  async function login(account: string, password: string): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password },
    });
    expect(result.errors).toBeUndefined();
    const accessToken = result.data?.login.accessToken;
    if (!accessToken) {
      throw new Error(`${account} 登入沒有回 accessToken`);
    }
    return accessToken;
  }

  /** 建一個租戶甲的使用者 + 角色(綁指定模組與權限)並登入。 */
  async function tenantUser(options: {
    moduleKeys: string[];
    permissionKeys: string[];
  }): Promise<string> {
    userSequence += 1;
    const account = `module-manager-user-${String(userSequence)}`;
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds: [tenantId],
    });
    await createRole(api.app, api.connection, {
      name: `模組與權限測試角色 ${String(userSequence)}`,
      ownerOrgId: tenantId,
      moduleKeys: options.moduleKeys,
      permissionKeys: options.permissionKeys,
      assignTo: [userId],
    });
    return login(account, PASSWORD);
  }

  async function fetchTree(
    accessToken = rootToken,
  ): Promise<ModuleAdminNode[]> {
    const result = await api.graphql<ModuleTreeData>(
      MODULE_TREE,
      {},
      { accessToken },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.moduleTree ?? [];
  }

  async function meModules(
    accessToken: string,
  ): Promise<MeModulesData["me"]["modules"]> {
    const result = await api.graphql<MeModulesData>(
      ME_MODULES,
      {},
      { accessToken },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.me.modules ?? [];
  }

  async function meModuleKeys(accessToken: string): Promise<string[]> {
    const modules = await meModules(accessToken);
    return modules.map((one) => one.key);
  }

  /** 直接讀資料庫驗最終狀態(TEST-07:驗回應 + 資料庫最終狀態)。 */
  async function storedEnabled(key: string): Promise<boolean> {
    const module = await api.connection
      .collection("modules")
      .findOne<{ enabled: boolean }>({ key });
    if (!module) {
      throw new Error(`測試資料庫沒有模組 ${key}`);
    }
    return module.enabled;
  }

  /** 圖示的資料庫最終狀態;`undefined` 代表欄位不存在(與「值為 null」不同,seed 補值靠這個差別)。 */
  async function storedIcon(key: string): Promise<string | null | undefined> {
    const module = await api.connection
      .collection("modules")
      .findOne<{ icon?: string | null }>({ key });
    if (!module) {
      throw new Error(`測試資料庫沒有模組 ${key}`);
    }
    return module.icon;
  }

  async function auditActions(action: string): Promise<
    {
      targetType?: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }[]
  > {
    return api.connection
      .collection("audit_logs")
      .find<{
        targetType?: string;
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
      }>({ action })
      .toArray();
  }

  async function setModuleEnabled(
    key: string,
    enabled: boolean,
    accessToken = rootToken,
  ) {
    const id = String(await findModuleIdByKey(api.connection, key));
    return api.graphql<SetModuleEnabledData>(
      SET_MODULE_ENABLED,
      { input: { id, enabled } },
      { accessToken },
    );
  }

  async function setModuleIcon(
    key: string,
    icon: string | null,
    accessToken = rootToken,
  ) {
    const id = String(await findModuleIdByKey(api.connection, key));
    return api.graphql<SetModuleIconData>(
      SET_MODULE_ICON,
      { input: { id, icon } },
      { accessToken },
    );
  }

  async function setPermissionEnabled(
    key: string,
    enabled: boolean,
    accessToken = rootToken,
  ) {
    const id = String(await findPermissionIdByKey(api.connection, key));
    return api.graphql<SetPermissionEnabledData>(
      SET_PERMISSION_ENABLED,
      { input: { id, enabled } },
      { accessToken },
    );
  }

  describe("moduleTree:治理面的全樹(與 me.modules 的「我能用什麼」不同)", () => {
    it("回全樹:含側欄看不到的 hidden 節點、隱藏的 api 權限樹與根組織專屬模組;子節點掛在 children 上", async () => {
      const tree = await fetchTree();

      // 頂層依 order:總覽 0、示範 2 / 3、輸出報表 50、申請中心 90、系統管理 95、api 99(專案模組不在這個測試的種子裡)
      expect(tree.map((node) => node.key)).toEqual([
        "overview",
        "demo",
        "demo-form",
        "reports",
        "apply-center",
        "system",
        "api",
      ]);
      const system = byKey(tree, "system");
      expect(system.children?.map((child) => child.key)).toEqual([
        "system.org-manager",
        "system.user-manager",
        "system.role-manager",
        MODULE_MANAGER,
        "system.field-manager",
        "system.data-scope",
        "system.forms",
        "system.workflows",
        "system.notification-settings",
        "system.printers",
      ]);
      // 隱藏的純權限容器也在樹上(租戶作業掛在組織管理底下)
      expect(byKey(tree, "system.org-manager.tenant-ops")).toMatchObject({
        sidebarType: "HIDDEN",
        parentId: byKey(tree, "system.org-manager").id,
      });
      // 頁面組裝方式:seed 宣告 engine: "form" 的示範表單是 FORM,其餘 FIXED
      expect(byKey(tree, "demo-form").engine).toBe("FORM");
      expect(byKey(tree, "demo").engine).toBe("FIXED");
      // 隱藏的 api 樹是頂層節點(不是頁面,側欄看不到)
      expect(byKey(tree, "api")).toMatchObject({
        sidebarType: "HIDDEN",
        parentId: null,
        enabled: true,
      });
      // 四層深的隱藏頁也在
      expect(byKey(tree, `${SAMPLE_ONE}.view-page`).parentId).toBe(
        byKey(tree, SAMPLE_ONE).id,
      );
    });

    it("route 只回自己那一段;權限容器(hidden 且無 route)回 null", async () => {
      const tree = await fetchTree();

      // 有畫面的節點:route 是自己那一段,不是完整路徑
      expect(byKey(tree, SAMPLE_ONE).route).toBe("sample-one");
      expect(byKey(tree, "demo.sub").route).toBe("sub");
      // 隱藏頁有 route(它對應一個畫面)
      expect(byKey(tree, `${SAMPLE_ONE}.view-page`).route).toBe("view-page");
      // 權限容器沒有 route:純 api 權限樹、租戶作業
      expect(byKey(tree, "api").route).toBeNull();
      expect(byKey(tree, "system.org-manager.tenant-ops").route).toBeNull();
    });

    it("每個模組附自己這一層的全部權限,`*` 排最前;群組模組只有 `*` 一筆", async () => {
      const tree = await fetchTree();

      const moduleManager = byKey(tree, MODULE_MANAGER);
      expect(moduleManager.permissions.map((one) => one.key)).toEqual([
        `${MODULE_MANAGER}.*`,
        `${MODULE_MANAGER}.delete-retired-permission`,
        `${MODULE_MANAGER}.set-icon`,
        `${MODULE_MANAGER}.toggle-enabled`,
        `${MODULE_MANAGER}.view`,
      ]);
      expect(moduleManager.permissions[3]).toMatchObject({
        key: `${MODULE_MANAGER}.toggle-enabled`,
        name: "停用 / 啟用",
        enabled: true,
      });
      expect(byKey(tree, "system").permissions.map((one) => one.key)).toEqual([
        "system.*",
      ]);
    });
  });

  describe("setModuleEnabled:停用連動整棵子樹,啟用只啟用自己", () => {
    it("停用 demo.sub:子樹的 modules.enabled 全變 false,持有者的 me.modules 不再出現;兄弟支(demo.sample-two)不受影響", async () => {
      const holder = await tenantUser({
        moduleKeys: [
          "demo",
          "demo.sub",
          SAMPLE_ONE,
          `${SAMPLE_ONE}.view-page`,
          SAMPLE_TWO,
        ],
        permissionKeys: [`${SAMPLE_ONE}.view`, `${SAMPLE_TWO}.view`],
      });
      expect(await meModuleKeys(holder)).toContain(SAMPLE_ONE);

      const result = await setModuleEnabled("demo.sub", false);
      expect(result.errors).toBeUndefined();

      // 回傳的是這一枝的最新狀態(自己 + 整棵子樹)
      const branch = result.data?.setModuleEnabled.module;
      expect(branch).toMatchObject({ key: "demo.sub", enabled: false });
      expect(
        flatten(branch === undefined ? [] : [branch]).every(
          (node) => !node.enabled,
        ),
      ).toBe(true);

      // 資料庫最終狀態:整棵子樹都落庫成 false
      expect(await storedEnabled("demo.sub")).toBe(false);
      expect(await storedEnabled(SAMPLE_ONE)).toBe(false);
      expect(await storedEnabled(`${SAMPLE_ONE}.view-page`)).toBe(false);
      // 兄弟支與父群組不動
      expect(await storedEnabled("demo")).toBe(true);
      expect(await storedEnabled(SAMPLE_TWO)).toBe(true);

      const after = await meModuleKeys(holder);
      expect(after).not.toContain("demo.sub");
      expect(after).not.toContain(SAMPLE_ONE);
      expect(after).toContain(SAMPLE_TWO);
    });

    it("啟用 demo.sub 只啟用自己:子模組留在停用,持有者的 me.modules 只回來 demo.sub", async () => {
      const holder = await tenantUser({
        moduleKeys: ["demo", "demo.sub", SAMPLE_ONE],
        permissionKeys: [`${SAMPLE_ONE}.view`],
      });

      const result = await setModuleEnabled("demo.sub", true);
      expect(result.errors).toBeUndefined();
      expect(result.data?.setModuleEnabled.module).toMatchObject({
        key: "demo.sub",
        enabled: true,
      });

      expect(await storedEnabled("demo.sub")).toBe(true);
      expect(await storedEnabled(SAMPLE_ONE)).toBe(false);

      const keys = await meModuleKeys(holder);
      expect(keys).toContain("demo.sub");
      expect(keys).not.toContain(SAMPLE_ONE);

      // 還原成 seed 的樣子,不影響後面的案例
      await setModuleEnabled(SAMPLE_ONE, true);
      await setModuleEnabled(`${SAMPLE_ONE}.view-page`, true);
      await setModuleEnabled(`${SAMPLE_ONE}.create-page`, true);
      await setModuleEnabled(`${SAMPLE_ONE}.edit-page`, true);
      expect(await storedEnabled(SAMPLE_ONE)).toBe(true);
    });

    it("寫一筆 module.toggle-enabled 審計,after 列出這次被連動關掉的子孫 key", async () => {
      await setModuleEnabled(`${SAMPLE_ONE}.view-page`, false);
      await setModuleEnabled(`${SAMPLE_ONE}.view-page`, true);

      const records = await auditActions("module.toggle-enabled");
      expect(records.length).toBeGreaterThan(0);
      expect(records[0]).toMatchObject({ targetType: "module" });
      const cascaded = records.find(
        (record) => record.before?.key === "demo.sub",
      );
      expect(cascaded?.after).toMatchObject({
        key: "demo.sub",
        enabled: false,
      });
      expect(cascaded?.after?.cascadedModuleKeys).toEqual([
        "demo.sub.form",
        "demo.sub.form.create-page",
        "demo.sub.form.edit-page",
        "demo.sub.form.view-page",
        SAMPLE_ONE,
        `${SAMPLE_ONE}.create-page`,
        `${SAMPLE_ONE}.edit-page`,
        `${SAMPLE_ONE}.view-page`,
      ]);
    });
  });

  describe("setModuleIcon:側欄圖示(根組織專屬)", () => {
    it("seed 給的初值進得了樹與 me.modules;隱藏頁沒給 → null(用預設圖示)", async () => {
      const tree = await fetchTree();

      // 初值正本:apps/db-migrator/seeds/base/modules/*.ts(對照表見 docs/modules/module-manager.md)
      expect(byKey(tree, "overview").icon).toBe("dashboard");
      expect(byKey(tree, "system").icon).toBe("settings");
      expect(byKey(tree, MODULE_MANAGER).icon).toBe("apps");
      expect(byKey(tree, "api").icon).toBe("tune");
      expect(byKey(tree, `${SAMPLE_TWO}.view-page`).icon).toBeNull();
    });

    it("改成白名單內的 key:回傳、資料庫與持有者的 me.modules 都換成新值;再送 null 清回預設", async () => {
      const holder = await tenantUser({
        moduleKeys: ["demo", SAMPLE_TWO],
        permissionKeys: [`${SAMPLE_TWO}.view`],
      });

      const changed = await setModuleIcon(SAMPLE_TWO, "star");
      expect(changed.errors).toBeUndefined();
      expect(changed.data?.setModuleIcon.module).toMatchObject({
        key: SAMPLE_TWO,
        icon: "star",
      });
      expect(await storedIcon(SAMPLE_TWO)).toBe("star");
      const holderModules = await meModules(holder);
      expect(holderModules.find((one) => one.key === SAMPLE_TWO)?.icon).toBe(
        "star",
      );

      const cleared = await setModuleIcon(SAMPLE_TWO, null);
      expect(cleared.errors).toBeUndefined();
      expect(cleared.data?.setModuleIcon.module.icon).toBeNull();
      // 清空寫的是 null 而不是 $unset:欄位留著才算「人改過的值」,seed 重跑不會補回初值
      expect(await storedIcon(SAMPLE_TWO)).toBeNull();

      await setModuleIcon(SAMPLE_TWO, "list");
    });

    it('白名單外的 key → VALIDATION_FAILED(fields: ["icon"]),資料不動', async () => {
      const before = await storedIcon(SAMPLE_ONE);

      const result = await setModuleIcon(SAMPLE_ONE, "not-a-real-icon");
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["icon"],
      });
      expect(await storedIcon(SAMPLE_ONE)).toBe(before);
    });

    it("不自鎖:模組與權限這一頁自己也換得了圖示(換圖示不會讓人進不來)", async () => {
      const result = await setModuleIcon(MODULE_MANAGER, "category");
      expect(result.errors).toBeUndefined();
      expect(await storedIcon(MODULE_MANAGER)).toBe("category");

      await setModuleIcon(MODULE_MANAGER, "apps");
    });

    it("租戶的操作者即使持有 set-icon 也一律 FORBIDDEN;不存在的 id → NOT_FOUND", async () => {
      const tenantToken = await tenantUser({
        moduleKeys: ["system", MODULE_MANAGER],
        permissionKeys: [`${MODULE_MANAGER}.*`],
      });

      const forbidden = await setModuleIcon(SAMPLE_TWO, "star", tenantToken);
      expect(forbidden.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const notFound = await api.graphql(
        SET_MODULE_ICON,
        { input: { id: "ffffffffffffffffffffffff", icon: "star" } },
        { accessToken: rootToken },
      );
      expect(notFound.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });

    it("寫一筆 module.set-icon 審計(targetType: module),before / after 都帶 key 與 icon", async () => {
      await setModuleIcon(SAMPLE_ONE, "inventory");
      await setModuleIcon(SAMPLE_ONE, "grid");

      const records = await auditActions("module.set-icon");
      const forSampleOne = records.filter(
        (record) => record.before?.key === SAMPLE_ONE,
      );
      expect(forSampleOne).toHaveLength(2);
      expect(forSampleOne[0]).toMatchObject({
        targetType: "module",
        before: { key: SAMPLE_ONE, icon: "grid" },
        after: { key: SAMPLE_ONE, icon: "inventory" },
      });
      expect(forSampleOne[1]?.after).toMatchObject({
        key: SAMPLE_ONE,
        icon: "grid",
      });
    });
  });

  describe("setPermissionEnabled:全域 kill switch", () => {
    it("停用一筆權限後持有者不再持有,連超級管理員(root)也不給;重新啟用即回來", async () => {
      const holder = await tenantUser({
        moduleKeys: ["demo", SAMPLE_TWO],
        // 只存 `*` 一筆,驗「被停用的權限連 wildcard 展開也不給」
        permissionKeys: [`${SAMPLE_TWO}.*`],
      });
      const permissionsOf = async (token: string): Promise<string[]> => {
        const modules = await meModules(token);
        return modules.find((one) => one.key === SAMPLE_TWO)?.permissions ?? [];
      };
      expect(await permissionsOf(holder)).toContain(`${SAMPLE_TWO}.view`);
      expect(await permissionsOf(rootToken)).toContain(`${SAMPLE_TWO}.view`);

      const result = await setPermissionEnabled(`${SAMPLE_TWO}.view`, false);
      expect(result.errors).toBeUndefined();
      expect(result.data?.setPermissionEnabled.permission).toMatchObject({
        key: `${SAMPLE_TWO}.view`,
        enabled: false,
      });

      expect(await permissionsOf(holder)).not.toContain(`${SAMPLE_TWO}.view`);
      expect(await permissionsOf(rootToken)).not.toContain(
        `${SAMPLE_TWO}.view`,
      );
      // 同層其他權限不受影響
      expect(await permissionsOf(holder)).toContain(`${SAMPLE_TWO}.edit`);
      // 停用的權限仍在治理面的樹上,以 enabled 表示狀態(不然就再也開不回來)
      const disabled = byKey(await fetchTree(), SAMPLE_TWO).permissions.find(
        (one) => one.key === `${SAMPLE_TWO}.view`,
      );
      expect(disabled).toMatchObject({ enabled: false });

      await setPermissionEnabled(`${SAMPLE_TWO}.view`, true);
      expect(await permissionsOf(holder)).toContain(`${SAMPLE_TWO}.view`);
    });

    it("寫一筆 permission.toggle-enabled 審計(targetType: permission)", async () => {
      const records = await auditActions("permission.toggle-enabled");
      expect(records.length).toBeGreaterThan(0);
      expect(records[0]).toMatchObject({
        targetType: "permission",
        before: { key: `${SAMPLE_TWO}.view`, enabled: true },
        after: { key: `${SAMPLE_TWO}.view`, enabled: false },
      });
    });
  });

  describe("根組織專屬:站在哪裡才是判準", () => {
    it("租戶的操作者即使持有 system.module-manager 的全部權限,查詢與兩個切換一律 FORBIDDEN(setModuleIcon 見上一節)", async () => {
      const tenantToken = await tenantUser({
        moduleKeys: ["system", MODULE_MANAGER],
        permissionKeys: [`${MODULE_MANAGER}.*`],
      });

      const tree = await api.graphql<ModuleTreeData>(
        MODULE_TREE,
        {},
        { accessToken: tenantToken },
      );
      expect(tree.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const toggleModule = await setModuleEnabled(
        SAMPLE_TWO,
        false,
        tenantToken,
      );
      expect(toggleModule.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await storedEnabled(SAMPLE_TWO)).toBe(true);

      const togglePermission = await setPermissionEnabled(
        `${SAMPLE_TWO}.view`,
        false,
        tenantToken,
      );
      expect(togglePermission.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("沒有 system.module-manager 權限的租戶使用者 → 權限守門先擋(FORBIDDEN)", async () => {
      const outsider = await tenantUser({
        moduleKeys: ["demo", SAMPLE_TWO],
        permissionKeys: [`${SAMPLE_TWO}.view`],
      });
      const tree = await api.graphql<ModuleTreeData>(
        MODULE_TREE,
        {},
        { accessToken: outsider },
      );
      expect(tree.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("自鎖保護：system.module-manager 子樹不可切", () => {
    it("setModuleEnabled 對這一頁本身 → FORBIDDEN + reason SELF_LOCK，且沒有真的停用", async () => {
      const result = await setModuleEnabled(MODULE_MANAGER, false);
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SELF_LOCK",
      });
      expect(await storedEnabled(MODULE_MANAGER)).toBe(true);
    });

    it("setPermissionEnabled 對這一頁的權限 → FORBIDDEN + reason SELF_LOCK", async () => {
      const result = await setPermissionEnabled(
        `${MODULE_MANAGER}.view`,
        false,
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SELF_LOCK",
      });
    });

    it("子樹判定走物化路徑：別的模組不受影響", async () => {
      const result = await setModuleEnabled(SAMPLE_TWO, false);
      expect(result.errors).toBeUndefined();
      await setModuleEnabled(SAMPLE_TWO, true);
    });
  });

  describe("找不到的目標", () => {
    it("不存在的模組 id 與格式不合法的 id 都回 NOT_FOUND", async () => {
      const notFound = await api.graphql(
        SET_MODULE_ENABLED,
        { input: { id: "ffffffffffffffffffffffff", enabled: false } },
        { accessToken: rootToken },
      );
      expect(notFound.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");

      const malformed = await api.graphql(
        SET_PERMISSION_ENABLED,
        { input: { id: "not-an-object-id", enabled: false } },
        { accessToken: rootToken },
      );
      expect(malformed.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });
  });
});
