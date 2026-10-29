import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { verify as verifyArgon2 } from "@node-rs/argon2";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { baseOnlyProjectSettings } from "../../test/fixtures/seeds-base/project-source";
import { runNode } from "../../test/support/update-harness";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const TSX_CLI = path.join(
  PACKAGE_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const SEED_ENTRY = path.join(PACKAGE_ROOT, "src", "seed", "run.ts");

/** 測試用 root 初始帳號(正式環境自 Secret Manager 注入,ADR-0002);密碼為測試假值。 */
const ROOT_ADMIN_ENV = {
  ROOT_ADMIN_ACCOUNT: "root-admin",
  ROOT_ADMIN_EMAIL: "root-admin@example.com",
  ROOT_ADMIN_PASSWORD: ["initial", "secret", "123"].join("-"),
};

/** 沿用 jest globalSetup 起的單一成員 replica set(MONGODB_URI);沒有時自起 MongoMemoryReplSet。 */
let memoryServer: MongoMemoryReplSet | undefined;
let baseUri: string;

function buildDatabaseUri(databaseName: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/${databaseName}`;
  return uri.toString();
}

/** 種子文件的觀察欄位(僅測試斷言用,不是 schema 正本)。 */
interface SeededDocument {
  key?: string;
  name?: string;
  isSystem?: boolean;
  enabled?: boolean;
  [field: string]: unknown;
}

interface AccountDocument {
  account?: string;
  email?: string;
  name?: string;
  passwordHash?: string;
  enabled?: boolean;
  [field: string]: unknown;
}

interface RelationshipDocument {
  type?: string;
  firstId?: ObjectId;
  secondId?: ObjectId;
  [field: string]: unknown;
}

interface RunSeedOptions {
  env?: Record<string, string | undefined>;
  registryPath?: string;
}

/**
 * 以子行程執行 seed 指令(等同 `pnpm --filter db-migrator seed <registry 檔>`)。
 * 預設用**空專案來源的夾具 registry**(`test/fixtures/seeds-base/`):這個檔驗的是底座種子的落庫結果與固定數量,
 * 不能隨引用專案在 `seeds/project/` 的登記變動。正式 registry 對真 MongoDB 的檢查在 `seed-formal-registry.test.ts`。
 */
function runSeedCommand(databaseUri: string, options: RunSeedOptions = {}) {
  const args = [
    TSX_CLI,
    SEED_ENTRY,
    options.registryPath ?? fixtureRegistryPath("seeds-base"),
  ];
  return runNode(args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      ...ROOT_ADMIN_ENV,
      MONGODB_URI: databaseUri,
      ...options.env,
    },
  });
}

async function withDatabase<T>(
  databaseUri: string,
  work: (database: ReturnType<MongoClient["db"]>) => Promise<T>,
): Promise<T> {
  const client = await MongoClient.connect(databaseUri);
  try {
    return await work(client.db());
  } finally {
    await client.close();
  }
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

/** 欄位選項的觀察欄位(正本:docs/modules/field-manager.md「種子內容」)。 */
interface FieldDocument {
  key?: string;
  categoryId?: ObjectId;
  orgId?: ObjectId | null;
  value?: string;
  label?: string;
  order?: number;
  enabled?: boolean;
  isSystem?: boolean;
  [field: string]: unknown;
}

/** 示範資料的觀察欄位(正本:apps/db-migrator/seeds/base/demo-items.ts)。 */
interface DemoItemDocument {
  key?: string;
  orgId?: ObjectId;
  name?: string;
  category?: string;
  status?: string;
  enabled?: boolean;
  createdBy?: ObjectId;
  isSystem?: boolean;
  [field: string]: unknown;
}

/** 讀出全部種子文件(含 _id 與時間戳),供前後比對。 */
async function readSeededDocuments(databaseUri: string) {
  return withDatabase(databaseUri, async (database) => ({
    orgs: await database.collection<SeededDocument>("orgs").find().toArray(),
    roles: await database
      .collection<SeededDocument>("roles")
      .find()
      .sort({ key: 1 })
      .toArray(),
    fieldCategories: await database
      .collection<SeededDocument>("field_categories")
      .find()
      .sort({ key: 1 })
      .toArray(),
    fields: await database
      .collection<FieldDocument>("fields")
      .find()
      .sort({ key: 1 })
      .toArray(),
    modules: await database
      .collection<ModuleDocument>("modules")
      .find()
      .sort({ key: 1 })
      .toArray(),
    permissions: await database
      .collection<PermissionDocument>("permissions")
      .find()
      .sort({ key: 1 })
      .toArray(),
    dataScopeTargets: await database
      .collection<SeededDocument>("data_scope_targets")
      .find()
      .sort({ collection: 1 })
      .toArray(),
    relationships: await database
      .collection<RelationshipDocument>("core_relationships")
      .find()
      .sort({ type: 1, firstId: 1, secondId: 1 })
      .toArray(),
  }));
}

const hex = (ids: ObjectId[] | undefined): string[] | undefined =>
  ids?.map((id) => id.toHexString());

/** 以 _id 反查種子文件的 key(核心關聯的兩端只存 id)。 */
const keyOf =
  (documents: { key?: string; _id: ObjectId }[]) =>
  (id: ObjectId | undefined): string | undefined =>
    documents.find((document) => id !== undefined && document._id.equals(id))
      ?.key;

/** 模組節點的觀察欄位(正本:docs/modules/*.md 模組樹;欄位形狀:module.schema.ts)。 */
interface ModuleDocument {
  key?: string;
  name?: string;
  parentId?: ObjectId | null;
  ancestors?: ObjectId[];
  route?: string;
  sidebarType?: string;
  order?: number;
  enabled?: boolean;
  isSystem?: boolean;
  [field: string]: unknown;
}

/** 權限的觀察欄位(正本:docs/modules/demo*.md 權限表;欄位形狀:permission.schema.ts)。 */
interface PermissionDocument {
  key?: string;
  name?: string;
  moduleId?: ObjectId;
  enabled?: boolean;
  isSystem?: boolean;
  [field: string]: unknown;
}

/** 帳號相關最終狀態:使用者、根組織、超級管理員角色、核心關聯。 */
async function readAccountState(databaseUri: string) {
  return withDatabase(databaseUri, async (database) => ({
    users: await database.collection<AccountDocument>("users").find().toArray(),
    rootOrg: await database
      .collection<SeededDocument>("orgs")
      .findOne({ key: "root" }),
    superAdminRole: await database
      .collection<SeededDocument>("roles")
      .findOne({ key: "super-admin" }),
    relationships: await database
      .collection<RelationshipDocument>("core_relationships")
      .find()
      .sort({ type: 1 })
      .toArray(),
  }));
}

const usedDatabaseUris: string[] = [];

function createTestDatabaseUri(suffix: string): string {
  const databaseUri = buildDatabaseUri(
    `db-migrator-seed-test-${String(process.pid)}-${suffix}`,
  );
  usedDatabaseUris.push(databaseUri);
  return databaseUri;
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

describe("seed 指令(對真 MongoDB)", () => {
  it("空資料庫執行後具備根組織與兩個種子角色(isSystem=true),並輸出摘要", async () => {
    const databaseUri = createTestDatabaseUri("fresh");

    const result = await runSeedCommand(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const { orgs, roles } = await readSeededDocuments(databaseUri);

    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      key: "root",
      name: baseOnlyProjectSettings.rootOrg.name,
      parentId: null,
      ancestors: [],
      isSystem: true,
      enabled: true,
    });

    expect(roles.map((role) => role.key)).toEqual([
      "super-admin",
      "tenant-admin",
    ]);
    for (const role of roles) {
      expect(role).toMatchObject({ isSystem: true, enabled: true });
      expect(typeof role.name).toBe("string");
    }

    // 摘要:新增 N / 更新 M / 認養 A / 未變 K(根組織 1 + 種子角色 2 至少 3 筆新增)
    expect(result.stdout).toMatch(/新增 \d+ \/ 更新 0 \/ 認養 0 \/ 未變 0/);
  }, 120_000);

  it.each(["由後台修改的描述", "", null])(
    "根組織名稱與描述由後台修改後重跑 seed 保留修改(description=%p)",
    async (description) => {
      const databaseUri = createTestDatabaseUri("org-profile");
      expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
      const profile = { name: "專案營運組織", description };
      await withDatabase(databaseUri, (database) =>
        database
          .collection("orgs")
          .updateOne({ key: "root" }, { $set: profile }),
      );
      const before = await readSeededDocuments(databaseUri);

      const result = await runSeedCommand(databaseUri);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const after = await readSeededDocuments(databaseUri);
      expect(after.orgs[0]).toMatchObject(profile);
      expect(after.orgs).toEqual(before.orgs);
    },
    120_000,
  );

  it("根組織名稱與描述欄位不存在時補上 seed 初值", async () => {
    const databaseUri = createTestDatabaseUri("org-profile-missing");
    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    await withDatabase(databaseUri, (database) =>
      database
        .collection("orgs")
        .updateOne({ key: "root" }, { $unset: { name: "", description: "" } }),
    );

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const { orgs } = await readSeededDocuments(databaseUri);
    expect(orgs[0]).toMatchObject({
      name: baseOnlyProjectSettings.rootOrg.name,
      description: baseOnlyProjectSettings.rootOrg.description,
    });
  }, 120_000);

  it("種子角色的擁有組織為根組織(org_role),重跑不重複建立", async () => {
    const databaseUri = createTestDatabaseUri("org-role");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });

    const { orgRoles, rootOrg, roles } = await withDatabase(
      databaseUri,
      async (database) => ({
        orgRoles: await database
          .collection<RelationshipDocument>("core_relationships")
          .find({ type: "org_role" })
          .toArray(),
        rootOrg: await database
          .collection<SeededDocument>("orgs")
          .findOne({ key: "root" }),
        roles: await database
          .collection<SeededDocument>("roles")
          .find()
          .toArray(),
      }),
    );

    expect(orgRoles).toHaveLength(2);
    expect(
      new Set(orgRoles.map((link) => link.secondId?.toHexString())),
    ).toEqual(new Set(roles.map((role) => role._id.toHexString())));
    for (const link of orgRoles) {
      expect(link.firstId?.toHexString()).toBe(rootOrg?._id.toHexString());
    }
  }, 120_000);

  it("重跑第二次 0 新增 0 更新(冪等),既有文件的 id 與時間戳不動", async () => {
    const databaseUri = createTestDatabaseUri("rerun");

    const firstRun = await runSeedCommand(databaseUri);
    expect(firstRun.status).toBe(0);
    const firstSnapshot = await readSeededDocuments(databaseUri);

    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toMatch(
      /新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/,
    );

    const secondSnapshot = await readSeededDocuments(databaseUri);
    expect(secondSnapshot).toEqual(firstSnapshot);
  }, 120_000);

  it("修改宣告檔後重跑:變更同步到資料庫、計數正確(以夾具 registry 驗證)", async () => {
    const databaseUri = createTestDatabaseUri("declaration-change");

    const firstRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-v1"),
    });
    expect(firstRun.stderr).toBe("");
    expect(firstRun.status).toBe(0);
    expect(firstRun.stdout).toContain("新增 2 / 更新 0 / 認養 0 / 未變 0");

    const secondRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-v2"),
    });
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain("新增 1 / 更新 1 / 認養 0 / 未變 1");

    const items = await withDatabase(databaseUri, (database) =>
      database
        .collection<SeededDocument>("seed_fixture_items")
        .find()
        .sort({ key: 1 })
        .toArray(),
    );
    expect(items.map((item) => [item.key, item.name])).toEqual([
      ["alpha", "Alpha 2"],
      ["beta", "Beta"],
      ["gamma", "Gamma"],
    ]);
    for (const item of items) {
      expect(item.isSystem).toBe(true);
    }
  }, 120_000);
});

describe("欄位類別與全域選項種子(docs/modules/field-manager.md「種子內容」)", () => {
  it("空資料庫執行後具備四個全域類別與十四個全域選項(orgId=null、isSystem=true),選項以 categoryId 指向所屬類別", async () => {
    const databaseUri = createTestDatabaseUri("fields");

    const result = await runSeedCommand(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const { fieldCategories, fields } = await readSeededDocuments(databaseUri);

    expect(
      fieldCategories.map((category) => [category.key, category.name]),
    ).toEqual([
      ["demo-category", "示範分類"],
      ["gender", "性別"],
      ["reprint-reason", "補印原因"],
      ["void-reason", "作廢原因"],
    ]);
    for (const category of fieldCategories) {
      expect(category.isSystem).toBe(true);
    }

    const categoryIdOf = (key: string): string | undefined =>
      fieldCategories
        .find((category) => category.key === key)
        ?._id.toHexString();

    // 正本表格:類別 key → [value, label, order]
    const expectedOptions: Record<string, [string, string, number][]> = {
      gender: [
        ["male", "男", 1],
        ["female", "女", 2],
        ["other", "其他", 3],
        ["undisclosed", "不透露", 4],
      ],
      "demo-category": [
        ["staple", "主食", 1],
        ["side-dish", "小菜", 2],
        ["drink", "飲品", 3],
      ],
      "reprint-reason": [
        ["lost", "遺失", 1],
        ["damaged", "破損", 2],
        ["other", "其他", 3],
      ],
      "void-reason": [
        ["input-error", "輸入錯誤", 1],
        ["duplicate", "重複建立", 2],
        ["transaction-cancelled", "交易取消", 3],
        ["other", "其他", 4],
      ],
    };

    expect(fields).toHaveLength(14);
    for (const [categoryKey, options] of Object.entries(expectedOptions)) {
      const seeded = fields.filter(
        (field) =>
          field.categoryId?.toHexString() === categoryIdOf(categoryKey),
      );
      expect(seeded).toHaveLength(options.length);
      for (const [value, label, order] of options) {
        expect(seeded).toContainEqual(
          expect.objectContaining({ value, label, order }),
        );
      }
    }
    for (const field of fields) {
      expect(field).toMatchObject({
        orgId: null,
        isSystem: true,
        enabled: true,
      });
    }

    // 「甜點」是租戶自訂選項的示意,不是種子
    expect(fields.map((field) => field.label)).not.toContain("甜點");
  }, 120_000);
});

describe("seed 以 key 認養 root 在畫面建的類別與選項(ADR-0002)", () => {
  it("同 key 的畫面類別被認養:_id 不變、isSystem 改 true、名稱 / 說明以 seed 為準;根組織加的同 value 選項一併認養,其他選項與未宣告的類別不碰;摘要四種計數", async () => {
    const databaseUri = createTestDatabaseUri("adopt");
    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });

    // root 在畫面建的形狀(api 的 createFieldCategory / createField):isSystem false、選項 orgId = 根組織、沒有種子 key
    const planted = await withDatabase(databaseUri, async (database) => {
      const now = new Date();
      const rootOrg = await database
        .collection<SeededDocument>("orgs")
        .findOne({ key: "root" });
      const tenantOrgId = new ObjectId();
      const categories = database.collection("field_categories");
      const cuisine = await categories.insertOne({
        key: "cuisine",
        name: "料理(畫面建)",
        description: "root 寫的說明",
        enabled: true,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      });
      const untouched = await categories.insertOne({
        key: "flavor",
        name: "口味(畫面建)",
        enabled: false,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      });
      const option = (orgId: ObjectId | undefined, value: string) => ({
        categoryId: cuisine.insertedId,
        orgId,
        value,
        label: `${value}(畫面建)`,
        order: 9,
        enabled: false,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      });
      const fieldsCollection = database.collection("fields");
      const rootSpicy = await fieldsCollection.insertOne(
        option(rootOrg?._id, "spicy"),
      );
      const rootMild = await fieldsCollection.insertOne(
        option(rootOrg?._id, "mild"),
      );
      const tenantSpicy = await fieldsCollection.insertOne(
        option(tenantOrgId, "spicy"),
      );
      return {
        cuisineId: cuisine.insertedId,
        flavorId: untouched.insertedId,
        rootSpicyId: rootSpicy.insertedId,
        rootMildId: rootMild.insertedId,
        tenantSpicyId: tenantSpicy.insertedId,
      };
    });

    const adoptRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-adopt"),
    });
    expect(adoptRun.stderr).toBe("");
    expect(adoptRun.status).toBe(0);
    // 類別:demo-category 補說明 = 更新、cuisine = 認養、gender、reprint-reason 與 void-reason = 未變
    expect(adoptRun.stdout).toContain(
      "field_categories:新增 0 / 更新 1 / 認養 1 / 未變 3",
    );
    // 選項:cuisine.sweet = 新增、根組織的 spicy = 認養、十四個種子選項未變
    expect(adoptRun.stdout).toContain(
      "fields:新增 1 / 更新 0 / 認養 1 / 未變 14",
    );

    const after = await withDatabase(databaseUri, async (database) => {
      const categories =
        database.collection<SeededDocument>("field_categories");
      const fieldsCollection = database.collection<FieldDocument>("fields");
      return {
        cuisine: await categories.findOne({ key: "cuisine" }),
        flavor: await categories.findOne({ _id: planted.flavorId }),
        rootSpicy: await fieldsCollection.findOne({ _id: planted.rootSpicyId }),
        rootMild: await fieldsCollection.findOne({ _id: planted.rootMildId }),
        tenantSpicy: await fieldsCollection.findOne({
          _id: planted.tenantSpicyId,
        }),
        sweet: await fieldsCollection.findOne({ key: "cuisine.sweet" }),
      };
    });

    expect(after.cuisine?._id.equals(planted.cuisineId)).toBe(true);
    expect(after.cuisine).toMatchObject({
      name: "料理類型",
      description: null,
      isSystem: true,
      enabled: true,
    });
    // 認養的選項:_id 不變(引用照舊)、轉成全域種子;enabled 是初始 seed 值的欄位,保留人設的值
    expect(after.rootSpicy).toMatchObject({
      key: "cuisine.spicy",
      orgId: null,
      label: "辣味",
      order: 1,
      isSystem: true,
      enabled: false,
    });
    expect(after.rootSpicy?.categoryId?.equals(planted.cuisineId)).toBe(true);
    expect(after.sweet?.categoryId?.equals(planted.cuisineId)).toBe(true);
    // 根組織加的其他選項、租戶的同 value 選項、沒宣告的畫面類別:原封不動
    expect(after.rootMild).toMatchObject({
      isSystem: false,
      label: "mild(畫面建)",
    });
    expect(after.rootMild).not.toHaveProperty("key");
    expect(after.tenantSpicy).toMatchObject({
      isSystem: false,
      label: "spicy(畫面建)",
    });
    expect(after.tenantSpicy).not.toHaveProperty("key");
    expect(after.flavor).toMatchObject({
      key: "flavor",
      name: "口味(畫面建)",
      enabled: false,
      isSystem: false,
    });

    // 認養單向、只發生一次:重跑全部未變
    const rerun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-adopt"),
    });
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain(
      "field_categories:新增 0 / 更新 0 / 認養 0 / 未變 5",
    );
    expect(rerun.stdout).toContain("fields:新增 0 / 更新 0 / 認養 0 / 未變 16");
  }, 120_000);
});

describe("種子文件之間的引用(seedRef → 該環境的 _id)", () => {
  it("引用改指向另一筆種子後重跑:同步為新目標的 _id、計為 1 筆更新(以夾具 registry 驗證)", async () => {
    const databaseUri = createTestDatabaseUri("ref-change");

    const firstRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-ref-v1"),
    });
    expect(firstRun.stderr).toBe("");
    expect(firstRun.status).toBe(0);
    expect(firstRun.stdout).toContain("新增 3 / 更新 0 / 認養 0 / 未變 0");

    const secondRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-ref-v2"),
    });
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain("新增 0 / 更新 1 / 認養 0 / 未變 2");

    const { groupB, member } = await withDatabase(
      databaseUri,
      async (database) => ({
        groupB: await database
          .collection<SeededDocument>("seed_fixture_groups")
          .findOne({ key: "b" }),
        member: await database
          .collection<{ groupId?: ObjectId; [field: string]: unknown }>(
            "seed_fixture_members",
          )
          .findOne({ key: "m" }),
      }),
    );
    expect(member?.groupId?.toHexString()).toBe(groupB?._id.toHexString());
  }, 120_000);

  it("引用到不存在的種子文件時以非零結束並指出缺哪一筆", async () => {
    const databaseUri = createTestDatabaseUri("ref-missing");

    const result = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-ref-missing"),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("seed_fixture_groups.nowhere");
  }, 120_000);
});

describe("root 初始超級管理員帳號(ADR-0002)", () => {
  it("帳號不存在時建立:密碼 argon2id 雜湊、加入根組織(org_user)、綁定超級管理員(user_role)", async () => {
    const databaseUri = createTestDatabaseUri("root-admin");

    const result = await runSeedCommand(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const { users, rootOrg, superAdminRole, relationships } =
      await readAccountState(databaseUri);

    expect(users).toHaveLength(1);
    const rootAdmin = users[0];
    expect(rootAdmin).toMatchObject({
      account: ROOT_ADMIN_ENV.ROOT_ADMIN_ACCOUNT,
      email: ROOT_ADMIN_ENV.ROOT_ADMIN_EMAIL,
      enabled: true,
    });
    expect(typeof rootAdmin?.name).toBe("string");
    expect(rootAdmin?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(rootAdmin?.passwordHash).not.toContain(
      ROOT_ADMIN_ENV.ROOT_ADMIN_PASSWORD,
    );
    await expect(
      verifyArgon2(
        rootAdmin?.passwordHash ?? "",
        ROOT_ADMIN_ENV.ROOT_ADMIN_PASSWORD,
      ),
    ).resolves.toBe(true);

    expect(relationships).toContainEqual(
      expect.objectContaining({
        type: "org_user",
        firstId: rootOrg?._id,
        secondId: rootAdmin?._id,
      }),
    );
    expect(relationships).toContainEqual(
      expect.objectContaining({
        type: "user_role",
        firstId: rootAdmin?._id,
        secondId: superAdminRole?._id,
      }),
    );
  }, 120_000);

  it("帳號已存在時完全不動:重跑(即使密碼環境變數改了)不重設密碼、不重複建立關聯", async () => {
    const databaseUri = createTestDatabaseUri("root-admin-rerun");

    const firstRun = await runSeedCommand(databaseUri);
    expect(firstRun.status).toBe(0);
    const before = await readAccountState(databaseUri);

    const secondRun = await runSeedCommand(databaseUri, {
      env: { ROOT_ADMIN_PASSWORD: ["changed", "secret", "456"].join("-") },
    });
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);

    const after = await readAccountState(databaseUri);
    expect(after.users).toEqual(before.users);
    expect(after.relationships).toEqual(before.relationships);
  }, 120_000);

  it("缺少 ROOT_ADMIN_* 環境變數時以非零結束並指出缺哪一個", async () => {
    const databaseUri = createTestDatabaseUri("root-admin-missing-env");

    const result = await runSeedCommand(databaseUri, {
      env: { ROOT_ADMIN_PASSWORD: undefined },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ROOT_ADMIN_PASSWORD");
  }, 120_000);
});

describe("模組樹、權限、資料範圍目標種子(正本:docs/modules/*.md)", () => {
  it("示範家族 10 節點依正本落庫:parentId/ancestors 指向該環境的 _id、sidebarType、order;全部 enabled", async () => {
    const databaseUri = createTestDatabaseUri("module-tree");

    const result = await runSeedCommand(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const { modules } = await readSeededDocuments(databaseUri);
    const byKey = new Map(modules.map((module) => [module.key, module]));
    const idOf = (key: string): string | undefined =>
      byKey.get(key)?._id.toHexString();

    // 正本:docs/modules/demo.sub.sample-one.md「家族模組樹」+ demo.sample-two.md「模組節點」
    const expectedTree: [string, string, string, string | null][] = [
      ["demo", "示範群組", "group", null],
      ["demo.sub", "示範次群組", "group", "demo"],
      ["demo.sub.sample-one", "示範模組1", "link", "demo.sub"],
      [
        "demo.sub.sample-one.view-page",
        "示範項目詳情",
        "hidden",
        "demo.sub.sample-one",
      ],
      [
        "demo.sub.sample-one.create-page",
        "新增示範項目",
        "hidden",
        "demo.sub.sample-one",
      ],
      [
        "demo.sub.sample-one.edit-page",
        "編輯示範項目",
        "hidden",
        "demo.sub.sample-one",
      ],
      ["demo.sample-two", "示範模組2", "link", "demo"],
      ["demo.sample-two.view-page", "詳情", "hidden", "demo.sample-two"],
      ["demo.sample-two.create-page", "新增", "hidden", "demo.sample-two"],
      ["demo.sample-two.edit-page", "編輯", "hidden", "demo.sample-two"],
    ];
    for (const [key, name, sidebarType, parentKey] of expectedTree) {
      const module = byKey.get(key);
      expect(module).toBeDefined();
      expect(module).toMatchObject({
        name,
        sidebarType,
        isSystem: true,
        enabled: true,
      });
      expect(typeof module?.order).toBe("number");
      expect(typeof module?.route).toBe("string");
      expect(module?.parentId?.toHexString() ?? null).toBe(
        parentKey === null ? null : idOf(parentKey),
      );
    }

    // 物化路徑:祖先由根到父依序
    expect(hex(byKey.get("demo")?.ancestors)).toEqual([]);
    expect(hex(byKey.get("demo.sub.sample-one.edit-page")?.ancestors)).toEqual([
      idOf("demo"),
      idOf("demo.sub"),
      idOf("demo.sub.sample-one"),
    ]);
    expect(hex(byKey.get("demo.sample-two.view-page")?.ancestors)).toEqual([
      idOf("demo"),
      idOf("demo.sample-two"),
    ]);

    // 同層 order 不重複,側欄才有確定順序
    const siblingsOfDemo = modules.filter(
      (module) => module.parentId?.toHexString() === idOf("demo"),
    );
    expect(new Set(siblingsOfDemo.map((module) => module.order)).size).toBe(
      siblingsOfDemo.length,
    );

    // 樹全種:治理模組、資料範圍、隱藏 api 模組也在,且皆 enabled(D4:不分環境)
    for (const key of [
      "overview",
      "system",
      "system.org-manager",
      "system.org-manager.tenant-ops",
      "system.user-manager",
      "system.role-manager",
      "system.module-manager",
      "system.field-manager",
      "system.data-scope",
      "api",
    ]) {
      expect(byKey.get(key)).toMatchObject({ isSystem: true, enabled: true });
    }
    expect(byKey.get("api")?.sidebarType).toBe("hidden");

    // 租戶作業:組織管理底下的隱藏權限容器,沒有路由(docs/modules/org-manager.md 模組樹)
    const tenantOps = byKey.get("system.org-manager.tenant-ops");
    expect(tenantOps).toMatchObject({
      name: "租戶作業",
      sidebarType: "hidden",
    });
    expect(tenantOps).not.toHaveProperty("route");
    expect(tenantOps?.parentId?.toHexString()).toBe(idOf("system.org-manager"));
    expect(hex(tenantOps?.ancestors)).toEqual([
      idOf("system"),
      idOf("system.org-manager"),
    ]);
  }, 120_000);

  it("示範家族 12 筆 + 組織管理 14 筆(10 + 租戶作業 4)+ 使用者管理 8 筆 + 角色管理 7 筆 + 模組與權限 4 筆 + 欄位管理 5 筆(4 + 類別作業 1)+ 資料範圍 2 筆 + 表單管理 5 筆 + 流程管理 7 筆 + 通知設定 2 筆 + 印表機管理 3 筆 + 列印 API 2 筆 + 申請中心 1 筆 + 三個示範表單各 4 筆個別權限依正本落庫(moduleId 綁「所在的那一頁」);全部 41 個模組各一筆 wildcard,共 125 筆", async () => {
    const databaseUri = createTestDatabaseUri("permissions");

    const firstRun = await runSeedCommand(databaseUri);
    expect(firstRun.status).toBe(0);
    expect(firstRun.stdout).toContain(
      "permissions:新增 125 / 更新 0 / 認養 0 / 未變 0",
    );
    // 冪等:重跑 0 新增 / 0 更新 / 全部未變
    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain(
      "permissions:新增 0 / 更新 0 / 認養 0 / 未變 125",
    );

    const { modules, permissions } = await readSeededDocuments(databaseUri);
    const moduleIdOf = (key: string): string | undefined =>
      modules.find((module) => module.key === key)?._id.toHexString();

    // 正本:demo.sub.sample-one.md 權限表(9)+ demo.sample-two.md 權限表(5)
    const expectedOwners: Record<string, string> = {
      "demo.sub.sample-one.view": "demo.sub.sample-one",
      "demo.sub.sample-one.create": "demo.sub.sample-one",
      "demo.sub.sample-one.edit": "demo.sub.sample-one",
      "demo.sub.sample-one.delete": "demo.sub.sample-one",
      "demo.sub.sample-one.show-internal-note": "demo.sub.sample-one",
      "demo.sub.sample-one.edit-internal-note": "demo.sub.sample-one",
      "demo.sub.sample-one.create-page.show-tips":
        "demo.sub.sample-one.create-page",
      "demo.sub.sample-one.edit-page.show-history":
        "demo.sub.sample-one.edit-page",
      "demo.sample-two.view": "demo.sample-two",
      "demo.sample-two.create": "demo.sample-two",
      "demo.sample-two.edit": "demo.sample-two",
      "demo.sample-two.delete": "demo.sample-two",
      // 正本:docs/modules/org-manager.md 權限表(10 + 租戶作業 3;
      // set-visibility 2026-09-19 從 tenant-ops 搬到組織管理層,ADR-0005;
      // view-members / add-members 是「成員」頁籤)
      "system.org-manager.view": "system.org-manager",
      "system.org-manager.create-child": "system.org-manager",
      "system.org-manager.edit": "system.org-manager",
      "system.org-manager.toggle-enabled": "system.org-manager",
      "system.org-manager.move": "system.org-manager",
      "system.org-manager.delete": "system.org-manager",
      "system.org-manager.view-members": "system.org-manager",
      "system.org-manager.add-members": "system.org-manager",
      "system.org-manager.set-visibility": "system.org-manager",
      "system.org-manager.set-timezone": "system.org-manager",
      "system.org-manager.tenant-ops.provision":
        "system.org-manager.tenant-ops",
      "system.org-manager.tenant-ops.revoke-provision":
        "system.org-manager.tenant-ops",
      "system.org-manager.tenant-ops.purge-demo":
        "system.org-manager.tenant-ops",
      "system.org-manager.tenant-ops.transfer-owner":
        "system.org-manager.tenant-ops",
      // 正本:docs/modules/user-manager.md 權限表(8)
      "system.user-manager.view": "system.user-manager",
      "system.user-manager.create": "system.user-manager",
      "system.user-manager.edit": "system.user-manager",
      "system.user-manager.toggle-enabled": "system.user-manager",
      "system.user-manager.manage-orgs": "system.user-manager",
      "system.user-manager.assign-roles": "system.user-manager",
      "system.user-manager.show-national-id": "system.user-manager",
      "system.user-manager.edit-national-id": "system.user-manager",
      // 正本:docs/modules/role-manager.md 權限表(7)
      "system.role-manager.view": "system.role-manager",
      "system.role-manager.create": "system.role-manager",
      "system.role-manager.edit": "system.role-manager",
      "system.role-manager.edit-matrix": "system.role-manager",
      "system.role-manager.assign-users": "system.role-manager",
      "system.role-manager.toggle-enabled": "system.role-manager",
      "system.role-manager.delete": "system.role-manager",
      // 正本:docs/modules/module-manager.md 權限表(4;根組織專屬模組)
      "system.module-manager.view": "system.module-manager",
      "system.module-manager.toggle-enabled": "system.module-manager",
      "system.module-manager.set-icon": "system.module-manager",
      "system.module-manager.delete-retired-permission":
        "system.module-manager",
      // 正本:docs/modules/field-manager.md 權限表(4 + 類別作業 1)
      "system.field-manager.view": "system.field-manager",
      "system.field-manager.create": "system.field-manager",
      "system.field-manager.edit": "system.field-manager",
      "system.field-manager.toggle-enabled": "system.field-manager",
      "system.field-manager.category-ops.manage-categories":
        "system.field-manager.category-ops",
      // 正本:docs/modules/data-scope.md 權限表(2;根組織專屬模組)
      "system.data-scope.view": "system.data-scope",
      "system.data-scope.edit": "system.data-scope",
      // 正本:docs/modules/forms.md 權限表(5)
      "system.forms.view": "system.forms",
      "system.forms.create": "system.forms",
      "system.forms.edit": "system.forms",
      "system.forms.assign": "system.forms",
      "system.forms.set-enabled": "system.forms",
      // 三個示範表單模組:各四筆基本權限
      ...Object.fromEntries(
        ["demo-form", "demo.form", "demo.sub.form"].flatMap((key) =>
          ["view", "create", "edit", "delete"].map((action) => [
            `${key}.${action}`,
            key,
          ]),
        ),
      ),
      // 流程管理:6 個 + 阻擋清單頁自有的改派
      "system.workflows.view": "system.workflows",
      "system.workflows.create": "system.workflows",
      "system.workflows.edit": "system.workflows",
      "system.workflows.delete": "system.workflows",
      "system.workflows.publish": "system.workflows",
      "system.workflows.assign": "system.workflows",
      "system.workflows.blocked-page.reassign": "system.workflows.blocked-page",
      // 申請中心(固定模組)
      "apply-center.view": "apply-center",
      // 正本:docs/modules/notification-settings.md 權限表(2)
      "system.notification-settings.view": "system.notification-settings",
      "system.notification-settings.edit": "system.notification-settings",
      // 正本:docs/modules/printers.md 權限表(印表機管理 3 + 列印 API 2)
      "system.printers.view": "system.printers",
      "system.printers.create": "system.printers",
      "system.printers.edit": "system.printers",
      "api.printing.print": "api.printing",
      "api.printing.reprint": "api.printing",
    };

    // D3:wildcard 只代表該模組自己這一層 → 每個模組(含群組、隱藏頁、api 樹)各一筆 `<key>.*`
    for (const module of modules) {
      expectedOwners[`${String(module.key)}.*`] = String(module.key);
    }
    expect(modules).toHaveLength(41);
    expect(permissions).toHaveLength(125);
    for (const [key, ownerKey] of Object.entries(expectedOwners)) {
      const permission = permissions.find((entry) => entry.key === key);
      expect(permission).toMatchObject({
        isSystem: true,
        enabled: true,
        source: "seed",
      });
      expect(typeof permission?.name).toBe("string");
      expect(permission?.moduleId?.toHexString()).toBe(moduleIdOf(ownerKey));
    }
  }, 120_000);

  it("dataScopeTarget 落庫至 data_scope_targets:runner 填宣告模組的 moduleKey(識別鍵 (collection, moduleKey),不多掛 key 欄位),重跑冪等", async () => {
    const databaseUri = createTestDatabaseUri("data-scope-targets");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain(
      "data_scope_targets:新增 0 / 更新 0 / 認養 0 / 未變 4",
    );

    const { dataScopeTargets } = await readSeededDocuments(databaseUri);
    expect(dataScopeTargets).toHaveLength(4);
    // 表單模組的目標:collection 固定 form_submissions,moduleKey = 宣告它的模組;
    // 任何一個表單模組都可能被綁流程,狀態選項一律涵蓋七種
    for (const moduleKey of ["demo-form", "demo.form", "demo.sub.form"]) {
      expect(
        dataScopeTargets.find((target) => target.moduleKey === moduleKey),
      ).toMatchObject({
        collection: "form_submissions",
        isSystem: true,
        fields: [
          {
            name: "status",
            options: [
              { value: "draft" },
              { value: "reviewing" },
              { value: "returned" },
              { value: "withdrawn" },
              { value: "completed" },
              { value: "rejected" },
              { value: "voided" },
            ],
          },
        ],
      });
    }
    // 業務欄位目錄照宣告落庫(enum 的固定選項);基礎欄位不入庫,由 api 查詢時附加
    expect(dataScopeTargets[0]).toMatchObject({
      collection: "demo_items_one",
      moduleKey: "demo.sub.sample-one",
      isSystem: true,
      fields: [
        {
          name: "status",
          label: "狀態",
          type: "enum",
          options: [
            { value: "draft", label: "草稿" },
            { value: "published", label: "已發布" },
            { value: "archived", label: "已封存" },
          ],
        },
      ],
    });
    expect(typeof dataScopeTargets[0]?.name).toBe("string");
    expect(dataScopeTargets[0]).not.toHaveProperty("key");
  }, 120_000);

  it("示範資料兩表各 5 筆:以 key 冪等、掛根組織、各有一筆初始停用,重跑 0 / 0 / 5", async () => {
    const databaseUri = createTestDatabaseUri("demo-items");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain(
      "demo_items_one:新增 0 / 更新 0 / 認養 0 / 未變 5",
    );
    expect(secondRun.stdout).toContain(
      "demo_items_two:新增 0 / 更新 0 / 認養 0 / 未變 5",
    );

    const { itemsOne, itemsTwo, rootOrg, demoOptionValues } =
      await withDatabase(databaseUri, async (database) => ({
        itemsOne: await database
          .collection<DemoItemDocument>("demo_items_one")
          .find()
          .sort({ key: 1 })
          .toArray(),
        itemsTwo: await database
          .collection<DemoItemDocument>("demo_items_two")
          .find()
          .sort({ key: 1 })
          .toArray(),
        rootOrg: await database
          .collection<SeededDocument>("orgs")
          .findOne({ key: "root" }),
        demoOptionValues: await database
          .collection<FieldDocument>("fields")
          .find({ key: { $regex: String.raw`^demo-category\.` } })
          .map((field) => field.value)
          .toArray(),
      }));

    expect(itemsOne).toHaveLength(5);
    expect(itemsTwo).toHaveLength(5);

    for (const item of [...itemsOne, ...itemsTwo]) {
      // key 不是 schema 欄位,與 isSystem 一樣由 runner 掛上(冪等的識別鍵,ADR-0002)
      expect(typeof item.key).toBe("string");
      expect(item.isSystem).toBe(true);
      // orgId / createdBy 皆為 ObjectId:前者由 seedRef 解析成該環境的根組織 id
      expect(item.orgId?.toHexString()).toBe(rootOrg?._id.toHexString());
      expect(item.createdBy?.toHexString()).toMatch(/^[\da-f]{24}$/);
    }

    // 一筆初始停用(列表的狀態欄與篩選在畫面上看得出差異)
    expect(itemsOne.filter((item) => item.enabled === false)).toHaveLength(1);
    expect(itemsTwo.filter((item) => item.enabled === false)).toHaveLength(1);

    // 示範模組1:三種 status、三個分類值都出現過,且分類值都是欄位管理「示範分類」的種子選項
    expect(new Set(itemsOne.map((item) => item.status))).toEqual(
      new Set(["draft", "published", "archived"]),
    );
    const usedCategories = new Set(itemsOne.map((item) => item.category));
    expect(usedCategories).toEqual(new Set(demoOptionValues));
    // 不同建立者(假 id,seed 沒有可引用的使用者 — 見 seeds/base/demo-items.ts 的註解)
    expect(
      new Set(itemsOne.map((item) => item.createdBy?.toHexString())).size,
    ).toBeGreaterThan(1);

    // 示範模組2 是對照組:沒有分類、沒有狀態
    for (const item of itemsTwo) {
      expect(item).not.toHaveProperty("category");
      expect(item).not.toHaveProperty("status");
    }
  }, 120_000);

  it("enabled 是「初始 seed 值的欄位」:建立後在系統內改為 false,重跑 seed 為未變、值仍為 false;宣告的其他欄位改了仍同步", async () => {
    const databaseUri = createTestDatabaseUri("initial-seed-value");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    await withDatabase(databaseUri, async (database) => {
      await database
        .collection("modules")
        .updateOne({ key: "demo.sample-two" }, { $set: { enabled: false } });
      await database
        .collection("roles")
        .updateOne({ key: "tenant-admin" }, { $set: { enabled: false } });
    });

    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toMatch(
      /新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/,
    );

    const { modules, roles } = await readSeededDocuments(databaseUri);
    expect(
      modules.find((module) => module.key === "demo.sample-two")?.enabled,
    ).toBe(false);
    expect(roles.find((role) => role.key === "tenant-admin")?.enabled).toBe(
      false,
    );
    // 其他模組不受影響
    expect(modules.find((module) => module.key === "demo")?.enabled).toBe(true);
  }, 120_000);

  it("icon 初值依正本落庫;人在系統內改過(含清成 null)重跑不被覆蓋,欄位缺漏才補初值", async () => {
    const databaseUri = createTestDatabaseUri("module-icon");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });

    const seeded = await readSeededDocuments(databaseUri);
    const iconOf = (key: string): unknown =>
      seeded.modules.find((module) => module.key === key)?.icon;
    // 初值正本:apps/db-migrator/seeds/base/modules/*.ts(對照表見 docs/modules/module-manager.md)
    expect(iconOf("overview")).toBe("dashboard");
    expect(iconOf("system")).toBe("settings");
    expect(iconOf("system.org-manager")).toBe("business");
    expect(iconOf("system.org-manager.tenant-ops")).toBe("key");
    expect(iconOf("api")).toBe("tune");
    // 沒宣告圖示的隱藏頁落庫為 null(欄位在、值為 null = 側欄用預設圖示)
    expect(iconOf("demo.sample-two.view-page")).toBeNull();

    await withDatabase(databaseUri, async (database) => {
      // 人改過:一筆換成別的 key、一筆清成 null(setModuleIcon 寫的就是 null,不是 $unset)
      await database
        .collection("modules")
        .updateOne({ key: "overview" }, { $set: { icon: "home" } });
      await database
        .collection("modules")
        .updateOne({ key: "system" }, { $set: { icon: null } });
      // 舊環境的文件根本沒有這一欄(加這個欄位之前種下的資料):重跑要補初值,否則新功能等於沒上線
      await database
        .collection("modules")
        .updateOne({ key: "api" }, { $unset: { icon: "" } });
    });

    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);

    const after = await readSeededDocuments(databaseUri);
    const afterIconOf = (key: string): unknown =>
      after.modules.find((module) => module.key === key)?.icon;
    expect(afterIconOf("overview")).toBe("home");
    expect(afterIconOf("system")).toBeNull();
    expect(afterIconOf("api")).toBe("tune");
  }, 120_000);

  it("settings 是初始 seed 值的欄位:模組的列表欄位配置(settings.list)與根組織的時區在重跑 seed 後保留", async () => {
    const databaseUri = createTestDatabaseUri("module-settings");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });

    const list = {
      columns: [{ kind: "field", key: "title", order: 0 }],
      builtin: { status: false },
    };
    await withDatabase(databaseUri, async (database) => {
      await database
        .collection("modules")
        .updateOne({ key: "demo-form" }, { $set: { "settings.list": list } });
      await database
        .collection("orgs")
        .updateOne(
          { key: "root" },
          { $set: { "settings.timezone": "Asia/Tokyo" } },
        );
    });

    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);

    const after = await readSeededDocuments(databaseUri);
    expect(
      after.modules.find((module) => module.key === "demo-form")?.settings,
    ).toEqual({ list });
    expect(after.orgs[0]?.settings).toEqual({ timezone: "Asia/Tokyo" });
  }, 120_000);

  it("modules.engine:三個示範表單落庫為 form(含三個 -page 隱藏頁的父節點),位置與完整路由照宣告,其餘一律 fixed", async () => {
    const databaseUri = createTestDatabaseUri("module-engine");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const { modules } = await readSeededDocuments(databaseUri);
    const byKey = (key: string) => modules.find((module) => module.key === key);
    const formModuleKeys = ["demo-form", "demo.form", "demo.sub.form"];
    for (const key of formModuleKeys) {
      expect(byKey(key)?.engine).toBe("form");
      expect(
        new Set(
          modules
            .filter((module) => module.key?.startsWith(`${key}.`))
            .map(
              (module) => `${String(module.key)}:${String(module.sidebarType)}`,
            ),
        ),
      ).toEqual(
        new Set([
          `${key}.view-page:hidden`,
          `${key}.create-page:hidden`,
          `${key}.edit-page:hidden`,
        ]),
      );
    }
    // 頂層 / 群組內 / 次群組內:parentId 與 route 段串起來的完整路由
    expect(byKey("demo-form")?.parentId).toBeNull();
    expect(byKey("demo.form")?.parentId).toEqual(byKey("demo")?._id);
    expect(byKey("demo.sub.form")?.parentId).toEqual(byKey("demo.sub")?._id);
    const fullRouteOf = (key: string): string =>
      [...(byKey(key)?.ancestors ?? []), byKey(key)?._id]
        .map(
          (id) =>
            modules.find((module) => id !== undefined && module._id.equals(id))
              ?.route,
        )
        .join("/");
    expect(fullRouteOf("demo-form")).toBe("demo-form");
    expect(fullRouteOf("demo.form")).toBe("demo/form");
    expect(fullRouteOf("demo.sub.form")).toBe("demo/sub/form");
    expect(
      new Set(
        modules
          .filter((module) => module.engine === "form")
          .map((module) => module.key),
      ),
    ).toEqual(new Set(formModuleKeys));
    // 底座示範表單模組不開啟依表單分開新增權限;每個模組都落庫 perFormCreate = false
    expect(modules.every((module) => module.perFormCreate === false)).toBe(
      true,
    );
  }, 120_000);

  it("seed 只同步 source = seed 的權限:先塞一筆 dynamic 權限再跑 seed,它原封不動還在", async () => {
    const databaseUri = createTestDatabaseUri("dynamic-permission");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    const dynamicKey = "demo-form.show-demo_order-internal_amount";
    const dynamicPermission = await withDatabase(
      databaseUri,
      async (database) => {
        const owner = await database
          .collection("modules")
          .findOne({ key: "demo-form" });
        const document = {
          key: dynamicKey,
          moduleId: owner?._id,
          name: "示範表單(頂層)/ 內部金額 可見",
          enabled: true,
          isSystem: false,
          settings: {},
          source: "dynamic",
          retiredAt: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        };
        await database.collection("permissions").insertOne(document);
        return document;
      },
    );

    const secondRun = await runSeedCommand(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    // 宣告的 125 筆全部未變;dynamic 那筆不在比對範圍內,不計入也不被動到
    expect(secondRun.stdout).toContain(
      "permissions:新增 0 / 更新 0 / 認養 0 / 未變 125",
    );

    const { permissions } = await readSeededDocuments(databaseUri);
    expect(permissions).toHaveLength(126);
    expect(
      permissions.find((permission) => permission.key === dynamicKey),
    ).toMatchObject({
      name: dynamicPermission.name,
      source: "dynamic",
      isSystem: false,
      updatedAt: dynamicPermission.updatedAt,
    });
  }, 120_000);

  it("初始 seed 值的欄位改了不算變更,每次都 seed 的欄位改了仍同步(以夾具 registry 驗證)", async () => {
    const databaseUri = createTestDatabaseUri("initial-seed-value-fixture");

    const firstRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-initial-v1"),
    });
    expect(firstRun.stderr).toBe("");
    expect(firstRun.status).toBe(0);
    expect(firstRun.stdout).toContain("新增 2 / 更新 0 / 認養 0 / 未變 0");

    // v2:alpha 的 enabled 改 false(初始 seed 值,不同步)、beta 的 name 改了(每次都 seed,同步)
    const secondRun = await runSeedCommand(databaseUri, {
      registryPath: fixtureRegistryPath("seeds-initial-v2"),
    });
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain("新增 0 / 更新 1 / 認養 0 / 未變 1");

    const items = await withDatabase(databaseUri, (database) =>
      database
        .collection<SeededDocument>("seed_fixture_items")
        .find()
        .sort({ key: 1 })
        .toArray(),
    );
    expect(items.map((item) => [item.key, item.name, item.enabled])).toEqual([
      ["alpha", "Alpha", true],
      ["beta", "Beta 2", true],
    ]);
  }, 120_000);
});

describe("種子角色綁定(ADR-0004 wildcard 只存 *、ADR-0009 模板扣除根組織專屬模組)", () => {
  it("租戶管理員模板綁全部非根組織專屬模組(role_module)與各該模組各自的 wildcard(role_permission,一一對應);超級管理員不造任何綁定;重跑不重複", async () => {
    const databaseUri = createTestDatabaseUri("role-bindings");

    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });
    expect(await runSeedCommand(databaseUri)).toMatchObject({ status: 0 });

    const { roles, modules, permissions, relationships } =
      await readSeededDocuments(databaseUri);
    const tenantAdmin = roles.find((role) => role.key === "tenant-admin");
    const superAdmin = roles.find((role) => role.key === "super-admin");
    const boundBy = (roleId: ObjectId | undefined, type: string) =>
      relationships.filter(
        (link) =>
          link.type === type &&
          roleId !== undefined &&
          link.firstId?.equals(roleId),
      );

    const boundModuleKeys = boundBy(tenantAdmin?._id, "role_module").map(
      (link) => keyOf(modules)(link.secondId),
    );
    const allModuleKeys = modules.map((module) => module.key);
    // 根組織專屬:模組與權限(system.module-manager)、資料範圍(system.data-scope)、
    // 租戶作業(system.org-manager.tenant-ops)、類別作業(system.field-manager.category-ops)
    // 兩個隱藏權限容器 — docs/modules/*.md
    const rootOnlyKeys = new Set([
      "system.module-manager",
      "system.data-scope",
      "system.org-manager.tenant-ops",
      "system.field-manager.category-ops",
    ]);
    const tenantModuleKeys = allModuleKeys.filter(
      (key) => key !== undefined && !rootOnlyKeys.has(key),
    );
    expect(new Set(boundModuleKeys)).toEqual(new Set(tenantModuleKeys));
    expect(boundModuleKeys).toHaveLength(37);
    // 租戶作業(開通、轉移擁有者)與類別作業(管理類別)永遠不進模板
    // (ADR-0009 第 3 步:整個 rootOnly 模組被扣除)
    expect(boundModuleKeys).not.toContain("system.org-manager.tenant-ops");
    expect(boundModuleKeys).not.toContain("system.field-manager.category-ops");
    // 反面:可見範圍開關搬到組織管理層後,模板靠 `system.org-manager.*` 自動取得(ADR-0005)—
    // 模板不綁個別權限,所以這裡驗的是「它的擁有模組在模板綁的模組內」
    expect(boundModuleKeys).toContain("system.org-manager");
    const setVisibility = permissions.find(
      (permission) => permission.key === "system.org-manager.set-visibility",
    );
    expect(
      modules.find((module) => module._id.equals(setVisibility?.moduleId))?.key,
    ).toBe("system.org-manager");

    const boundPermissionKeys = boundBy(
      tenantAdmin?._id,
      "role_permission",
    ).map((link) => keyOf(permissions)(link.secondId));
    // D3:wildcard 只代表自己這一層 → 綁的每個模組各自的 `*`(含 overview、system 群組、api、六個隱藏頁)
    expect(new Set(boundPermissionKeys)).toEqual(
      new Set(tenantModuleKeys.map((key) => `${String(key)}.*`)),
    );
    expect(boundPermissionKeys).toHaveLength(37);
    // 管理類別(新增 / 改名 / 停用類別)只給站在根組織的人:模板既不綁它的容器 wildcard,也不綁它本身
    expect(boundPermissionKeys).not.toContain(
      "system.field-manager.category-ops.*",
    );
    expect(boundPermissionKeys).not.toContain(
      "system.field-manager.category-ops.manage-categories",
    );
    // 6b:申請中心 view、流程管理全部、阻擋清單頁自有的改派,都由各層的 wildcard 涵蓋
    // (同層語意:`system.workflows.*` 不含 `blocked-page` 那一層,所以模板另有 `blocked-page.*`)
    for (const key of [
      "apply-center.*",
      "apply-center.view-page.*",
      "system.workflows.*",
      "system.workflows.blocked-page.*",
      "demo-form.*",
      "demo.form.*",
      "demo.sub.form.*",
    ]) {
      expect(boundPermissionKeys).toContain(key);
    }

    // 超級管理員:解析時 bypass,不靠記錄(ADR-0004)
    expect(boundBy(superAdmin?._id, "role_module")).toHaveLength(0);
    expect(boundBy(superAdmin?._id, "role_permission")).toHaveLength(0);
  }, 120_000);
});
