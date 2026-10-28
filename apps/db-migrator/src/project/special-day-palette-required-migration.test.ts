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
  "20261028120000_data_special-day-palette-required.js",
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
  uri.pathname = `/db-migrator-special-day-palette-${String(process.pid)}-${suffix}`;
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

const org = new ObjectId("0000000000000000000f0001");
const ids = {
  nullColor: new ObjectId("0000000000000000000d0001"),
  missingColor: new ObjectId("0000000000000000000d0002"),
  grey: new ObjectId("0000000000000000000d0003"),
  cyan: new ObjectId("0000000000000000000d0004"),
  closed: new ObjectId("0000000000000000000d0005"),
  deleted: new ObjectId("0000000000000000000d0006"),
};
const day = (n: number) => new Date(Date.UTC(2026, 10, n - 1, 16));

/** 顏色必選之前的行事曆:特殊日沒顏色 / 缺欄位 / 灰色 / 青色,店休,已軟刪除的沒顏色特殊日。 */
async function seedPreState(database: Db): Promise<void> {
  const special = {
    orgId: org,
    type: "special",
    category: "event-day",
    name: "活動",
    note: null,
    deletedAt: null,
  };
  await database.collection("schedule_calendar_days").insertMany([
    { _id: ids.nullColor, ...special, date: day(1), paletteKey: null },
    { _id: ids.missingColor, ...special, date: day(2) },
    { _id: ids.grey, ...special, date: day(3), paletteKey: "grey" },
    { _id: ids.cyan, ...special, date: day(4), paletteKey: "cyan" },
    {
      _id: ids.closed,
      orgId: org,
      type: "closed",
      category: null,
      name: null,
      note: null,
      date: day(5),
      paletteKey: null,
      deletedAt: null,
    },
    {
      _id: ids.deleted,
      ...special,
      date: day(6),
      paletteKey: null,
      deletedAt: day(7),
    },
  ]);
}

async function paletteKeyOf(database: Db, id: ObjectId): Promise<unknown> {
  const document = await database
    .collection<{ paletteKey?: string | null }>("schedule_calendar_days")
    .findOne({ _id: id });
  return document?.paletteKey;
}

function snapshotOf(database: Db) {
  return database
    .collection("schedule_calendar_days")
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

describe("遷移:特殊日沒顏色或灰色 → 藍色", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = await runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("沒顏色(null / 缺欄位)、灰色、已軟刪除的沒顏色 → blue", async () => {
    for (const id of [ids.nullColor, ids.missingColor, ids.grey, ids.deleted]) {
      expect(await paletteKeyOf(database, id)).toBe("blue");
    }
  });

  it("已選其他顏色的不動;店休仍是 null", async () => {
    expect(await paletteKeyOf(database, ids.cyan)).toBe("cyan");
    expect(await paletteKeyOf(database, ids.closed)).toBeNull();
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
