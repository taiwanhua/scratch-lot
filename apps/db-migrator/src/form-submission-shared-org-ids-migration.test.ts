import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { runNode } from "../test/support/update-harness";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "project",
  "20261022120000_data_form-submission-shared-org-ids.js",
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
  uri.pathname = `/db-migrator-shared-org-ids-${String(process.pid)}-${suffix}`;
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

const zhongshan = new ObjectId("0000000000000000000f0001");
const xinyi = new ObjectId("0000000000000000000f0002");
const ref = (id: ObjectId) => ({ id: String(id), label: null });

const ids = {
  purchase: new ObjectId("0000000000000000000e0001"),
  transfer: new ObjectId("0000000000000000000e0002"),
  transferSame: new ObjectId("0000000000000000000e0003"),
  draft: new ObjectId("0000000000000000000e0004"),
  done: new ObjectId("0000000000000000000e0005"),
  broken: new ObjectId("0000000000000000000e0006"),
  otherForm: new ObjectId("0000000000000000000e0007"),
};

/** 這個欄位出現之前的提交(都沒有 `sharedOrgIds`),另有一筆已經算過的。 */
async function seedPreState(database: Db): Promise<void> {
  await database.collection("form_submissions").insertMany([
    {
      _id: ids.purchase,
      formKey: "purchase",
      status: "reviewing",
      values: { branch: ref(zhongshan) },
    },
    {
      _id: ids.transfer,
      formKey: "transfer",
      status: "completed",
      values: { from_branch: ref(zhongshan), to_branch: ref(xinyi) },
    },
    {
      _id: ids.transferSame,
      formKey: "transfer",
      status: "returned",
      values: { from_branch: ref(xinyi), to_branch: ref(xinyi) },
    },
    {
      _id: ids.draft,
      formKey: "purchase",
      status: "draft",
      values: { branch: ref(zhongshan) },
    },
    {
      _id: ids.done,
      formKey: "purchase",
      status: "completed",
      values: { branch: ref(zhongshan) },
      sharedOrgIds: [xinyi],
    },
    {
      _id: ids.broken,
      formKey: "makeup_punch",
      status: "completed",
      values: { branch: { id: "not-an-object-id", label: null } },
    },
    {
      _id: ids.otherForm,
      formKey: "support_request",
      status: "completed",
      values: { branch: ref(zhongshan) },
    },
  ]);
}

async function sharedOrgIdsOf(
  database: Db,
  id: ObjectId,
): Promise<string[] | undefined> {
  const document = await database
    .collection<{ sharedOrgIds?: ObjectId[] }>("form_submissions")
    .findOne({ _id: id });
  return document?.sharedOrgIds
    ?.map(String)
    .toSorted((left, right) => left.localeCompare(right));
}

function snapshotOf(database: Db) {
  return database
    .collection("form_submissions")
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

describe("遷移:受管表單的提交補上依欄位共用的 sharedOrgIds", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = await runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("進貨單:進貨分店", async () => {
    expect(await sharedOrgIdsOf(database, ids.purchase)).toEqual([
      String(zhongshan),
    ]);
  });

  it("調貨單:出貨店 + 收貨店(同一家只算一次)", async () => {
    expect(await sharedOrgIdsOf(database, ids.transfer)).toEqual(
      [String(zhongshan), String(xinyi)].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(await sharedOrgIdsOf(database, ids.transferSame)).toEqual([
      String(xinyi),
    ]);
  });

  it("草稿一律空;已經算過的不動", async () => {
    expect(await sharedOrgIdsOf(database, ids.draft)).toEqual([]);
    expect(await sharedOrgIdsOf(database, ids.done)).toEqual([String(xinyi)]);
  });

  it("存值不是組織 id 的略過;沒宣告依欄位共用的表單不碰", async () => {
    expect(await sharedOrgIdsOf(database, ids.broken)).toEqual([]);
    expect(await sharedOrgIdsOf(database, ids.otherForm)).toBeUndefined();
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
    expect(await snapshotOf(twice)).toEqual(await snapshotOf(once));
  }, 600_000);
});
