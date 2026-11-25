import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";

import {
  SEED_ENTRY,
  TestMongo,
  startEntry,
} from "../../test/support/update-harness";

const MIGRATION = "20261126120000_data_wholesale-role-grants.js";

const WHOLESALE = [
  "purchasing.wholesale",
  "purchasing.wholesale.view-page",
  "purchasing.wholesale.create-page",
  "purchasing.wholesale.edit-page",
];
const CUSTOMERS = [
  "dealers.wholesale-customers",
  "dealers.wholesale-customers.view-page",
  "dealers.wholesale-customers.create-page",
  "dealers.wholesale-customers.edit-page",
];
const NEW_MODULES = [...WHOLESALE, ...CUSTOMERS];
const wildcards = (keys: readonly string[]) => keys.map((key) => `${key}.*`);

const mongo = new TestMongo("db-migrator-wholesale-grants");
const clients: MongoClient[] = [];

beforeAll(async () => {
  await mongo.start();
}, 60_000);

afterAll(async () => {
  for (const client of clients) {
    await client.close();
  }
  await mongo.stop();
}, 60_000);

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

async function update(databaseUri: string): Promise<void> {
  const result = await startEntry(SEED_ENTRY, [], databaseUri).done;
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}

async function idOf(
  db: Db,
  collection: string,
  key: string,
): Promise<ObjectId> {
  const found = await db.collection(collection).findOne({ key });
  if (found === null) {
    throw new Error(`沒有 ${collection}.${key}`);
  }
  return found._id;
}

/** 一個角色(給了 `owner` 才有 org_role)綁幾個既有模組。 */
async function insertRole(
  db: Db,
  role: {
    name: string;
    settings?: Record<string, unknown>;
    owner?: ObjectId;
    modules: readonly string[];
  },
): Promise<ObjectId> {
  const roleId = new ObjectId();
  await db.collection("roles").insertOne({
    _id: roleId,
    name: role.name,
    settings: role.settings ?? {},
    enabled: true,
    deletedAt: null,
  });
  const links: { type: string; firstId: ObjectId; secondId: ObjectId }[] = [];
  if (role.owner !== undefined) {
    links.push({ type: "org_role", firstId: role.owner, secondId: roleId });
  }
  for (const key of role.modules) {
    links.push({
      type: "role_module",
      firstId: roleId,
      secondId: await idOf(db, "modules", key),
    });
  }
  for (const link of links) {
    await db
      .collection("core_relationships")
      .insertOne({ ...link, thirdId: null });
  }
  return roleId;
}

/** 角色綁的新模組與新權限。 */
async function grantedOf(db: Db, roleId: ObjectId) {
  const links = await db
    .collection("core_relationships")
    .find({
      firstId: roleId,
      type: { $in: ["role_module", "role_permission"] },
    })
    .toArray();
  const ids = links.map((link) => link.secondId as ObjectId);
  const [modules, permissions] = await Promise.all([
    db
      .collection("modules")
      .find({ _id: { $in: ids }, key: { $in: NEW_MODULES } })
      .toArray(),
    db
      .collection("permissions")
      .find({ _id: { $in: ids }, key: { $in: wildcards(NEW_MODULES) } })
      .toArray(),
  ]);
  return {
    modules: new Set(modules.map((item) => item.key as string)),
    permissions: new Set(permissions.map((item) => item.key as string)),
    // 同一條關聯不會重複
    unique: new Set(ids.map(String)).size === ids.length,
  };
}

describe("遷移:已開通的租戶補上批售單與批售客戶的權限(規格 21.2、21.8)", () => {
  it("租戶管理員副本全部、總部管理全部、店長批售單全部 + 批售客戶只看;其他角色不動;接著的 seed 補齊模組;重跑不變", async () => {
    const databaseUri = mongo.uri("grants");
    await update(databaseUri);
    const db = await openDatabase(databaseUri);

    // 回到上線前:沒有這些模組與權限、這支遷移還沒跑過
    const moduleIds = await Promise.all(
      NEW_MODULES.map((key) => idOf(db, "modules", key)),
    );
    const permissions = await db
      .collection("permissions")
      .find({ moduleId: { $in: moduleIds } })
      .toArray();
    await db.collection("core_relationships").deleteMany({
      secondId: { $in: [...moduleIds, ...permissions.map((row) => row._id)] },
    });
    await db
      .collection("permissions")
      .deleteMany({ moduleId: { $in: moduleIds } });
    await db.collection("modules").deleteMany({ _id: { $in: moduleIds } });
    await db.collection("changelog").deleteMany({ fileName: MIGRATION });

    const tenant = new ObjectId();
    const both = ["purchasing.transfer", "dealers.contacts"];
    const admin = await insertRole(db, {
      name: "租戶管理員",
      settings: { templateKey: "tenant-admin" },
      owner: tenant,
      modules: both,
    });
    const hq = await insertRole(db, {
      name: "總部管理",
      owner: tenant,
      modules: both,
    });
    const manager = await insertRole(db, {
      name: "店長",
      owner: tenant,
      modules: both,
    });
    const clerk = await insertRole(db, {
      name: "店員",
      owner: tenant,
      modules: both,
    });
    // 沒有經銷商管理的租戶:只補批售單
    const withoutDealers = await insertRole(db, {
      name: "總部管理",
      owner: new ObjectId(),
      modules: ["purchasing.transfer"],
    });
    // 不屬於任何組織的同名角色不動
    const unowned = await insertRole(db, { name: "店長", modules: both });

    await update(databaseUri);

    expect(await grantedOf(db, admin)).toEqual({
      modules: new Set(NEW_MODULES),
      permissions: new Set(wildcards(NEW_MODULES)),
      unique: true,
    });
    expect(await grantedOf(db, hq)).toEqual({
      modules: new Set(NEW_MODULES),
      permissions: new Set([
        ...wildcards(WHOLESALE),
        "dealers.wholesale-customers.*",
      ]),
      unique: true,
    });
    expect(await grantedOf(db, manager)).toEqual({
      modules: new Set([...WHOLESALE, ...CUSTOMERS.slice(0, 2)]),
      permissions: new Set(wildcards(WHOLESALE)),
      unique: true,
    });
    expect(await grantedOf(db, withoutDealers)).toEqual({
      modules: new Set(WHOLESALE),
      permissions: new Set(wildcards(WHOLESALE)),
      unique: true,
    });
    for (const role of [clerk, unowned]) {
      expect(await grantedOf(db, role)).toEqual({
        modules: new Set(),
        permissions: new Set(),
        unique: true,
      });
    }
    // 遷移先建的模組由 seed 認得、補齊(同 key 只有一筆)
    const seeded = await db
      .collection("modules")
      .find({ key: { $in: NEW_MODULES } })
      .toArray();
    expect(seeded).toHaveLength(NEW_MODULES.length);
    const wholesale = seeded.find((row) => row.key === "purchasing.wholesale");
    expect(wholesale).toMatchObject({
      name: "批售單",
      engine: "form",
      icon: "receipt",
      enabled: true,
      sidebarType: "link",
      order: 4,
    });

    // 再跑一次(不經 changelog 防重跑)也不會多
    const before = await db.collection("core_relationships").countDocuments();
    await db.collection("changelog").deleteMany({ fileName: MIGRATION });
    await update(databaseUri);
    expect(await db.collection("core_relationships").countDocuments()).toBe(
      before,
    );
  }, 300_000);
});
