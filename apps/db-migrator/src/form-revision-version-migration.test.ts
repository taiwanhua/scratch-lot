import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "20260928120000_data_form-revision-version.js",
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
  uri.pathname = `/db-migrator-revision-version-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runUpDirectly(databaseUri: string, times: number) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      MIGRATION,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
}

const completedId = new ObjectId("0000000000000000000e0001");
const partialId = new ObjectId("0000000000000000000e0002");
const draftId = new ObjectId("0000000000000000000e0003");

function revision(number: number, version?: number) {
  return {
    revision: number,
    ...(version === undefined ? {} : { version }),
    values: { title: `第 ${String(number)} 版` },
    ctx: { at: new Date("2026-09-01T00:00:00Z"), timezone: "Asia/Taipei" },
  };
}

/** 補版本之前的資料:修訂沒有 `version`;一筆已有部分修訂帶版本(升級過);一筆草稿沒有修訂。 */
async function seedPreState(database: Db): Promise<void> {
  await database.collection("form_submissions").insertMany([
    {
      _id: completedId,
      formKey: "trip",
      version: 3,
      status: "completed",
      revisions: [revision(1), revision(2)],
    },
    {
      _id: partialId,
      formKey: "trip",
      version: 2,
      status: "completed",
      revisions: [revision(1, 1), revision(2)],
    },
    {
      _id: draftId,
      formKey: "trip",
      version: 1,
      status: "draft",
      revisions: [],
    },
  ]);
}

async function revisionVersionsOf(
  database: Db,
  id: ObjectId,
): Promise<unknown[]> {
  const document = await database
    .collection<{ revisions: { version?: number }[] }>("form_submissions")
    .findOne({ _id: id });
  return document?.revisions.map((entry) => entry.version) ?? [];
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

describe("遷移:修訂補上自己的版本", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("沒有版本的修訂補成整筆的 version", async () => {
    expect(await revisionVersionsOf(database, completedId)).toEqual([3, 3]);
  });

  it("已有版本的修訂不動,只補沒有的", async () => {
    expect(await revisionVersionsOf(database, partialId)).toEqual([1, 2]);
  });

  it("修訂的其他內容不變", async () => {
    const document = await database
      .collection<{ revisions: Record<string, unknown>[] }>("form_submissions")
      .findOne({ _id: completedId });

    expect(document?.revisions[0]).toMatchObject({
      revision: 1,
      values: { title: "第 1 版" },
      ctx: { timezone: "Asia/Taipei" },
    });
  });

  it("沒有修訂的草稿不動", async () => {
    expect(await revisionVersionsOf(database, draftId)).toEqual([]);
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

    runUpDirectly(onceUri, 1);
    const result = runUpDirectly(twiceUri, 2);

    expect(result.status).toBe(0);
    expect(await snapshotOf(twice)).toEqual(await snapshotOf(once));
  }, 600_000);
});
