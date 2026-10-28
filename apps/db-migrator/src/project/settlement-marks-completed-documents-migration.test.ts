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
  "20261028130000_data_settlement-marks-completed-documents.js",
);

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
  uri.pathname = `/db-migrator-settlement-marks-${String(process.pid)}-${suffix}`;
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

const tenant = new ObjectId("0000000000000000000f0001");
const store = new ObjectId("0000000000000000000f0002");
const ids = {
  purchase: new ObjectId("0000000000000000000c0001"),
  transfer: new ObjectId("0000000000000000000c0002"),
  reviewing: new ObjectId("0000000000000000000c0003"),
  deleted: new ObjectId("0000000000000000000c0004"),
  otherModule: new ObjectId("0000000000000000000c0005"),
  marked: new ObjectId("0000000000000000000c0006"),
};
const closedAsOf = new Date("2026-10-20T00:00:00.000Z");

/** 結清標記出現之前:已完成的進貨單 / 調貨單、審核中、已軟刪除、別的模組,另有一筆已經有標記(已結清)的。 */
async function seedPreState(database: Db): Promise<void> {
  const submission = (
    _id: ObjectId,
    moduleKey: string,
    status: string,
    deletedAt: Date | null = null,
  ) => ({ _id, orgId: store, tenantId: tenant, moduleKey, status, deletedAt });
  await database
    .collection("form_submissions")
    .insertMany([
      submission(ids.purchase, "purchasing.purchase", "completed"),
      submission(ids.transfer, "purchasing.transfer", "completed"),
      submission(ids.reviewing, "purchasing.purchase", "reviewing"),
      submission(ids.deleted, "purchasing.purchase", "completed", closedAsOf),
      submission(ids.otherModule, "store.checkout", "completed"),
      submission(ids.marked, "purchasing.transfer", "completed"),
    ]);
  await database.collection("lottery_settlement_marks").insertOne({
    orgId: store,
    tenantId: tenant,
    refType: "purchasing.transfer",
    refId: ids.marked,
    closedAsOf,
    rev: 3,
    moduleKey: "accounts",
  });
}

/** 標記(不含 `_id` 與建立時間,冪等比對用)。 */
async function marksOf(database: Db) {
  const rows = await database
    .collection("lottery_settlement_marks")
    .find({}, { sort: { refId: 1 }, projection: { _id: 0 } })
    .toArray();
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => key !== "createdAt" && key !== "updatedAt",
      ),
    ),
  );
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

describe("遷移:已完成的進貨單 / 調貨單補上結清標記", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = await runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("已完成、沒軟刪除的進貨單 / 調貨單 → 一筆待確認的標記;已有標記的不動;其他不建", async () => {
    expect(await marksOf(database)).toEqual([
      {
        orgId: store,
        tenantId: tenant,
        refType: "purchasing.purchase",
        refId: ids.purchase,
        closedAsOf: null,
        rev: 0,
        moduleKey: "accounts",
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      },
      {
        orgId: store,
        tenantId: tenant,
        refType: "purchasing.transfer",
        refId: ids.transfer,
        closedAsOf: null,
        rev: 0,
        moduleKey: "accounts",
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      },
      {
        orgId: store,
        tenantId: tenant,
        refType: "purchasing.transfer",
        refId: ids.marked,
        closedAsOf,
        rev: 3,
        moduleKey: "accounts",
      },
    ]);
  });

  it("refId 唯一索引(與 schema 宣告相同)", async () => {
    const indexes = await database
      .collection("lottery_settlement_marks")
      .indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { refId: 1 }, unique: true }),
      ]),
    );
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

    expect(result.status).toBe(0);
    expect(await marksOf(twice)).toEqual(await marksOf(once));
  }, 600_000);
});
