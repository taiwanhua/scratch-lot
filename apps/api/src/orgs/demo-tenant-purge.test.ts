import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Schema, Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { TENANT_PURGE } from "../database/database.module";
import {
  type TenantPurgeStep,
  resolveTenantPurgePlan,
} from "../database/tenant-purge";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import { RecordingStorageService } from "../storage/recording-storage.service";
import { StorageService } from "../storage/storage.service";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
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
    }
  }
`;

const PURGE_DEMO_TENANT = /* GraphQL */ `
  mutation PurgeDemoTenant($input: PurgeDemoTenantInput!) {
    purgeDemoTenant(input: $input) {
      purged
      orgId
      deletedDocuments
      deletedUsers
      detachedUsers
      deletedFiles
      collections {
        collection
        deleted
      }
    }
  }
`;

interface ProvisionData {
  provisionTenant: { org: { id: string }; ownerUserId: string; roleId: string };
}

interface PurgeData {
  purgeDemoTenant: {
    purged: boolean;
    orgId: string | null;
    deletedDocuments: number;
    deletedUsers: number;
    detachedUsers: number;
    deletedFiles: number;
    collections: { collection: string; deleted: number }[];
  };
}

const PASSWORD = ["demo", "purge", "pass", "7"].join("-");
const DEMO_SLUG = "demo_purge";
const REAL_SLUG = "real_purge";
const DEMO_LOGO = "org-logos/0d1e2f30-4152-4637-8899-aabbccddeeff.png";
const REAL_LOGO = "org-logos/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png";
const DEMO_ATTACHMENT = "form/2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901.pdf";
const REAL_ATTACHMENT = "form/3c4d5e6f-7081-4293-a4b5-c6d7e8f90a12.pdf";
const MODULE_KEYS = ["system.org-manager", "system.user-manager"];

/** 填充用的日期:比任何 TTL 索引的到期都晚,夾具不會在測試途中被背景清理刪掉。 */
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

/** 一份文件的填充值:每個頂層欄位給不重複的值,避開各表的唯一索引(原生寫入,不經 schema 驗證)。 */
function fillerOf(schema: Schema): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const [path, type] of Object.entries(schema.paths)) {
    if (path.includes(".") || path === "_id" || path === "__v") {
      continue;
    }
    const unique = new Types.ObjectId();
    switch (type.instance) {
      case "String": {
        document[path] = `${path}-${String(unique)}`;
        break;
      }
      case "Number": {
        document[path] = Number.parseInt(String(unique).slice(-6), 16);
        break;
      }
      case "ObjectId": {
        document[path] = unique;
        break;
      }
      case "Date": {
        // 一年後:`action_tokens` / `refresh_tokens` 的 `expiresAt` 有 TTL 索引(expireAfterSeconds: 0),
        // 填「現在」會被 mongod 的 TTL 背景清理(約每 60 秒一輪)在比對筆數之間刪掉,測試因此時好時壞
        document[path] = FAR_FUTURE;
        break;
      }
      case "Boolean": {
        document[path] = false;
        break;
      }
      default: {
        break;
      }
    }
  }
  document.deletedAt = null;
  return document;
}

describe("清空示範機構 purgeDemoTenant(規格 2.2:demo --mode=purge / rebuild 的 api 端)", () => {
  let api: AuthTestApp;
  let rootToken: string;
  let storage: RecordingStorageService;
  const plan = resolveTenantPurgePlan(TENANT_PURGE);
  const schemaOf = new Map(
    TENANT_PURGE.models.map((model) => [model.collection, model.schema]),
  );

  async function login(account: string, password: string): Promise<string> {
    const result = await api.graphql<{ login: { accessToken: string } }>(
      LOGIN,
      { input: { account, password } },
    );
    if (!result.data) {
      throw new Error(`登入失敗:${JSON.stringify(result.errors)}`);
    }
    return result.data.login.accessToken;
  }

  function purge(slug: string, accessToken = rootToken) {
    return api.graphql<PurgeData>(
      PURGE_DEMO_TENANT,
      { input: { slug } },
      { accessToken },
    );
  }

  async function provision(input: {
    slug: string;
    account: string;
    logoPath: string;
    demo: boolean;
  }): Promise<ProvisionData["provisionTenant"]> {
    const result = await api.graphql<ProvisionData>(
      PROVISION_TENANT,
      {
        input: {
          name: `租戶 ${input.slug}`,
          slug: input.slug,
          adminAccount: input.account,
          adminEmail: `${input.account}@example.com`,
          logoPath: input.logoPath,
          moduleKeys: MODULE_KEYS,
          ...(input.demo ? { demo: true, adminInitialPassword: PASSWORD } : {}),
        },
      },
      { accessToken: rootToken },
    );
    if (!result.data) {
      throw new Error(`開通失敗:${JSON.stringify(result.errors)}`);
    }
    return result.data.provisionTenant;
  }

  async function countAll(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const model of TENANT_PURGE.models) {
      counts.set(
        model.collection,
        await api.connection.collection(model.collection).countDocuments({}),
      );
    }
    return counts;
  }

  /** 一個租戶的情境:組織樹、只屬於它的人、兼屬兩邊的人、角色,以及每張登記的表各一筆它的資料。 */
  interface TenantWorld {
    topId: Types.ObjectId;
    branchId: Types.ObjectId;
    ownerId: Types.ObjectId;
    memberId: Types.ObjectId;
    roleId: Types.ObjectId;
    /** collection → 這個租戶在那張表的文件 id。 */
    documents: Map<string, Types.ObjectId[]>;
    /** collection → 依賴的欄位值(`deleted` 條件用)。 */
    values: Map<string, Record<string, unknown>>;
  }

  async function seedRows(
    world: TenantWorld,
    step: TenantPurgeStep,
    purgedUserId: Types.ObjectId,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const schema = schemaOf.get(step.collection);
    if (!schema) {
      throw new Error(`沒有 ${step.collection} 的 schema`);
    }
    const variants: Record<string, unknown>[] =
      step.by === "tenantId"
        ? [{ tenantId: world.topId, orgId: world.branchId }]
        : step.anyOf.flatMap((condition) => {
            switch (condition.in) {
              case "tenantOrgs": {
                return [{ [condition.field]: world.branchId }];
              }
              case "purgedUsers": {
                return [{ [condition.field]: purgedUserId }];
              }
              case "deleted": {
                const parent = world.values.get(condition.of);
                return parent
                  ? [{ [condition.field]: parent[condition.key ?? "_id"] }]
                  : [];
              }
            }
          });
    for (const variant of variants) {
      const document = { ...fillerOf(schema), ...variant, ...extra };
      const { insertedId } = await api.connection
        .collection(step.collection)
        .insertOne(document);
      world.documents.set(step.collection, [
        ...(world.documents.get(step.collection) ?? []),
        insertedId,
      ]);
      if (!world.values.has(step.collection)) {
        world.values.set(step.collection, { ...document, _id: insertedId });
      }
    }
  }

  async function seedTenant(input: {
    slug: string;
    logoPath: string;
    demo: boolean;
    sharedUserId?: Types.ObjectId;
    attachment?: string;
  }): Promise<TenantWorld> {
    const payload = await provision({
      slug: input.slug,
      account: `${input.slug}-admin`,
      logoPath: input.logoPath,
      demo: input.demo,
    });
    const topId = new Types.ObjectId(payload.org.id);
    const branchId = await createOrg(api.connection, {
      name: `${input.slug} 分店`,
      parentId: topId,
    });
    const memberId = await createUser(api.connection, {
      account: `${input.slug}-member`,
      password: PASSWORD,
      orgIds: [branchId],
    });
    const roleId = await createRole(api.app, api.connection, {
      name: `${input.slug} 店員`,
      ownerOrgId: topId,
      moduleKeys: ["system.org-manager"],
      permissionKeys: ["system.org-manager.view"],
      assignTo: [memberId, ...(input.sharedUserId ? [input.sharedUserId] : [])],
    });
    const world: TenantWorld = {
      topId,
      branchId,
      ownerId: new Types.ObjectId(payload.ownerUserId),
      memberId,
      roleId,
      documents: new Map(),
      values: new Map(),
    };
    for (const step of plan.steps) {
      // 附件放在表單提交的上傳欄(登記的 files 欄位);其他表的同名字串不會被當成檔案
      await seedRows(
        world,
        step,
        memberId,
        step.collection === "form_submissions" && input.attachment !== undefined
          ? { values: { proof: { path: input.attachment, name: "proof.pdf" } } }
          : {},
      );
    }
    return world;
  }

  async function remaining(world: TenantWorld): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const [collection, ids] of world.documents) {
      counts.set(
        collection,
        await api.connection
          .collection(collection)
          .countDocuments({ _id: { $in: ids } }),
      );
    }
    return counts;
  }

  function countLinks(filter: Record<string, unknown>): Promise<number> {
    return api.connection
      .collection("core_relationships")
      .countDocuments(filter);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-demo-purge");
    const recording = api.app.get(StorageService);
    if (!(recording instanceof RecordingStorageService)) {
      throw new TypeError("測試環境應是記錄用的 StorageService");
    }
    storage = recording;
    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("對到沒有「示範」標記的機構:拒絕,一筆都不刪", async () => {
    await seedTenant({ slug: "real_refuse", logoPath: REAL_LOGO, demo: false });
    const before = await countAll();
    const result = await purge("real_refuse");
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect(result.errors?.[0]?.message).toMatch(/not marked as demo/);
    expect(await countAll()).toEqual(before);
  });

  it("找不到這個短碼:什麼都不做,回 purged: false", async () => {
    const before = await countAll();
    const result = await purge("no_such_demo");
    expect(result.data?.purgeDemoTenant).toMatchObject({
      purged: false,
      orgId: null,
      deletedDocuments: 0,
    });
    expect(await countAll()).toEqual(before);
  });

  it("稽核寫入失敗:整個交易回復,資料一筆都沒少、檔案沒刪", async () => {
    await seedTenant({
      slug: "demo_rollback",
      logoPath: DEMO_LOGO,
      demo: true,
      attachment: DEMO_ATTACHMENT,
    });
    const audit = api.app.get(AuditService);
    const failing = jest
      .spyOn(audit, "record")
      .mockRejectedValueOnce(new Error("稽核寫入失敗(測試注入)"));
    const before = await countAll();
    storage.deleted.length = 0;
    try {
      const result = await purge("demo_rollback");
      expect(result.errors?.[0]?.message).toMatch(/稽核寫入失敗/);
    } finally {
      failing.mockRestore();
    }
    expect(await countAll()).toEqual(before);
    expect(storage.deleted).toEqual([]);
    const cleanup = await purge("demo_rollback");
    expect(cleanup.data?.purgeDemoTenant.purged).toBe(true);
  });

  it("不是根組織的人(示範機構自己的管理員)不能清空", async () => {
    await seedTenant({ slug: "demo_self", logoPath: DEMO_LOGO, demo: true });
    const adminToken = await login("demo_self-admin", PASSWORD);
    const before = await countAll();
    const result = await purge("demo_self", adminToken);
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect(await countAll()).toEqual(before);
    // 收尾:由根組織清掉,不影響後面的情境
    const cleanup = await purge("demo_self");
    expect(cleanup.data?.purgeDemoTenant.purged).toBe(true);
  });

  it("清空:這個租戶的資料 0 筆(含只能新增的帳本)、其他租戶筆數不變、兼屬其他機構的人保留、檔案刪掉", async () => {
    // 兼屬兩個租戶的人:所屬在兩邊都建好之後才加
    const { insertedId: sharedUserId } = await api.connection
      .collection("users")
      .insertOne({
        name: "shared-person",
        account: "shared-person",
        email: "shared-person@example.com",
        enabled: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    const real = await seedTenant({
      slug: REAL_SLUG,
      logoPath: REAL_LOGO,
      demo: false,
      sharedUserId,
      attachment: REAL_ATTACHMENT,
    });
    const demo = await seedTenant({
      slug: DEMO_SLUG,
      logoPath: DEMO_LOGO,
      demo: true,
      sharedUserId,
      attachment: DEMO_ATTACHMENT,
    });
    // 兼屬兩邊:兩個租戶的分店都有他,另外是示範分店的主管
    await api.connection.collection("core_relationships").insertMany(
      [
        { type: "org_user", orgId: demo.branchId },
        { type: "org_user", orgId: real.branchId },
        { type: "org_manager", orgId: demo.branchId },
      ].map(({ type, orgId }) => ({
        type,
        firstId: orgId,
        secondId: sharedUserId,
        thirdId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      })),
    );
    const realBefore = await remaining(real);
    const tenantIdTables = plan.steps
      .filter((step) => step.by === "tenantId")
      .map((step) => step.collection);
    const otherTenantCounts = new Map<string, number>();
    for (const collection of tenantIdTables) {
      otherTenantCounts.set(
        collection,
        await api.connection
          .collection(collection)
          .countDocuments({ tenantId: { $ne: demo.topId } }),
      );
    }
    storage.deleted.length = 0;

    const result = await purge(DEMO_SLUG);
    expect(result.errors).toBeUndefined();
    const payload = result.data?.purgeDemoTenant;
    expect(payload).toMatchObject({
      purged: true,
      orgId: String(demo.topId),
      deletedUsers: 2,
      detachedUsers: 1,
    });

    // 帶這個租戶 id 的資料 0 筆;依組織 / 使用者歸屬的資料也 0 筆
    for (const collection of tenantIdTables) {
      expect([
        collection,
        await api.connection
          .collection(collection)
          .countDocuments({ tenantId: demo.topId }),
      ]).toEqual([collection, 0]);
    }
    for (const [collection, count] of await remaining(demo)) {
      expect([collection, count]).toEqual([collection, 0]);
    }
    expect(
      await api.connection
        .collection("audit_logs")
        .countDocuments({ orgId: { $in: [demo.topId, demo.branchId] } }),
    ).toBe(0);

    // 其他租戶的筆數不變
    expect(await remaining(real)).toEqual(realBefore);
    for (const collection of tenantIdTables) {
      expect([
        collection,
        await api.connection
          .collection(collection)
          .countDocuments({ tenantId: { $ne: demo.topId } }),
      ]).toEqual([collection, otherTenantCounts.get(collection)]);
    }

    // 組織樹、只屬於它的人、它的角色都硬刪;另一個租戶原封不動
    const orgs = api.connection.collection("orgs");
    expect(
      await orgs.countDocuments({ _id: { $in: [demo.topId, demo.branchId] } }),
    ).toBe(0);
    expect(
      await orgs.countDocuments({ _id: { $in: [real.topId, real.branchId] } }),
    ).toBe(2);
    const users = api.connection.collection("users");
    expect(
      await users.countDocuments({
        _id: { $in: [demo.ownerId, demo.memberId] },
      }),
    ).toBe(0);
    expect(
      await users.countDocuments({
        _id: { $in: [real.ownerId, real.memberId] },
      }),
    ).toBe(2);
    expect(
      await api.connection.collection("roles").countDocuments({
        _id: { $in: [demo.roleId, real.roleId] },
      }),
    ).toBe(1);

    // 兼屬的人還在:只少了在示範機構的所屬與角色
    expect(await users.countDocuments({ _id: sharedUserId })).toBe(1);
    expect(await countLinks({ type: "org_user", secondId: sharedUserId })).toBe(
      1,
    );
    expect(
      await countLinks({
        type: "org_user",
        firstId: real.branchId,
        secondId: sharedUserId,
      }),
    ).toBe(1);
    expect(await countLinks({ type: "user_role", firstId: sharedUserId })).toBe(
      1,
    );
    expect(
      await countLinks({
        type: "user_role",
        firstId: sharedUserId,
        secondId: real.roleId,
      }),
    ).toBe(1);
    expect(
      await countLinks({ type: "org_manager", secondId: sharedUserId }),
    ).toBe(0);
    // 核心關聯不留指向已刪文件的孤兒
    expect(
      await countLinks({
        $or: [
          { firstId: { $in: [demo.topId, demo.branchId, demo.roleId] } },
          { secondId: { $in: [demo.ownerId, demo.memberId, demo.roleId] } },
        ],
      }),
    ).toBe(0);

    // 檔案:示範機構的商標與資料裡的附件刪掉,另一個租戶的不動
    expect(
      storage.deleted.toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    ).toEqual(
      [DEMO_ATTACHMENT, DEMO_LOGO].toSorted((a, b) =>
        a.localeCompare(b, "zh-Hant"),
      ),
    );
    expect(payload?.deletedFiles).toBe(2);

    // 清空本身記一筆在根組織(不在被刪的範圍)
    expect(
      await api.connection
        .collection("audit_logs")
        .countDocuments({ action: "org.purge-demo", targetId: demo.topId }),
    ).toBe(1);
  });

  it("rebuild(清空後再建立):同一組短碼、帳號可以重新開通示範機構", async () => {
    const again = await provision({
      slug: DEMO_SLUG,
      account: `${DEMO_SLUG}-admin`,
      logoPath: DEMO_LOGO,
      demo: true,
    });
    expect(again.org.id).toBeTruthy();
    const purged = await purge(DEMO_SLUG);
    expect(purged.data?.purgeDemoTenant).toMatchObject({
      purged: true,
      orgId: again.org.id,
      deletedUsers: 1,
    });
  });
});
