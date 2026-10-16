import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import { dataScopeTargetIdOf } from "../../data-scope/test-support/fixtures";
import { BaseRepository } from "../../database/base.repository";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { createRole } from "../../permission/test-support/fixtures";
import {
  PROJECT_FIXTURE_ITEMS_COLLECTION,
  PROJECT_FIXTURE_MODULE_KEY,
  ProjectFixtureItem,
} from "./database/project-fixture-item.schema";
import { ProjectFixtureItemsRepository } from "./database/project-fixture-items.repository";
import {
  CREATE_PROJECT_FIXTURE_ITEM,
  type CreateProjectFixtureItemData,
  DELETE_PROJECT_FIXTURE_ITEM,
  type DeleteProjectFixtureItemData,
  PROJECT_FIXTURE_ITEMS,
  PROJECT_FIXTURE_PERMISSIONS,
  type ProjectFixtureItemsData,
  seedProjectFixtureAuthorization,
} from "./fixtures";

/**
 * 只替換**兩份專案登記來源**(`project/api-modules.ts`、`project/database/registrations.ts`):
 * 在正式內容後面各加上測試專案的一筆。底座的功能清單、資料登記、`AppModule`、`DatabaseModule`
 * 與 reader / guards / repository 全都是真的,不經 `extraModules`、不 mock。
 */
jest.mock("../../project/api-modules", () => {
  const actual = jest.requireActual<typeof import("../../project/api-modules")>(
    "../../project/api-modules",
  );
  const fixture =
    jest.requireActual<typeof import("./api-modules")>("./api-modules");
  return {
    PROJECT_API_MODULES: [
      ...actual.PROJECT_API_MODULES,
      ...fixture.PROJECT_FIXTURE_API_MODULES,
    ],
  };
});
jest.mock("../../project/database/registrations", () => {
  const actual = jest.requireActual<
    typeof import("../../project/database/registrations")
  >("../../project/database/registrations");
  const fixture = jest.requireActual<typeof import("./database/registrations")>(
    "./database/registrations",
  );
  return {
    PROJECT_DATABASE_REGISTRATIONS: [
      ...actual.PROJECT_DATABASE_REGISTRATIONS,
      ...fixture.PROJECT_FIXTURE_DATABASE_REGISTRATIONS,
    ],
  };
});

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const DELETE_ORG = /* GraphQL */ `
  mutation DeleteOrg($input: DeleteOrgInput!) {
    deleteOrg(input: $input) {
      success
      deletedId
    }
  }
`;

const PROVISION_TENANT = /* GraphQL */ `
  mutation ProvisionTenant($input: ProvisionTenantInput!) {
    provisionTenant(input: $input) {
      org {
        id
      }
    }
  }
`;

const REVOKE_TENANT_PROVISION = /* GraphQL */ `
  mutation RevokeTenantProvision($input: RevokeTenantProvisionInput!) {
    revokeTenantProvision(input: $input) {
      success
      revokedOrgId
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

interface LoginData {
  login: { accessToken: string };
}

interface DeleteOrgData {
  deleteOrg: { success: boolean; deletedId: string };
}

interface ProvisionTenantData {
  provisionTenant: { org: { id: string } };
}

interface RevokeTenantProvisionData {
  revokeTenantProvision: { success: boolean; revokedOrgId: string };
}

interface ItemRow {
  _id: Types.ObjectId;
  name: string;
  orgId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  moduleKey: string;
  createdBy: Types.ObjectId | null;
  deletedAt: Date | null;
}

const PASSWORD = ["project", "fixture", "pass"].join("-");
const ORG_MANAGER_MODULE = "system.org-manager";
const USER_MANAGER_MODULE = "system.user-manager";
const TENANT_OPS_MODULE = "system.org-manager.tenant-ops";
const ALL_FIXTURE_PERMISSIONS = Object.values(PROJECT_FIXTURE_PERMISSIONS);

/** 【操作者本人】的條件列(ADR-0008「僅本人」;形狀正本 data-scope.test.ts)。 */
const ONLY_MINE = {
  op: "AND",
  children: [
    {
      field: "createdBy",
      cond: "in",
      value: { kind: "dynamic", ref: "current-user" },
    },
  ],
};

/**
 * 專案功能登記的驗收(docs/standards/testing/testing.md「專案功能與資料登記的整合驗收」):
 * 真 Nest + 隔離的 MongoDB + 真 GraphQL。測試專案的模組、權限、資料範圍目標只由 harness 寫入測試資料庫。
 *
 * 組織樹(root 為 seed 建的根組織):root ─┬─ 租戶甲(可見範圍 subtree)── 各測試自己的部門
 *                                        └─ 租戶乙
 */
describe("專案功能登記:只加專案來源,經真 AppModule / DatabaseModule 啟動", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;

  let rootToken: string;
  /** 租戶甲的管理員:組織管理 + 測試專案的全部權限。 */
  let adminAId: Types.ObjectId;
  let adminAToken: string;
  /** 租戶甲只有檢視權的人。 */
  let viewerAToken: string;
  /** 租戶乙的操作者:測試專案的全部權限。 */
  let operatorBToken: string;
  /** 有登入、沒有任何角色。 */
  let nobodyToken: string;
  /** 根組織的租戶作業員(不是超級管理員):撤銷開通 + 測試專案檢視。 */
  let rootOpsId: Types.ObjectId;
  let rootOpsToken: string;

  let sequence = 0;

  function next(prefix: string): string {
    sequence += 1;
    return `${prefix}-${String(sequence)}`;
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

  function itemRow(id: string | Types.ObjectId): Promise<ItemRow | null> {
    return api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .findOne<ItemRow>({ _id: new Types.ObjectId(String(id)) });
  }

  /** 直接在某個組織名下放一筆別人建的項目(不經 API:那個組織不必有成員)。 */
  async function insertItem(
    orgId: Types.ObjectId,
    tenantId: Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ): Promise<Types.ObjectId> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .insertOne({
        name: next("別人建的項目"),
        orgId,
        tenantId,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
        ...overrides,
      });
    return insertedId;
  }

  async function listNames(token: string): Promise<string[]> {
    const result = await api.graphql<ProjectFixtureItemsData>(
      PROJECT_FIXTURE_ITEMS,
      {},
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    return (result.data?.projectFixtureItems ?? []).map((item) => item.name);
  }

  async function createItem(token: string, name: string) {
    const result = await api.graphql<CreateProjectFixtureItemData>(
      CREATE_PROJECT_FIXTURE_ITEM,
      { name },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    const item = result.data?.createProjectFixtureItem;
    if (!item) {
      throw new Error("createProjectFixtureItem 沒有回資料");
    }
    return item;
  }

  function deleteOrg(orgId: Types.ObjectId, token = adminAToken) {
    return api.graphql<DeleteOrgData>(
      DELETE_ORG,
      { input: { id: String(orgId) } },
      { accessToken: token },
    );
  }

  async function orgDeletedAt(orgId: Types.ObjectId): Promise<Date | null> {
    const row = await api.connection
      .collection("orgs")
      .findOne<{ deletedAt: Date | null }>({ _id: orgId });
    if (!row) {
      throw new Error(`組織不存在:${String(orgId)}`);
    }
    return row.deletedAt;
  }

  /** 把測試專案的資料範圍規則設成「指定使用者只看得到自己建的」;回傳清掉規則的函式。 */
  async function onlyMineFor(
    userId: Types.ObjectId,
  ): Promise<() => Promise<void>> {
    const targetId = await dataScopeTargetIdOf(
      api.connection,
      PROJECT_FIXTURE_MODULE_KEY,
    );
    const save = async (rules: Record<string, unknown>[]) => {
      const saved = await api.graphql(
        SAVE_DATA_SCOPE_RULE,
        { input: { targetId, combineOp: "OR", rules } },
        { accessToken: rootToken },
      );
      expect(saved.errors).toBeUndefined();
    };
    await save([
      {
        audience: {
          mode: "match",
          filter: {
            field: "user",
            cond: "in",
            value: { kind: "static", values: [String(userId)] },
          },
        },
        filter: ONLY_MINE,
      },
    ]);
    return () => save([]);
  }

  async function provisionTenant(): Promise<Types.ObjectId> {
    const account = next("fixture-tenant-admin");
    const result = await api.graphql<ProvisionTenantData>(
      PROVISION_TENANT,
      {
        input: {
          name: `租戶 ${account}`,
          slug: next("fixture_tenant").replaceAll("-", "_"),
          adminAccount: account,
          adminEmail: `${account}@example.com`,
          logoPath: null,
          moduleKeys: [ORG_MANAGER_MODULE, USER_MANAGER_MODULE],
        },
      },
      { accessToken: rootOpsToken },
    );
    expect(result.errors).toBeUndefined();
    const id = result.data?.provisionTenant.org.id;
    if (!id) {
      throw new Error("provisionTenant 沒有回 org");
    }
    return new Types.ObjectId(id);
  }

  function revokeProvision(orgId: Types.ObjectId) {
    return api.graphql<RevokeTenantProvisionData>(
      REVOKE_TENANT_PROVISION,
      { input: { orgId: String(orgId) } },
      { accessToken: rootOpsToken },
    );
  }

  async function createOperator(
    prefix: string,
    orgId: Types.ObjectId,
    role?: { moduleKeys: string[]; permissionKeys: string[] },
  ): Promise<{ userId: Types.ObjectId; token: string }> {
    const account = next(prefix);
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds: [orgId],
    });
    if (role) {
      await createRole(api.app, api.connection, {
        name: `角色:${account}`,
        ownerOrgId: orgId,
        moduleKeys: role.moduleKeys,
        permissionKeys: role.permissionKeys,
        assignTo: [userId],
      });
    }
    return { userId, token: await login(account) };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-project-fixture");
    await seedProjectFixtureAuthorization(api.connection);
    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);

    tenantA = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    tenantB = await createOrg(api.connection, { name: "租戶乙" });

    const adminA = await createOperator("fixture-admin-a", tenantA, {
      moduleKeys: [ORG_MANAGER_MODULE, PROJECT_FIXTURE_MODULE_KEY],
      permissionKeys: [`${ORG_MANAGER_MODULE}.*`, ...ALL_FIXTURE_PERMISSIONS],
    });
    adminAId = adminA.userId;
    adminAToken = adminA.token;

    const viewerA = await createOperator("fixture-viewer-a", tenantA, {
      moduleKeys: [PROJECT_FIXTURE_MODULE_KEY],
      permissionKeys: [PROJECT_FIXTURE_PERMISSIONS.view],
    });
    viewerAToken = viewerA.token;

    const operatorB = await createOperator("fixture-operator-b", tenantB, {
      moduleKeys: [PROJECT_FIXTURE_MODULE_KEY],
      permissionKeys: ALL_FIXTURE_PERMISSIONS,
    });
    operatorBToken = operatorB.token;

    const nobody = await createOperator("fixture-nobody", tenantA);
    nobodyToken = nobody.token;

    const rootOrg = await api.connection
      .collection("orgs")
      .findOne<{ _id: Types.ObjectId }>({ parentId: null });
    if (!rootOrg) {
      throw new Error("測試資料庫沒有根組織");
    }
    const rootOps = await createOperator("fixture-root-ops", rootOrg._id, {
      moduleKeys: [
        ORG_MANAGER_MODULE,
        TENANT_OPS_MODULE,
        USER_MANAGER_MODULE,
        PROJECT_FIXTURE_MODULE_KEY,
      ],
      permissionKeys: [
        `${ORG_MANAGER_MODULE}.*`,
        `${USER_MANAGER_MODULE}.*`,
        `${TENANT_OPS_MODULE}.provision`,
        `${TENANT_OPS_MODULE}.revoke-provision`,
        PROJECT_FIXTURE_PERMISSIONS.view,
      ],
    });
    rootOpsId = rootOps.userId;
    rootOpsToken = rootOps.token;
  }, HOOK_TIMEOUT_MS * 4);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("組裝:專案來源接進固定入口,既有專案登記照常", () => {
    it("測試專案的 repository 由 DatabaseModule 提供,綁的是登記的那張表", () => {
      const repository = api.app.get(ProjectFixtureItemsRepository, {
        strict: false,
      });
      expect(repository).toBeInstanceOf(BaseRepository);
      expect(repository.modelName).toBe(ProjectFixtureItem.name);
      expect(repository.collectionName).toBe(PROJECT_FIXTURE_ITEMS_COLLECTION);
    });

    it("正式專案登記的功能與 model 照常載入(fixture 只追加,不頂掉既有登記;各功能的行為由專案自己的測試驗)", () => {
      const { PROJECT_API_MODULES } = jest.requireActual<
        typeof import("../../project/api-modules")
      >("../../project/api-modules");
      const { PROJECT_DATABASE_REGISTRATIONS } = jest.requireActual<
        typeof import("../../project/database/registrations")
      >("../../project/database/registrations");

      for (const feature of PROJECT_API_MODULES) {
        expect(api.app.get(feature.module, { strict: false })).toBeInstanceOf(
          feature.module,
        );
      }
      for (const registration of PROJECT_DATABASE_REGISTRATIONS) {
        for (const model of registration.models) {
          const registered = api.app.get<Model<unknown>>(
            getModelToken(model.name),
            { strict: false },
          );
          expect(registered.collection.name).toBe(model.collection);
        }
      }
    });
  });

  describe("守門:沿用全域 AuthGuard 與 @RequirePermission", () => {
    it("未登入:UNAUTHENTICATED", async () => {
      const result = await api.graphql(PROJECT_FIXTURE_ITEMS);
      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });

    it("有登入但沒有任何角色:FORBIDDEN", async () => {
      const result = await api.graphql(
        PROJECT_FIXTURE_ITEMS,
        {},
        { accessToken: nobodyToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("只有檢視權硬送建立 / 刪除:FORBIDDEN,資料不變", async () => {
      const itemId = await insertItem(tenantA, tenantA);

      const create = await api.graphql(
        CREATE_PROJECT_FIXTURE_ITEM,
        { name: "硬送" },
        { accessToken: viewerAToken },
      );
      expect(create.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const remove = await api.graphql(
        DELETE_PROJECT_FIXTURE_ITEM,
        { id: String(itemId) },
        { accessToken: viewerAToken },
      );
      expect(remove.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      const untouched = await itemRow(itemId);
      expect(untouched?.deletedAt).toBeNull();
    });
  });

  describe("租戶資料:隔離、操作者上下文、軟刪除、資料範圍都由資料層套上", () => {
    it("建立:寫進當前組織,tenantId / moduleKey / createdBy 由資料層填", async () => {
      const name = next("甲的項目");
      const created = await createItem(adminAToken, name);

      expect(created.orgId).toBe(String(tenantA));
      const row = await itemRow(created.id);
      expect(row).toMatchObject({
        name,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        deletedAt: null,
      });
      expect(String(row?.orgId)).toBe(String(tenantA));
      expect(String(row?.tenantId)).toBe(String(tenantA));
      expect(String(row?.createdBy)).toBe(String(adminAId));
      expect(await listNames(adminAToken)).toContain(name);
    });

    it("租戶隔離:別的租戶看不到,也刪不到(NOT_FOUND)", async () => {
      const name = next("只屬於甲");
      const created = await createItem(adminAToken, name);

      expect(await listNames(operatorBToken)).not.toContain(name);
      const remove = await api.graphql(
        DELETE_PROJECT_FIXTURE_ITEM,
        { id: created.id },
        { accessToken: operatorBToken },
      );
      expect(remove.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
      const untouched = await itemRow(created.id);
      expect(untouched?.deletedAt).toBeNull();
    });

    it("缺操作者上下文的查詢直接拋錯(fail-closed),不會回傳全部", async () => {
      await insertItem(tenantA, tenantA);
      const model = api.app.get<Model<ProjectFixtureItem>>(
        getModelToken(ProjectFixtureItem.name),
        { strict: false },
      );

      await expect(model.find().exec()).rejects.toThrow(/操作者上下文/);
      await expect(model.countDocuments({}).exec()).rejects.toThrow(
        /操作者上下文/,
      );
    });

    it("軟刪除:資料留著、deletedAt 有值,之後查不到也刪不到", async () => {
      const name = next("會被刪的項目");
      const created = await createItem(adminAToken, name);

      const removed = await api.graphql<DeleteProjectFixtureItemData>(
        DELETE_PROJECT_FIXTURE_ITEM,
        { id: created.id },
        { accessToken: adminAToken },
      );
      expect(removed.errors).toBeUndefined();
      expect(removed.data?.deleteProjectFixtureItem).toBe(true);

      const row = await itemRow(created.id);
      expect(row?.name).toBe(name);
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(await listNames(adminAToken)).not.toContain(name);

      const again = await api.graphql(
        DELETE_PROJECT_FIXTURE_ITEM,
        { id: created.id },
        { accessToken: adminAToken },
      );
      expect(again.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });

    it("資料範圍規則:「僅本人」把別人建的項目從清單收掉,自己建的還在", async () => {
      const mine = next("甲管理員自己建的");
      await createItem(adminAToken, mine);
      const others = next("別人建的");
      await insertItem(tenantA, tenantA, { name: others });
      expect(await listNames(adminAToken)).toEqual(
        expect.arrayContaining([mine, others]),
      );

      const clearRule = await onlyMineFor(adminAId);
      try {
        const narrowed = await listNames(adminAToken);
        expect(narrowed).toContain(mine);
        expect(narrowed).not.toContain(others);
        // 規則只對指定的人生效:同租戶的檢視者照樣看得到
        expect(await listNames(viewerAToken)).toContain(others);
      } finally {
        await clearRule();
      }
    });
  });

  describe("刪除組織:專案資料的組織歸屬檢查", () => {
    it("資料被資料範圍規則藏起來仍然擋下:HAS_BUSINESS_DATA,組織沒被刪", async () => {
      const orgId = await createOrg(api.connection, {
        name: next("有專案資料的部門"),
        parentId: tenantA,
      });
      const hidden = next("被規則藏起來的項目");
      await insertItem(orgId, tenantA, { name: hidden });

      const clearRule = await onlyMineFor(adminAId);
      try {
        expect(await listNames(adminAToken)).not.toContain(hidden);

        const result = await deleteOrg(orgId);

        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "ORG_NOT_DELETABLE",
          reasons: ["HAS_BUSINESS_DATA"],
        });
        expect(await orgDeletedAt(orgId)).toBeNull();
      } finally {
        await clearRule();
      }
    });

    it("別的組織有資料不會誤擋:空的組織刪得掉", async () => {
      const withData = await createOrg(api.connection, {
        name: next("有資料的部門"),
        parentId: tenantA,
      });
      await insertItem(withData, tenantA);
      const empty = await createOrg(api.connection, {
        name: next("空的部門"),
        parentId: tenantA,
      });

      const result = await deleteOrg(empty);

      expect(result.errors).toBeUndefined();
      expect(result.data?.deleteOrg).toEqual({
        success: true,
        deletedId: String(empty),
      });
      expect(await orgDeletedAt(withData)).toBeNull();
    });

    it("只剩已軟刪除的專案資料:不算還有資料,組織刪得掉", async () => {
      const orgId = await createOrg(api.connection, {
        name: next("資料都刪了的部門"),
        parentId: tenantA,
      });
      await insertItem(orgId, tenantA, { deletedAt: new Date() });

      const result = await deleteOrg(orgId);

      expect(result.errors).toBeUndefined();
      expect(result.data?.deleteOrg.success).toBe(true);
    });

    it("檢查查詢失敗時不放行:刪除失敗、組織原封不動", async () => {
      const orgId = await createOrg(api.connection, {
        name: next("檢查會失敗的部門"),
        parentId: tenantA,
      });
      const model = api.app.get<Model<ProjectFixtureItem>>(
        getModelToken(ProjectFixtureItem.name),
        { strict: false },
      );
      // 在資料庫邊界注入故障:reader、repository 與入口都是真的
      const spy = jest.spyOn(model, "countDocuments").mockImplementation(() => {
        throw new Error("project_fixture_items 查詢失敗");
      });
      try {
        const result = await deleteOrg(orgId);

        expect(spy).toHaveBeenCalled();
        expect(result.errors).toBeDefined();
        expect(result.data?.deleteOrg).toBeUndefined();
        expect(await orgDeletedAt(orgId)).toBeNull();
      } finally {
        spy.mockRestore();
      }

      // 故障排除後同一個組織刪得掉:剛才擋下的原因確實是檢查失敗
      const retried = await deleteOrg(orgId);
      expect(retried.errors).toBeUndefined();
    });
  });

  describe("撤銷開通:與刪除組織共用同一份檢查", () => {
    it("資料被資料範圍規則藏起來仍然擋下:PROVISION_NOT_REVOKABLE + HAS_BUSINESS_DATA", async () => {
      const tenantId = await provisionTenant();
      const hidden = next("租戶的專案資料");
      await insertItem(tenantId, tenantId, { name: hidden });

      const clearRule = await onlyMineFor(rootOpsId);
      try {
        expect(await listNames(rootOpsToken)).not.toContain(hidden);

        const result = await revokeProvision(tenantId);

        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "PROVISION_NOT_REVOKABLE",
          reasons: ["HAS_BUSINESS_DATA"],
        });
        expect(
          await api.connection.collection("orgs").findOne({ _id: tenantId }),
        ).not.toBeNull();
      } finally {
        await clearRule();
      }
    });

    it("別的租戶有專案資料不會誤擋:空的租戶撤銷得掉", async () => {
      await insertItem(tenantB, tenantB);
      const tenantId = await provisionTenant();

      const result = await revokeProvision(tenantId);

      expect(result.errors).toBeUndefined();
      expect(result.data?.revokeTenantProvision).toMatchObject({
        success: true,
        revokedOrgId: String(tenantId),
      });
    });
  });
});
