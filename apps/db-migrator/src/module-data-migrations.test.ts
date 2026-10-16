import { readdirSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { runNode } from "../test/support/update-harness";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "migrations");
const MIGRATE_MONGO_BIN = path.join(
  PACKAGE_ROOT,
  "node_modules",
  "migrate-mongo",
  "bin",
  "migrate-mongo.js",
);

/** 本票加的三支回填遷移(依檔名 = 執行順序)。 */
const BACKFILL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((fileName) => fileName.startsWith("20260925"))
  // 檔名是 ASCII 的時間戳,字碼序即執行順序
  .toSorted((left, right) => (left < right ? -1 : 1))
  .map((fileName) => path.join(MIGRATIONS_DIR, fileName));

/**
 * 直接 import 遷移檔、呼叫 `up` `times` 次(不經 migrate-mongo 的 changelog 防重跑)——
 * 驗的是遷移**本身**冪等。遷移檔是 ESM,jest 這邊是 CJS,所以在子行程裡跑。
 */
const RUN_UP_DIRECTLY = `
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
const [uri, times, ...files] = process.argv.slice(1);
const client = await MongoClient.connect(uri);
try {
  for (let round = 0; round < Number(times); round += 1) {
    for (const file of files) {
      const migration = await import(pathToFileURL(file).href);
      await migration.up(client.db());
    }
  }
} finally {
  await client.close();
}
`;

/** 本地起 mongodb-memory-server;CI 沿用既有 MongoDB service container(MONGODB_URI)。 */
let memoryServer: MongoMemoryServer | undefined;
let baseUri: string;
const clients: MongoClient[] = [];

function databaseUriOf(suffix: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/db-migrator-test-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runMigrateUp(databaseUri: string) {
  return runNode([MIGRATE_MONGO_BIN, "up"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, MONGODB_URI: databaseUri },
  });
}

function runUpDirectly(databaseUri: string, times: number) {
  return runNode(
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      ...BACKFILL_MIGRATIONS,
    ],
    { cwd: PACKAGE_ROOT },
  );
}

const rootOrgId = new ObjectId("0000000000000000000a0001");
const tenantId = new ObjectId("0000000000000000000abc12");
const deptId = new ObjectId("0000000000000000000a0003");
const otherTenantId = new ObjectId("0000000000000000000a0004");
/** 所屬組織不存在的孤兒資料。 */
const missingOrgId = new ObjectId("0000000000000000000a0099");
const orphanItemId = new ObjectId("0000000000000000000b0099");

/** 「欄位加上之前」的資料;id 全部固定,兩個資料庫放同一份才比得出差異。 */
async function seedPreState(database: Db): Promise<void> {
  await database.collection("orgs").insertMany([
    { _id: rootOrgId, name: "根", parentId: null, ancestors: [] },
    {
      _id: tenantId,
      name: "租戶甲",
      parentId: rootOrgId,
      ancestors: [rootOrgId],
    },
    {
      _id: deptId,
      name: "部門",
      parentId: tenantId,
      ancestors: [rootOrgId, tenantId],
    },
    {
      _id: otherTenantId,
      name: "已有短碼的租戶",
      parentId: rootOrgId,
      ancestors: [rootOrgId],
      // 故意佔走「租戶甲」依後 6 碼會得到的短碼,驗撞名時改用後 12 碼
      slug: "tenant_0abc12",
    },
  ]);
  await database.collection("demo_items_one").insertMany([
    {
      _id: new ObjectId("0000000000000000000b0001"),
      name: "根的",
      orgId: rootOrgId,
    },
    {
      _id: new ObjectId("0000000000000000000b0002"),
      name: "部門的",
      orgId: deptId,
    },
    { _id: orphanItemId, name: "孤兒", orgId: missingOrgId },
  ]);
  await database.collection("demo_items_two").insertOne({
    _id: new ObjectId("0000000000000000000b0003"),
    name: "租戶的",
    orgId: tenantId,
  });
  await database
    .collection("data_scope_targets")
    .createIndex({ collection: 1 }, { unique: true });
  await database.collection("data_scope_targets").insertOne({
    _id: new ObjectId("0000000000000000000c0001"),
    collection: "demo_items_one",
    name: "示範項目",
    fields: [],
  });
  await database
    .collection("data_scope_rules")
    .createIndex({ collection: 1 }, { unique: true });
  await database.collection("data_scope_rules").insertOne({
    _id: new ObjectId("0000000000000000000c0002"),
    collection: "demo_items_one",
    combineOp: "OR",
    rules: [],
  });
  await database.collection("permissions").insertOne({
    _id: new ObjectId("0000000000000000000c0003"),
    key: "demo.sub.sample-one.view",
    name: "檢視",
  });
  await database.collection("modules").insertOne({
    _id: new ObjectId("0000000000000000000c0004"),
    key: "demo.sub.sample-one",
    name: "示範模組1",
  });
}

/** 回填動到的每張表的內容 + 相關索引的鍵(排序後),用來比較兩次結果。 */
async function snapshotOf(database: Db): Promise<unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const name of [
    "orgs",
    "demo_items_one",
    "demo_items_two",
    "data_scope_targets",
    "data_scope_rules",
    "permissions",
    "modules",
  ]) {
    const collection = database.collection(name);
    const indexes = await collection.indexes();
    snapshot[name] = {
      documents: await collection.find({}, { sort: { _id: 1 } }).toArray(),
      indexes: indexes
        .map((index) => JSON.stringify(index.key))
        .toSorted((left, right) => (left < right ? -1 : 1)),
    };
  }
  return snapshot;
}

beforeAll(async () => {
  if (process.env.MONGODB_URI) {
    baseUri = process.env.MONGODB_URI;
  } else {
    memoryServer = await MongoMemoryServer.create();
    baseUri = memoryServer.getUri();
  }
}, 600_000);

afterAll(async () => {
  for (const client of clients) {
    await client.db().dropDatabase();
    await client.close();
  }
  await memoryServer?.stop();
}, 60_000);

/**
 * 模組資料 / 資料範圍依模組 / 短碼 / 權限來源 / 模組 engine 的回填(ADR-0002 遷移)。
 * 先以 driver 放一份「欄位加上之前」的資料,跑 `migrate up`,再驗回填結果與重跑冪等。
 */
describe("回填遷移(模組資料欄位、資料範圍依模組、orgs.slug、permissions.source、modules.engine)", () => {
  let database: Db;
  let databaseUri: string;
  let migrateOutput: string;

  beforeAll(async () => {
    databaseUri = databaseUriOf("module-data");
    database = await openDatabase(databaseUri);
    await seedPreState(database);

    const result = await runMigrateUp(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    migrateOutput = result.stdout;
  }, 600_000);

  it("示範兩表:moduleKey 寫死模組 key,tenantId 依 orgId 的祖先推導(根組織為 null)", async () => {
    const one = await database
      .collection("demo_items_one")
      .find({ _id: { $ne: orphanItemId } }, { sort: { name: 1 } })
      .toArray();
    expect(
      one.map((item) => ({
        name: item.name as unknown,
        moduleKey: item.moduleKey as unknown,
        tenantId: item.tenantId === null ? null : String(item.tenantId),
      })),
    ).toEqual(
      expect.arrayContaining([
        { name: "根的", moduleKey: "demo.sub.sample-one", tenantId: null },
        {
          name: "部門的",
          moduleKey: "demo.sub.sample-one",
          tenantId: String(tenantId),
        },
      ]),
    );
    const two = await database.collection("demo_items_two").findOne({});
    expect(two?.moduleKey).toBe("demo.sample-two");
    expect(String(two?.tenantId)).toBe(String(tenantId));
  });

  it("所屬組織不存在的孤兒不回填(不標成根組織的資料),筆數與 id 印在輸出上", async () => {
    const orphan = await database
      .collection("demo_items_one")
      .findOne({ _id: orphanItemId });
    expect(orphan).not.toHaveProperty("moduleKey");
    expect(orphan).not.toHaveProperty("tenantId");
    expect(migrateOutput).toContain(String(missingOrgId));
    expect(migrateOutput).toContain(String(orphanItemId));
  });

  it("資料範圍:目標與規則補 moduleKey,唯一索引改成 (collection, moduleKey)", async () => {
    const target = await database.collection("data_scope_targets").findOne({});
    const rule = await database.collection("data_scope_rules").findOne({});
    expect(target?.moduleKey).toBe("demo.sub.sample-one");
    expect(rule?.moduleKey).toBe("demo.sub.sample-one");
    for (const name of ["data_scope_targets", "data_scope_rules"]) {
      const indexes = await database.collection(name).indexes();
      const keys = indexes.map((index) => JSON.stringify(index.key));
      expect(keys).toContain(JSON.stringify({ collection: 1, moduleKey: 1 }));
      expect(keys).not.toContain(JSON.stringify({ collection: 1 }));
    }
  });

  it("orgs.slug:租戶頂層補 tenant_<id 後 6 碼>,撞到既有短碼改用後 12 碼;其他組織不補", async () => {
    const tenant = await database.collection("orgs").findOne({ _id: tenantId });
    expect(tenant?.slug).toBe("tenant_0000000abc12");
    const root = await database.collection("orgs").findOne({ _id: rootOrgId });
    const dept = await database.collection("orgs").findOne({ _id: deptId });
    expect(root?.slug).toBeUndefined();
    expect(dept?.slug).toBeUndefined();
    const other = await database
      .collection("orgs")
      .findOne({ _id: otherTenantId });
    expect(other?.slug).toBe("tenant_0abc12");
  });

  it("permissions 補 source = seed、retiredAt = null;modules 補 engine = fixed", async () => {
    const permission = await database.collection("permissions").findOne({});
    expect(permission?.source).toBe("seed");
    expect(permission?.retiredAt).toBeNull();
    const module = await database.collection("modules").findOne({});
    expect(module?.engine).toBe("fixed");
  });

  it("重跑 migrate up 不重複執行(changelog 防重跑),回填結果不變", async () => {
    const before = await snapshotOf(database);
    const result = await runMigrateUp(databaseUri);
    expect(result.status).toBe(0);
    expect(await snapshotOf(database)).toEqual(before);
  });
});

describe("回填遷移本身冪等:直接呼叫 up 兩次,結果與一次相同", () => {
  it("三支遷移各跑一次 vs 各跑兩次(不經 changelog)→ 資料與索引一模一樣", async () => {
    const onceUri = databaseUriOf("up-once");
    const twiceUri = databaseUriOf("up-twice");
    const once = await openDatabase(onceUri);
    const twice = await openDatabase(twiceUri);
    await seedPreState(once);
    await seedPreState(twice);

    const first = await runUpDirectly(onceUri, 1);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    const second = await runUpDirectly(twiceUri, 2);
    expect(second.stderr).toBe("");
    expect(second.status).toBe(0);

    expect(await snapshotOf(twice)).toEqual(await snapshotOf(once));
  }, 120_000);
});
