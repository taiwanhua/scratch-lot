import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "20260929120000_data_data-scope-date-instants.js",
);

/**
 * 直接 import 遷移檔、呼叫 `up`(或 `down`)`times` 次(不經 migrate-mongo 的 changelog 防重跑)——
 * 驗的是遷移**本身**冪等。遷移檔是 ESM,jest 這邊是 CJS,所以在子行程裡跑。
 */
const RUN_UP_DIRECTLY = `
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
const [uri, times, file, method = "up"] = process.argv.slice(1);
const client = await MongoClient.connect(uri);
try {
  const migration = await import(pathToFileURL(file).href);
  for (let round = 0; round < Number(times); round += 1) {
    await migration[method](client.db());
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
  uri.pathname = `/db-migrator-data-scope-date-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runUpDirectly(
  databaseUri: string,
  times: number,
  method: "up" | "down" = "up",
) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      MIGRATION,
      method,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
}

const ruleId = new ObjectId("0000000000000000000f0001");
const ownerId = "0000000000000000000f0099";

function leaf(field: string, cond: string, values: string[]) {
  return { field, cond, value: { kind: "static", values } };
}

/** 改存時點之前的規則:日期條件是 `YYYY-MM-DD`;巢狀群組裡也有一條;已是 ISO 的與非日期條件不該動。 */
async function seedPreState(
  database: Db,
  rootTimezone: string | null,
): Promise<void> {
  await database.collection("orgs").insertOne({
    parentId: null,
    ancestors: [],
    name: "根組織",
    settings: rootTimezone === null ? {} : { timezone: rootTimezone },
  });
  await database.collection("data_scope_rules").insertOne({
    _id: ruleId,
    collection: "demo_items_one",
    moduleKey: "demo.sub.sample-one",
    combineOp: "OR",
    rules: [
      {
        audience: { type: "all" },
        filter: {
          op: "AND",
          children: [
            leaf("createdAt", "between", ["2026-01-01", "2026-12-31"]),
            {
              op: "OR",
              children: [
                leaf("updatedAt", "before", ["2026-03-01"]),
                leaf("createdBy", "in", [ownerId]),
              ],
            },
            leaf("updatedAt", "after", ["2026-06-30T16:00:00.000Z"]),
          ],
        },
      },
    ],
  });
}

async function filterOf(database: Db): Promise<unknown> {
  const document = await database
    .collection<{ rules: { filter: unknown }[] }>("data_scope_rules")
    .findOne({ _id: ruleId });
  return document?.rules[0]?.filter;
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

describe("遷移:資料範圍規則的日期條件值改存時點", () => {
  it("根組織沒設時區:`YYYY-MM-DD` 換成台北那一天 00:00 的 ISO;巢狀條件也換;已是 ISO 與非日期條件不動", async () => {
    const databaseUri = databaseUriOf("taipei");
    const database = await openDatabase(databaseUri);
    await seedPreState(database, null);

    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    expect(await filterOf(database)).toEqual({
      op: "AND",
      children: [
        leaf("createdAt", "between", [
          "2025-12-31T16:00:00.000Z",
          "2026-12-30T16:00:00.000Z",
        ]),
        {
          op: "OR",
          children: [
            leaf("updatedAt", "before", ["2026-02-28T16:00:00.000Z"]),
            leaf("createdBy", "in", [ownerId]),
          ],
        },
        leaf("updatedAt", "after", ["2026-06-30T16:00:00.000Z"]),
      ],
    });
  }, 600_000);

  it("以根組織的時區換算(規則屬於根組織)", async () => {
    const databaseUri = databaseUriOf("new-york");
    const database = await openDatabase(databaseUri);
    await seedPreState(database, "America/New_York");

    expect(runUpDirectly(databaseUri, 1).status).toBe(0);

    const filter = (await filterOf(database)) as {
      children: { value?: { values: string[] } }[];
    };
    const [between] = filter.children;
    // 紐約 1 月是 UTC-5
    expect(between?.value?.values[0]).toBe("2026-01-01T05:00:00.000Z");
  }, 600_000);

  it("down:時點換回根組織時區的 `YYYY-MM-DD`;非日期條件不動", async () => {
    const databaseUri = databaseUriOf("down");
    const database = await openDatabase(databaseUri);
    await seedPreState(database, null);

    expect(runUpDirectly(databaseUri, 1).status).toBe(0);
    const result = runUpDirectly(databaseUri, 1, "down");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    expect(await filterOf(database)).toEqual({
      op: "AND",
      children: [
        leaf("createdAt", "between", ["2026-01-01", "2026-12-31"]),
        {
          op: "OR",
          children: [
            leaf("updatedAt", "before", ["2026-03-01"]),
            leaf("createdBy", "in", [ownerId]),
          ],
        },
        // 遷移前就是時點的值分不出來,一併換回日期(台北 07-01 00:00)
        leaf("updatedAt", "after", ["2026-07-01"]),
      ],
    });
  }, 600_000);

  it("冪等:跑兩次的結果與跑一次相同", async () => {
    const onceUri = databaseUriOf("idempotent-once");
    const twiceUri = databaseUriOf("idempotent-twice");
    const once = await openDatabase(onceUri);
    const twice = await openDatabase(twiceUri);
    await seedPreState(once, null);
    await seedPreState(twice, null);

    runUpDirectly(onceUri, 1);
    const result = runUpDirectly(twiceUri, 2);

    expect(result.status).toBe(0);
    expect(await filterOf(twice)).toEqual(await filterOf(once));
  }, 600_000);
});
