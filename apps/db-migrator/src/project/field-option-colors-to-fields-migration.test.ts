import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { runNode } from "../../test/support/update-harness";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "project",
  "20261029120000_data_field-option-colors-to-fields.js",
);
const SOURCE = "project_field_option_colors";

/**
 * 直接 import 遷移檔、呼叫 `up` `times` 次(不經 migrate-mongo 的 changelog 防重跑)——
 * 驗的是遷移**本身**冪等。遷移檔是 ESM,jest 這邊是 CJS,所以在子行程裡跑。
 */
const RUN_UP_DIRECTLY = `
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
const [uri, times, file] = process.argv.slice(1);
const client = await MongoClient.connect(uri);
try {
  const migration = await import(pathToFileURL(file).href);
  for (let round = 0; round < Number(times); round += 1) {
    await migration.up(client.db());
  }
} finally {
  await client.close();
}
`;

/** 沿用 jest globalSetup 起的單一成員 replica set(MONGODB_URI);沒有時自起 MongoMemoryReplSet。 */
let memoryServer: MongoMemoryReplSet | undefined;
let baseUri: string;
const clients: MongoClient[] = [];

function databaseUriOf(suffix: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/db-migrator-field-option-colors-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runUpDirectly(databaseUri: string, times: number) {
  return runNode(
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      MIGRATION,
    ],
    { cwd: PACKAGE_ROOT },
  );
}

const rootOrg = new ObjectId("0000000000000000000a0001");
const tenant = new ObjectId("0000000000000000000a0002");
const branch = new ObjectId("0000000000000000000a0003");
const category = new ObjectId("0000000000000000000c0001");
const fieldIds = {
  /** 全域選項,根組織設了藍色 */
  globalBlue: new ObjectId("0000000000000000000f0001"),
  /** 全域選項,根組織清掉過(paletteKey null) */
  globalCleared: new ObjectId("0000000000000000000f0002"),
  /** 全域選項,從沒設過顏色 */
  globalNone: new ObjectId("0000000000000000000f0003"),
  /** 租戶自訂,租戶設了綠色;另有一筆分店設的(不是擁有者,不搬) */
  tenantGreen: new ObjectId("0000000000000000000f0004"),
  /** 分店自訂,代號認不得(色碼) */
  branchLegacy: new ObjectId("0000000000000000000f0005"),
  /** 全域選項,新版已經設過紅色(欄位已存在),舊表是黃色 */
  alreadyRed: new ObjectId("0000000000000000000f0006"),
  /** 全域選項,舊表那一筆已軟刪除 */
  deletedColor: new ObjectId("0000000000000000000f0007"),
};
/** 舊表有、選項已不存在 */
const missingFieldId = new ObjectId("0000000000000000000f0099");

/** 一筆選項(升格前沒有 `color`)。 */
const option = (
  _id: ObjectId,
  value: string,
  orgId: ObjectId | null,
  extra: Record<string, unknown> = {},
) => ({
  _id,
  categoryId: category,
  orgId,
  label: value,
  value,
  order: 1,
  enabled: true,
  isSystem: orgId === null,
  deletedAt: null,
  ...extra,
});
/** 舊表的一筆顏色。 */
const color = (
  fieldId: ObjectId,
  orgId: ObjectId,
  tenantId: ObjectId | null,
  paletteKey: string | null,
  extra: Record<string, unknown> = {},
) => ({ fieldId, orgId, tenantId, paletteKey, deletedAt: null, ...extra });

/** 升格前的資料:選項(`fields`)沒有 `color`,顏色在專案表。 */
async function seedPreState(database: Db): Promise<void> {
  await database
    .collection("fields")
    .insertMany([
      option(fieldIds.globalBlue, "global-blue", null),
      option(fieldIds.globalCleared, "global-cleared", null),
      option(fieldIds.globalNone, "global-none", null),
      option(fieldIds.tenantGreen, "tenant-green", tenant),
      option(fieldIds.branchLegacy, "branch-legacy", branch),
      option(fieldIds.alreadyRed, "already-red", null, { color: "red" }),
      option(fieldIds.deletedColor, "deleted-color", null),
    ]);
  await database.collection(SOURCE).insertMany([
    color(fieldIds.globalBlue, rootOrg, null, "blue"),
    color(fieldIds.globalCleared, rootOrg, null, null),
    color(fieldIds.tenantGreen, tenant, tenant, "green"),
    color(fieldIds.tenantGreen, branch, tenant, "pink"),
    color(fieldIds.branchLegacy, branch, tenant, "#FFA500"),
    color(fieldIds.alreadyRed, rootOrg, null, "yellow"),
    color(fieldIds.deletedColor, rootOrg, null, "purple", {
      deletedAt: new Date(),
    }),
    color(missingFieldId, rootOrg, null, "cyan"),
  ]);
}

async function fieldOf(
  database: Db,
  id: ObjectId,
): Promise<Record<string, unknown> | null> {
  return database.collection("fields").findOne({ _id: id });
}

async function hasSource(database: Db): Promise<boolean> {
  return database.listCollections({ name: SOURCE }).hasNext();
}

function snapshotOf(database: Db) {
  return database
    .collection("fields")
    .find({}, { sort: { _id: 1 } })
    .toArray();
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
  for (const client of clients) {
    await client.db().dropDatabase();
    await client.close();
  }
  await memoryServer?.stop();
}, 60_000);

describe("遷移:欄位選項顏色搬進 fields.color", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = await runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("擁有者設的顏色照搬:全域選項取根組織那筆、自訂選項取加它的那一層", async () => {
    const globalBlue = await fieldOf(database, fieldIds.globalBlue);
    expect(globalBlue).toHaveProperty("color", "blue");
    const tenantGreen = await fieldOf(database, fieldIds.tenantGreen);
    expect(tenantGreen).toHaveProperty("color", "green");
  });

  it("清掉過的寫成 null(欄位存在);認不得的代號也寫 null", async () => {
    const cleared = await fieldOf(database, fieldIds.globalCleared);
    expect(cleared).toHaveProperty("color", null);
    const legacy = await fieldOf(database, fieldIds.branchLegacy);
    expect(legacy).toHaveProperty("color", null);
  });

  it("沒設過、舊表已軟刪除的不寫欄位;新版已設過的以新版為準", async () => {
    expect(await fieldOf(database, fieldIds.globalNone)).not.toHaveProperty(
      "color",
    );
    expect(await fieldOf(database, fieldIds.deletedColor)).not.toHaveProperty(
      "color",
    );
    const alreadyRed = await fieldOf(database, fieldIds.alreadyRed);
    expect(alreadyRed).toHaveProperty("color", "red");
  });

  it("選項已不存在的不會被建出來;搬完刪掉專案表", async () => {
    expect(await fieldOf(database, missingFieldId)).toBeNull();
    expect(await hasSource(database)).toBe(false);
  });
});

describe("遷移冪等", () => {
  it("跑兩次的結果與跑一次相同", async () => {
    const onceUri = databaseUriOf("idempotent-once");
    const twiceUri = databaseUriOf("idempotent-twice");
    const once = await openDatabase(onceUri);
    const twice = await openDatabase(twiceUri);
    await seedPreState(once);
    await seedPreState(twice);

    await runUpDirectly(onceUri, 1);
    const result = await runUpDirectly(twiceUri, 2);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(await snapshotOf(twice)).toEqual(await snapshotOf(once));
  }, 600_000);

  it("沒有專案表的環境(新環境、已搬過)什麼都不做", async () => {
    const uri = databaseUriOf("no-source");
    const database = await openDatabase(uri);
    await database.collection("fields").insertOne({ value: "x", orgId: null });
    const before = await snapshotOf(database);

    const result = await runUpDirectly(uri, 1);

    expect(result.status).toBe(0);
    expect(await snapshotOf(database)).toEqual(before);
  }, 600_000);
});
