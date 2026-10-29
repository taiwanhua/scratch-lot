import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import { MODULE_ICON_KEYS } from "@repo/domain/module-icon";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  createRole,
  setModuleEnabled,
  setPermissionEnabled,
  setRoleEnabled,
} from "./test-support/fixtures";
import {
  PROBE_PERMISSION_KEY,
  PermissionProbeModule,
} from "./test-support/probe.resolver";

const PERMISSION_PROBE = /* GraphQL */ `
  query PermissionProbe {
    permissionProbe
  }
`;

interface ProbeData {
  permissionProbe: boolean;
}

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const ME_MODULES = /* GraphQL */ `
  query MeModules {
    me {
      id
      modules {
        id
        key
        name
        parentId
        sidebarType
        order
        route
        icon
        permissions
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface MeModule {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  sidebarType: string;
  order: number;
  route: string | null;
  icon: string | null;
  permissions: string[];
}

interface MeModulesData {
  me: { id: string; modules: MeModule[] };
}

const PASSWORD = ["test", "pass", "word"].join("-");

function byKey(modules: MeModule[], key: string): MeModule {
  const found = modules.find((module) => module.key === key);
  if (!found) {
    throw new Error(`me.modules 沒有 ${key}`);
  }
  return found;
}

/** 不看順序、看成員完全相同(auth.test.ts 的既有寫法)。 */
function expectSameMembers(actual: string[], expected: string[]): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
}

const SAMPLE_ONE = "demo.sub.sample-one";
/** 示範模組1 這一層的全部權限(seed 正本:docs/modules/demo.sub.sample-one.md;wildcard 由 seed 自動產生)。 */
const SAMPLE_ONE_LAYER_PERMISSIONS = [
  `${SAMPLE_ONE}.*`,
  `${SAMPLE_ONE}.view`,
  `${SAMPLE_ONE}.create`,
  `${SAMPLE_ONE}.edit`,
  `${SAMPLE_ONE}.delete`,
  `${SAMPLE_ONE}.show-internal-note`,
  `${SAMPLE_ONE}.edit-internal-note`,
];
/** 示範模組1 家族樹(含次群組與三個隱藏頁)。 */
const SAMPLE_ONE_FAMILY = [
  "demo",
  "demo.sub",
  SAMPLE_ONE,
  `${SAMPLE_ONE}.view-page`,
  `${SAMPLE_ONE}.create-page`,
  `${SAMPLE_ONE}.edit-page`,
];
/**
 * seed 的全部模組(總覽 1 + 系統管理群組 14 + 隱藏 api 樹 2 + 示範家族 6 + 示範模組2 一支 4
 * + 申請中心一支 2 + 輸出報表 1 + 三個示範表單各 4)。
 */
const ALL_SEEDED_MODULES = [
  "overview",
  "system",
  "system.org-manager",
  "system.org-manager.tenant-ops",
  "system.user-manager",
  "system.role-manager",
  "system.module-manager",
  "system.field-manager",
  "system.field-manager.category-ops",
  "system.data-scope",
  "system.forms",
  "system.workflows",
  "system.workflows.blocked-page",
  "system.notification-settings",
  "system.printers",
  "api",
  "api.printing",
  ...SAMPLE_ONE_FAMILY,
  "demo.sample-two",
  "demo.sample-two.view-page",
  "demo.sample-two.create-page",
  "demo.sample-two.edit-page",
  "apply-center",
  "apply-center.view-page",
  "reports",
  ...["demo-form", "demo.form", "demo.sub.form"].flatMap((key) => [
    key,
    `${key}.view-page`,
    `${key}.create-page`,
    `${key}.edit-page`,
  ]),
];

describe("登入線2:me.modules(PermissionResolver,ADR-0011 七步)+ @RequirePermission 守門(GraphQL 端點,對真 Nest app + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenantId: Types.ObjectId;
  let userSequence = 0;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-permission", {}, [
      PermissionProbeModule,
    ]);
    tenantId = await createOrg(api.connection, { name: "租戶甲" });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** 建一個租戶甲的使用者並登入,回 userId 與 access token。 */
  async function createLoggedInUser(): Promise<{
    userId: Types.ObjectId;
    accessToken: string;
  }> {
    userSequence += 1;
    const account = `perm-user-${String(userSequence)}`;
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds: [tenantId],
    });
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password: PASSWORD },
    });
    expect(result.errors).toBeUndefined();
    const accessToken = result.data?.login.accessToken;
    if (!accessToken) {
      throw new Error("login 沒有回 accessToken");
    }
    return { userId, accessToken };
  }

  async function fetchModules(accessToken: string): Promise<MeModule[]> {
    const result = await api.graphql<MeModulesData>(
      ME_MODULES,
      {},
      { accessToken },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.me.modules ?? [];
  }

  async function probe(
    accessToken?: string,
  ): Promise<{ allowed: boolean; code: string | undefined }> {
    const result = await api.graphql<ProbeData>(
      PERMISSION_PROBE,
      {},
      accessToken === undefined ? {} : { accessToken },
    );
    return {
      allowed: result.data?.permissionProbe === true,
      code: result.errors?.[0]?.extensions?.code,
    };
  }

  /** 建使用者 + 角色(預設綁示範模組1 家族樹)+ 指定權限,回 access token。 */
  async function userWithPermissions(
    permissionKeys: string[],
    moduleKeys: string[] = SAMPLE_ONE_FAMILY,
  ): Promise<string> {
    const { userId, accessToken } = await createLoggedInUser();
    await createRole(api.app, api.connection, {
      name: `守門:${permissionKeys.join(",") || "無權限"}`,
      ownerOrgId: tenantId,
      moduleKeys,
      permissionKeys,
      assignTo: [userId],
    });
    return accessToken;
  }

  describe("me.modules:一般角色", () => {
    it("只回綁定的模組(樹完整),每筆 permissions 為該模組的有效權限;未綁的模組不出現", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      await createRole(api.app, api.connection, {
        name: "只綁示範模組2",
        ownerOrgId: tenantId,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.view", "demo.sample-two.edit"],
        assignTo: [userId],
      });

      const modules = await fetchModules(accessToken);
      expectSameMembers(
        modules.map((module) => module.key),
        ["demo", "demo.sample-two"],
      );

      const demo = byKey(modules, "demo");
      expect(demo).toMatchObject({
        name: "示範群組",
        parentId: null,
        sidebarType: "GROUP",
        order: 2,
        route: "/demo",
        permissions: [],
      });

      const sampleTwo = byKey(modules, "demo.sample-two");
      expect(sampleTwo).toMatchObject({
        name: "示範模組2",
        parentId: demo.id,
        sidebarType: "LINK",
        order: 2,
        route: "/demo/sample-two",
      });
      expectSameMembers(sampleTwo.permissions, [
        "demo.sample-two.edit",
        "demo.sample-two.view",
      ]);
    });

    it("wildcard 同層語意(劇本 1):只存 `X.*` 一筆 → X 這一層全部視為持有(含 `*` 本身);子模組(edit-page)與父群組不受影響", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      await createRole(api.app, api.connection, {
        name: "示範模組1 全給(只存 * 一筆)",
        ownerOrgId: tenantId,
        moduleKeys: SAMPLE_ONE_FAMILY,
        permissionKeys: [`${SAMPLE_ONE}.*`],
        assignTo: [userId],
      });

      const modules = await fetchModules(accessToken);
      expectSameMembers(
        modules.map((module) => module.key),
        SAMPLE_ONE_FAMILY,
      );
      expectSameMembers(
        byKey(modules, SAMPLE_ONE).permissions,
        SAMPLE_ONE_LAYER_PERMISSIONS,
      );
      // 子模組由自己的 `*` 代表:edit-page 的 show-history / `*` 都沒有
      expect(byKey(modules, `${SAMPLE_ONE}.edit-page`).permissions).toEqual([]);
      expect(byKey(modules, "demo.sub").permissions).toEqual([]);
      expect(byKey(modules, "demo").permissions).toEqual([]);
    });

    it("多個角色取聯集(純加法):模組與權限都是各角色綁定的聯集", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      await createRole(api.app, api.connection, {
        name: "聯集 A:示範模組2 可看",
        ownerOrgId: tenantId,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.view"],
        assignTo: [userId],
      });
      await createRole(api.app, api.connection, {
        name: "聯集 B:示範模組1 可編輯",
        ownerOrgId: tenantId,
        moduleKeys: ["demo", "demo.sub", SAMPLE_ONE],
        permissionKeys: [`${SAMPLE_ONE}.edit`],
        assignTo: [userId],
      });

      const modules = await fetchModules(accessToken);
      expectSameMembers(
        modules.map((module) => module.key),
        ["demo", "demo.sample-two", "demo.sub", SAMPLE_ONE],
      );
      expect(byKey(modules, "demo.sample-two").permissions).toEqual([
        "demo.sample-two.view",
      ]);
      expect(byKey(modules, SAMPLE_ONE).permissions).toEqual([
        `${SAMPLE_ONE}.edit`,
      ]);
    });

    it("停用的角色不計:角色 enabled=false 後,它綁的模組與權限全部消失(授予仍在,只是不生效)", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      const roleId = await createRole(api.app, api.connection, {
        name: "會被停用的角色",
        ownerOrgId: tenantId,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.view"],
        assignTo: [userId],
      });
      const before = await fetchModules(accessToken);
      expect(before).toHaveLength(2);

      await setRoleEnabled(api.connection, roleId, false);
      expect(await fetchModules(accessToken)).toEqual([]);
    });

    it("停用的權限不算持有(全域 kill switch):permissions.enabled=false 的權限不出現,連被 `*` 展開的也不給", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      await createRole(api.app, api.connection, {
        name: "示範模組2 全給",
        ownerOrgId: tenantId,
        moduleKeys: ["demo", "demo.sample-two"],
        permissionKeys: ["demo.sample-two.*"],
        assignTo: [userId],
      });
      const before = byKey(await fetchModules(accessToken), "demo.sample-two");
      expect(before.permissions).toContain("demo.sample-two.delete");

      await setPermissionEnabled(
        api.connection,
        "demo.sample-two.delete",
        false,
      );
      try {
        const after = byKey(await fetchModules(accessToken), "demo.sample-two");
        expect(after.permissions).not.toContain("demo.sample-two.delete");
        expect(after.permissions).toContain("demo.sample-two.view");
      } finally {
        await setPermissionEnabled(
          api.connection,
          "demo.sample-two.delete",
          true,
        );
      }
    });

    it("沒有任何角色 → 空陣列", async () => {
      const { accessToken } = await createLoggedInUser();
      expect(await fetchModules(accessToken)).toEqual([]);
    });
  });

  describe("me.modules:超級管理員(root)bypass", () => {
    it("回全部 enabled 模組(含根組織專屬 system.module-manager / system.data-scope 與隱藏 api 樹)與全部權限,不靠權限記錄", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      const accessToken = login.data?.login.accessToken ?? "";

      const modules = await fetchModules(accessToken);
      expectSameMembers(
        modules.map((module) => module.key),
        ALL_SEEDED_MODULES,
      );
      expectSameMembers(
        byKey(modules, SAMPLE_ONE).permissions,
        SAMPLE_ONE_LAYER_PERMISSIONS,
      );
      expectSameMembers(byKey(modules, `${SAMPLE_ONE}.edit-page`).permissions, [
        `${SAMPLE_ONE}.edit-page.*`,
        `${SAMPLE_ONE}.edit-page.show-history`,
      ]);
      // 根組織專屬模組的同層權限(正本:docs/modules/module-manager.md、data-scope.md 權限表)
      expectSameMembers(byKey(modules, "system.module-manager").permissions, [
        "system.module-manager.*",
        "system.module-manager.view",
        "system.module-manager.toggle-enabled",
        "system.module-manager.set-icon",
        "system.module-manager.delete-retired-permission",
      ]);
      expectSameMembers(byKey(modules, "system.data-scope").permissions, [
        "system.data-scope.*",
        "system.data-scope.view",
        "system.data-scope.edit",
      ]);
    });
  });

  describe("me.modules:route 為完整路徑(父段累加)", () => {
    it("群組、連結頁、隱藏頁都是完整路徑;隱藏 api 樹不是頁面、無 route → 進陣列但 route 為 null", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      const modules = await fetchModules(login.data?.login.accessToken ?? "");

      expect(byKey(modules, "system").route).toBe("/system");
      expect(byKey(modules, "system.org-manager").route).toBe(
        "/system/org-manager",
      );
      expect(byKey(modules, "demo.sub").route).toBe("/demo/sub");
      expect(byKey(modules, SAMPLE_ONE).route).toBe("/demo/sub/sample-one");
      expect(byKey(modules, `${SAMPLE_ONE}.edit-page`)).toMatchObject({
        sidebarType: "HIDDEN",
        route: "/demo/sub/sample-one/edit-page",
      });
      expect(byKey(modules, "demo.sample-two.create-page").route).toBe(
        "/demo/sample-two/create-page",
      );
      expect(byKey(modules, "api")).toMatchObject({
        sidebarType: "HIDDEN",
        route: null,
        parentId: null,
        permissions: ["api.*"],
      });
    });

    it("無 route 的隱藏模組掛在有 route 的父模組底下(system.org-manager.tenant-ops)也回 route: null,不繼承父路徑", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      const modules = await fetchModules(login.data?.login.accessToken ?? "");

      const tenantOps = byKey(modules, "system.org-manager.tenant-ops");
      expect(tenantOps).toMatchObject({
        sidebarType: "HIDDEN",
        route: null,
        parentId: byKey(modules, "system.org-manager").id,
      });
      // 權限仍在(彈窗開在組織管理頁上,權限由這個容器模組承載)。
      // 可見範圍開關 2026-09-19 搬到組織管理層(它不是根組織專屬動作),不再在這裡。
      expectSameMembers(tenantOps.permissions, [
        "system.org-manager.tenant-ops.*",
        "system.org-manager.tenant-ops.provision",
        "system.org-manager.tenant-ops.revoke-provision",
        "system.org-manager.tenant-ops.purge-demo",
        "system.org-manager.tenant-ops.transfer-owner",
      ]);
      expect(byKey(modules, "system.org-manager").permissions).toContain(
        "system.org-manager.set-visibility",
      );
      expect(byKey(modules, "system.org-manager").permissions).toContain(
        "system.org-manager.set-timezone",
      );
    });
  });

  describe("me.modules:icon 為側欄圖示 key", () => {
    it("seed 給初值的節點回白名單 key、沒給的隱藏頁回 null;值都在 MODULE_ICON_KEYS 內", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      const modules = await fetchModules(login.data?.login.accessToken ?? "");

      // 初值正本:apps/db-migrator/seeds/base/modules/*.ts(對照表見 docs/modules/module-manager.md)
      expect(byKey(modules, "overview").icon).toBe("dashboard");
      expect(byKey(modules, "system").icon).toBe("settings");
      expect(byKey(modules, "system.module-manager").icon).toBe("apps");
      expect(byKey(modules, SAMPLE_ONE).icon).toBe("grid");
      // 隱藏頁 seed 不給圖示 → null = 側欄用預設圖示
      expect(byKey(modules, `${SAMPLE_ONE}.edit-page`).icon).toBeNull();

      // 白名單是前後端共用的那一份,不是各寫一份字串
      for (const module of modules) {
        if (module.icon !== null) {
          expect(MODULE_ICON_KEYS).toContain(module.icon);
        }
      }
    });
  });

  describe("me.modules:父模組 enabled=false → 整棵子樹不出現", () => {
    it("停用 demo.sub:root 與一般角色都看不到 demo.sub 及其下全部,demo 與 demo.sample-two 不受影響", async () => {
      const { userId, accessToken } = await createLoggedInUser();
      await createRole(api.app, api.connection, {
        name: "示範家族全綁",
        ownerOrgId: tenantId,
        moduleKeys: [...SAMPLE_ONE_FAMILY, "demo.sample-two"],
        permissionKeys: [`${SAMPLE_ONE}.*`, "demo.sample-two.*"],
        assignTo: [userId],
      });
      await setModuleEnabled(api.connection, "demo.sub", false);
      try {
        const modules = await fetchModules(accessToken);
        expectSameMembers(
          modules.map((module) => module.key),
          ["demo", "demo.sample-two"],
        );

        const rootLogin = await api.graphql<LoginData>(LOGIN, {
          input: {
            account: ROOT_ADMIN.account,
            password: ROOT_ADMIN.password,
          },
        });
        const rootModules = await fetchModules(
          rootLogin.data?.login.accessToken ?? "",
        );
        expectSameMembers(
          rootModules.map((module) => module.key),
          ALL_SEEDED_MODULES.filter(
            (key) => key !== "demo.sub" && !key.startsWith("demo.sub."),
          ),
        );
      } finally {
        await setModuleEnabled(api.connection, "demo.sub", true);
      }
    });
  });

  describe("@RequirePermission 守門(探針端點要求 demo.sub.sample-one.edit)", () => {
    it("未登入 → UNAUTHENTICATED(全域登入守門先於權限守門)", async () => {
      expect(await probe()).toEqual({
        allowed: false,
        code: "UNAUTHENTICATED",
      });
    });

    it("精確持有 → 放行", async () => {
      const accessToken = await userWithPermissions([PROBE_PERMISSION_KEY]);
      expect(await probe(accessToken)).toEqual({
        allowed: true,
        code: undefined,
      });
    });

    it("持有擁有模組的 `*` → 放行", async () => {
      const accessToken = await userWithPermissions([`${SAMPLE_ONE}.*`]);
      expect(await probe(accessToken)).toEqual({
        allowed: true,
        code: undefined,
      });
    });

    it("無權(只有同層其他權限、或只有父群組的 `*`)→ FORBIDDEN,不登出", async () => {
      const onlyView = await userWithPermissions([`${SAMPLE_ONE}.view`]);
      expect(await probe(onlyView)).toEqual({
        allowed: false,
        code: "FORBIDDEN",
      });

      // 同層語意:父群組 demo.sub 的 `*` 不涵蓋子模組 sample-one
      const parentWildcard = await userWithPermissions(["demo.sub.*"]);
      expect(await probe(parentWildcard)).toEqual({
        allowed: false,
        code: "FORBIDDEN",
      });

      const noRole = await createLoggedInUser();
      expect(await probe(noRole.accessToken)).toEqual({
        allowed: false,
        code: "FORBIDDEN",
      });
    });

    it("超級管理員(root)bypass → 放行", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      expect(await probe(login.data?.login.accessToken)).toEqual({
        allowed: true,
        code: undefined,
      });
    });

    it("擁有模組所在子樹被停用 → 權限隨之失效(FORBIDDEN),與 me.modules 一致", async () => {
      const accessToken = await userWithPermissions([PROBE_PERMISSION_KEY]);
      await setModuleEnabled(api.connection, "demo.sub", false);
      try {
        expect(await probe(accessToken)).toEqual({
          allowed: false,
          code: "FORBIDDEN",
        });
      } finally {
        await setModuleEnabled(api.connection, "demo.sub", true);
      }
      const reEnabled = await probe(accessToken);
      expect(reEnabled.allowed).toBe(true);
    });

    it("未標註 @RequirePermission 的端點維持「已登入即可」(me 對無任何角色的使用者仍可用)", async () => {
      const { accessToken } = await createLoggedInUser();
      const result = await api.graphql<MeModulesData>(
        ME_MODULES,
        {},
        { accessToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.me.modules).toEqual([]);
    });
  });
});
