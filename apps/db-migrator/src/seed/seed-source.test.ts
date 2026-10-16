import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, type Document, MongoClient, type ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { seedRegistry as definitionRegistry } from "../../test/fixtures/seeds-definition/registry";
import {
  PROJECT_AUDIT_KEY,
  PROJECT_FORM_KEY,
  PROJECT_REPORT_KEY,
} from "../../test/fixtures/seeds-project/project-source";
import { runNode } from "../../test/support/update-harness";
import type { DefinitionSeedSet } from "./seed-declaration";
import { runSeeds } from "./seed-runner";

/**
 * 兩個種子來源(底座 + 專案)對真 MongoDB 的行為:專案夾具經正式的組裝入口合成後,以 seed 指令落庫。
 * 重點是**既有保護不變**:id、根組織的現場值、模組初始值、root 帳號、授權只補不刪。
 */

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const TSX_CLI = path.join(
  PACKAGE_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const SEED_ENTRY = path.join(PACKAGE_ROOT, "src", "seed", "run.ts");

/** 測試用 root 初始帳號;密碼為測試假值。 */
const ROOT_ADMIN_ENV = {
  ROOT_ADMIN_ACCOUNT: "root-admin",
  ROOT_ADMIN_EMAIL: "root-admin@example.com",
  ROOT_ADMIN_PASSWORD: ["initial", "secret", "123"].join("-"),
};

let memoryServer: MongoMemoryReplSet | undefined;
let baseUri: string;
const usedDatabaseUris: string[] = [];

function createTestDatabaseUri(suffix: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/db-migrator-seed-source-${String(process.pid)}-${suffix}`;
  usedDatabaseUris.push(uri.toString());
  return uri.toString();
}

function fixtureRegistryPath(fixtureName: string): string {
  return path.join(
    PACKAGE_ROOT,
    "test",
    "fixtures",
    fixtureName,
    "registry.ts",
  );
}

/**
 * 以子行程執行 seed 指令;不給夾具 = 只有底座的環境(空專案來源的夾具 `seeds-base`)。
 * 不用正式的 `seeds/registry.ts`:引用專案在那裡登記的內容不是「加入專案來源之前」的狀態。
 */
function runSeedCommand(
  databaseUri: string,
  fixtureName = "seeds-base",
  env: Record<string, string> = {},
) {
  const args = [TSX_CLI, SEED_ENTRY, fixtureRegistryPath(fixtureName)];
  return runNode(args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      ...ROOT_ADMIN_ENV,
      MONGODB_URI: databaseUri,
      ...env,
    },
  });
}

async function withDatabase<T>(
  databaseUri: string,
  work: (database: Db) => Promise<T>,
): Promise<T> {
  const client = await MongoClient.connect(databaseUri);
  try {
    return await work(client.db());
  } finally {
    await client.close();
  }
}

type Keyed = Document & { _id: ObjectId; key?: string };

interface Snapshot {
  byCollection: Record<string, Keyed[]>;
  relationships: Document[];
  users: Document[];
}

const SEEDED_COLLECTIONS = [
  "orgs",
  "roles",
  "field_categories",
  "fields",
  "modules",
  "permissions",
  "data_scope_targets",
  "demo_items_one",
  "demo_items_two",
  "project_report_types",
];

async function snapshotOf(databaseUri: string): Promise<Snapshot> {
  return withDatabase(databaseUri, async (database) => {
    const byCollection: Record<string, Keyed[]> = {};
    for (const name of SEEDED_COLLECTIONS) {
      byCollection[name] = await database
        .collection<Keyed>(name)
        .find()
        .sort({ _id: 1 })
        .toArray();
    }
    return {
      byCollection,
      relationships: await database
        .collection("core_relationships")
        .find()
        .sort({ _id: 1 })
        .toArray(),
      users: await database.collection("users").find().toArray(),
    };
  });
}

function documentsOf(snapshot: Snapshot, collection: string): Keyed[] {
  return snapshot.byCollection[collection] ?? [];
}

function byKey(snapshot: Snapshot, collection: string, key: string): Keyed {
  const found = documentsOf(snapshot, collection).find(
    (document) => document.key === key,
  );
  if (found === undefined) {
    throw new Error(`找不到 ${collection}.${key}`);
  }
  return found;
}

function idOf(snapshot: Snapshot, collection: string, key: string): string {
  return byKey(snapshot, collection, key)._id.toHexString();
}

const hex = (id: unknown): string => (id as ObjectId).toHexString();

/** 某個角色經 `type` 綁到的另一端文件的 key。 */
function boundKeys(
  snapshot: Snapshot,
  type: string,
  roleKey: string,
  collection: string,
): string[] {
  const roleId = idOf(snapshot, "roles", roleKey);
  const keys = new Map(
    documentsOf(snapshot, collection).map((document) => [
      document._id.toHexString(),
      document.key,
    ]),
  );
  return snapshot.relationships
    .filter((link) => link.type === type && hex(link.firstId) === roleId)
    .map((link) => keys.get(hex(link.secondId)) ?? "(不在種子裡)");
}

/** 每個種子文件的 `collection.key → _id`,比對「id 沒有變」用。 */
function idsOf(snapshot: Snapshot): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snapshot.byCollection).flatMap(([collection, documents]) =>
      documents.map((document) => [
        `${collection}.${String(document.key ?? document.moduleKey)}`,
        document._id.toHexString(),
      ]),
    ),
  );
}

async function collectionNames(databaseUri: string): Promise<string[]> {
  return withDatabase(databaseUri, async (database) => {
    const collections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();
    return collections.map(({ name }) => name);
  });
}

beforeAll(async () => {
  if (process.env.MONGODB_URI) {
    baseUri = process.env.MONGODB_URI;
  } else {
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    baseUri = memoryServer.getUri();
  }
}, 600_000);

afterAll(async () => {
  for (const databaseUri of usedDatabaseUris) {
    await withDatabase(databaseUri, async (database) => {
      await database.dropDatabase();
    });
  }
  await memoryServer?.stop();
}, 60_000);

describe("底座 + 非空的專案來源(對真 MongoDB)", () => {
  it("空庫:專案初值、掛在底座父節點下的專案模組、納入專案模組的模板、引用底座的專案種子一次到位;重跑全部未變", async () => {
    const databaseUri = createTestDatabaseUri("fresh");

    const firstRun = await runSeedCommand(databaseUri, "seeds-project");
    expect(firstRun.stderr).toBe("");
    expect(firstRun.status).toBe(0);
    expect(firstRun.stdout).toMatch(
      /新增 \d+ \/ 更新 0 \/ 認養 0 \/ 未變 0\n$/,
    );

    const seeded = await snapshotOf(databaseUri);

    // 根組織:結構由底座決定,名稱 / 說明(null)/ settings 用專案初值
    expect(byKey(seeded, "orgs", "root")).toMatchObject({
      name: "專案甲營運中心",
      description: null,
      settings: { timezone: "Asia/Taipei" },
      parentId: null,
      ancestors: [],
      enabled: true,
      isSystem: true,
    });

    // 專案模組掛在底座父節點底下:parentId / ancestors 解析成這個環境的 id
    const report = byKey(seeded, "modules", PROJECT_REPORT_KEY);
    expect(hex(report.parentId)).toBe(idOf(seeded, "modules", "demo"));
    expect((report.ancestors as ObjectId[]).map((id) => hex(id))).toEqual([
      idOf(seeded, "modules", "demo"),
    ]);
    expect(report).toMatchObject({
      icon: "chart",
      settings: { defaultRange: "month" },
      enabled: true,
      isSystem: true,
    });
    const auditOps = byKey(seeded, "modules", `${PROJECT_AUDIT_KEY}.ops`);
    expect((auditOps.ancestors as ObjectId[]).map((id) => hex(id))).toEqual([
      idOf(seeded, "modules", "system"),
      idOf(seeded, "modules", PROJECT_AUDIT_KEY),
    ]);
    expect(documentsOf(seeded, "modules")).toHaveLength(39 + 8);
    expect(documentsOf(seeded, "permissions")).toHaveLength(117 + 8 + 7);
    expect(documentsOf(seeded, "data_scope_targets")).toHaveLength(4 + 2);

    // 專案對底座模組的初值指定:首次建立時生效
    expect(byKey(seeded, "modules", "demo.sample-two")).toMatchObject({
      enabled: false,
      icon: "star",
    });
    expect(byKey(seeded, "modules", "overview").icon).toBeNull();
    expect(byKey(seeded, "modules", "demo-form").settings).toEqual({
      list: { columns: [], builtin: { status: false } },
    });
    // 專案模組自己宣告的 settings 初值(表單模組 helper 的 `settings`)
    expect(byKey(seeded, "modules", PROJECT_FORM_KEY)).toMatchObject({
      engine: "form",
      settings: { list: { builtin: { status: true } } },
    });

    // 模板:納入專案的一般模組與 wildcard,扣除根組織專屬(含靠父節點繼承的)
    const templateModules = boundKeys(
      seeded,
      "role_module",
      "tenant-admin",
      "modules",
    );
    const templatePermissions = boundKeys(
      seeded,
      "role_permission",
      "tenant-admin",
      "permissions",
    );
    expect(templateModules).toHaveLength(35 + 6);
    expect(templatePermissions).toHaveLength(35 + 6);
    expect(templateModules).toEqual(
      expect.arrayContaining([
        PROJECT_REPORT_KEY,
        `${PROJECT_REPORT_KEY}.view-page`,
        PROJECT_FORM_KEY,
      ]),
    );
    expect(templatePermissions).toContain(`${PROJECT_REPORT_KEY}.*`);
    expect(templatePermissions).not.toContain(`${PROJECT_REPORT_KEY}.export`);
    for (const key of [PROJECT_AUDIT_KEY, `${PROJECT_AUDIT_KEY}.ops`]) {
      expect(templateModules).not.toContain(key);
      expect(templatePermissions).not.toContain(`${key}.*`);
    }
    // 專案自己的角色綁定照宣告落庫;與底座相同的那筆 org_role 沒有重複
    expect(
      boundKeys(seeded, "role_module", "project-auditor", "modules"),
    ).toEqual([PROJECT_AUDIT_KEY]);
    expect(
      seeded.relationships.filter((link) => link.type === "org_role"),
    ).toHaveLength(3);

    // 專案普通種子:引用底座的種子、同一個 set 裡後宣告的被引用者也解析得到
    const parent = byKey(seeded, "project_report_types", "parent");
    const child = byKey(seeded, "project_report_types", "child");
    expect(hex(child.parentId)).toBe(parent._id.toHexString());
    expect(hex(child.orgId)).toBe(idOf(seeded, "orgs", "root"));
    expect(hex(parent.categoryId)).toBe(
      idOf(seeded, "field_categories", "gender"),
    );
    expect((parent.relatedIds as ObjectId[]).map((id) => hex(id))).toEqual([
      idOf(seeded, "orgs", "root"),
      idOf(seeded, "roles", "tenant-admin"),
    ]);
    expect(byKey(seeded, "fields", "demo-category.dessert")).toMatchObject({
      label: "甜點",
      orgId: null,
      isSystem: true,
    });

    const secondRun = await runSeedCommand(databaseUri, "seeds-project");
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toMatch(
      /seed 完成:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*\n$/,
    );
    expect(await snapshotOf(databaseUri)).toEqual(seeded);
  }, 180_000);

  it("既有環境加入專案來源:底座文件的 id 不變,根組織現場值(含清成 null 的說明)、模組初始值與 root 帳號都保留;專案初值不覆蓋已存在的值", async () => {
    const databaseUri = createTestDatabaseUri("upgrade");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const manualGrant = await withDatabase(databaseUri, async (database) => {
      await database
        .collection("orgs")
        .updateOne(
          { key: "root" },
          { $set: { name: "現場改過的名稱", description: null } },
        );
      await database
        .collection("modules")
        .updateOne({ key: "demo.sample-two" }, { $set: { icon: "home" } });
      await database
        .collection("modules")
        .updateOne({ key: "overview" }, { $set: { enabled: false } });
      await database
        .collection("modules")
        .updateOne(
          { key: "demo-form" },
          { $set: { "settings.list": { columns: ["現場配置"] } } },
        );
      // 人在角色管理另外給模板的一筆個別權限(seed 沒宣告、也不該撤)
      const role = await database
        .collection("roles")
        .findOne({ key: "tenant-admin" });
      const permission = await database
        .collection("permissions")
        .findOne({ key: "system.user-manager.view" });
      const link = {
        type: "role_permission",
        firstId: role?._id,
        secondId: permission?._id,
        thirdId: null,
      };
      await database.collection("core_relationships").insertOne({ ...link });
      return link;
    });
    const before = await snapshotOf(databaseUri);

    // 部署帶進專案來源;root 密碼的環境變數同時換了
    const withProject = await runSeedCommand(databaseUri, "seeds-project", {
      ROOT_ADMIN_PASSWORD: ["changed", "secret", "456"].join("-"),
    });
    expect(withProject.stderr).toBe("");
    expect(withProject.status).toBe(0);
    const after = await snapshotOf(databaseUri);

    // 既有種子文件一筆不少、id 都沒變
    expect(idsOf(after)).toMatchObject(idsOf(before));
    // 根組織:名稱與清成 null 的說明保留;settings 欄位已存在,專案的初值不補進去
    expect(byKey(after, "orgs", "root")).toEqual(byKey(before, "orgs", "root"));
    expect(byKey(after, "orgs", "root")).toMatchObject({
      name: "現場改過的名稱",
      description: null,
      settings: {},
    });
    // 模組初始值:人改過的保留;專案的 moduleInitialValues 不覆蓋已存在的值
    expect(byKey(after, "modules", "demo.sample-two")).toMatchObject({
      enabled: true,
      icon: "home",
    });
    expect(byKey(after, "modules", "overview")).toMatchObject({
      enabled: false,
      icon: "dashboard",
    });
    expect(byKey(after, "modules", "demo-form").settings).toEqual({
      list: { columns: ["現場配置"] },
    });
    // root 帳號存在就完全不動(密碼沒有被重設)
    expect(after.users).toEqual(before.users);
    // 授權只補不刪:原有關聯全部還在(含人工那一筆),只多出專案帶來的
    expect(after.relationships).toEqual(
      expect.arrayContaining(before.relationships),
    );
    expect(after.relationships).toContainEqual(
      expect.objectContaining(manualGrant),
    );
    expect(
      boundKeys(after, "role_module", "tenant-admin", "modules"),
    ).toHaveLength(35 + 6);
    // 專案新增的模組照宣告建立
    expect(byKey(after, "modules", PROJECT_REPORT_KEY)).toMatchObject({
      enabled: true,
      icon: "chart",
    });

    // 之後某一版把專案模組從來源拿掉:seed 不撤銷既有授權、不刪文件
    const withdrawn = await runSeedCommand(databaseUri);
    expect(withdrawn.stderr).toBe("");
    expect(withdrawn.status).toBe(0);
    expect(withdrawn.stdout).toMatch(/seed 完成:新增 0 \/ 更新 0 \/ 認養 0 \//);
    const afterWithdrawn = await snapshotOf(databaseUri);
    expect(afterWithdrawn.relationships).toEqual(after.relationships);
    expect(idsOf(afterWithdrawn)).toEqual(idsOf(after));
  }, 240_000);

  it("專案重宣告底座的種子:組裝時拒絕,指令非零結束,資料庫沒有任何寫入", async () => {
    const databaseUri = createTestDatabaseUri("collision");

    const result = await runSeedCommand(databaseUri, "seeds-collision");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("orgs.root 重複宣告(base 與 project)");
    expect(result.stdout).toBe("");
    expect(await collectionNames(databaseUri)).toEqual([]);
  }, 120_000);
});

describe("版本化定義宣告(低階的 runSeeds;seed 指令經 api 發布的行為見 update 的測試)", () => {
  it("沒有接上處理器的入口遇到登記了定義的 registry:明確失敗並列出是哪幾份,不寫入任何資料(普通種子也不寫)", async () => {
    const databaseUri = createTestDatabaseUri("definition-unhandled");

    await withDatabase(databaseUri, async (database) => {
      const run = runSeeds(database, definitionRegistry, {
        env: { ...ROOT_ADMIN_ENV },
      });
      await expect(run).rejects.toThrow("登記了 2 份版本化定義");
      await expect(run).rejects.toThrow("form-definition:project_request@r1");
      await expect(run).rejects.toThrow(
        "workflow-definition:project_review@r1",
      );
    });
    expect(await collectionNames(databaseUri)).toEqual([]);
  }, 120_000);

  it("接上處理器時:普通種子先落庫,處理器再收到依引用排好的定義;定義相關的 collection 仍沒有任何 raw 文件", async () => {
    const databaseUri = createTestDatabaseUri("definition-handled");

    await withDatabase(databaseUri, async (database) => {
      const received: DefinitionSeedSet[] = [];
      let modulesAtHandler = 0;
      const results = await runSeeds(database, definitionRegistry, {
        env: { ...ROOT_ADMIN_ENV },
        definitionHandler: async (seeds) => {
          received.push(...seeds);
          modulesAtHandler = await database
            .collection("modules")
            .countDocuments({ key: PROJECT_FORM_KEY });
          return seeds.map((seed) => ({
            label: `${seed.kind}:${seed.key}`,
            counts: { created: 1, updated: 0, adopted: 0, unchanged: 0 },
          }));
        },
      });

      expect(received.map((seed) => `${seed.kind}:${seed.key}`)).toEqual([
        "form-definition:project_request",
        "workflow-definition:project_review",
      ]);
      // 處理器被呼叫時,定義依賴的表單模組已經種好
      expect(modulesAtHandler).toBe(1);
      expect(results.slice(-2).map((result) => result.label)).toEqual([
        "form-definition:project_request",
        "workflow-definition:project_review",
      ]);
      const names = await database
        .listCollections({}, { nameOnly: true })
        .toArray();
      for (const collection of [
        "forms",
        "form_versions",
        "workflows",
        "workflow_versions",
      ]) {
        expect(names.map(({ name }) => name)).not.toContain(collection);
      }
    });
  }, 120_000);
});
