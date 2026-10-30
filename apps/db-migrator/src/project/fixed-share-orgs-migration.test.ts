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
  "20261029140100_cleanup_fixed-share-orgs.js",
);

/** 直接 import 遷移檔、呼叫 `up` `times` 次(驗遷移本身冪等;遷移檔是 ESM,在子行程裡跑)。 */
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

let memoryServer: MongoMemoryReplSet | undefined;
let baseUri: string;
const clients: MongoClient[] = [];

function databaseUriOf(suffix: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/db-migrator-fixed-share-orgs-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
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

const COLLECTIONS = [
  "lottery_transfer_receipts",
  "schedule_staff",
  "lottery_books",
];

describe("遷移:清單固定空的專案表拿掉 shareOrgs", () => {
  it("三張表都刪 { tenantId, shareOrgs.orgId } 索引、清掉空清單;其他索引不動;重跑不出錯", async () => {
    const databaseUri = databaseUriOf("once");
    const database = await openDatabase(databaseUri);
    const ids = new Map<string, ObjectId>();
    for (const name of COLLECTIONS) {
      const collection = database.collection(name);
      await collection.createIndex({ tenantId: 1, "shareOrgs.orgId": 1 });
      await collection.createIndex({ tenantId: 1, orgId: 1 });
      const { insertedId } = await collection.insertOne({ shareOrgs: [] });
      ids.set(name, insertedId);
    }
    const result = await runNode(
      [
        "--input-type=module",
        "-e",
        RUN_UP_DIRECTLY,
        databaseUri,
        "2",
        MIGRATION,
      ],
      { cwd: PACKAGE_ROOT },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const name of COLLECTIONS) {
      const collection = database.collection(name);
      const indexes = await collection.indexes();
      const keys = indexes.map((index) => JSON.stringify(index.key));
      expect(keys).not.toContain('{"tenantId":1,"shareOrgs.orgId":1}');
      expect(keys).toContain('{"tenantId":1,"orgId":1}');
      expect(await collection.findOne({ _id: ids.get(name) })).toEqual({
        _id: ids.get(name),
      });
    }
  }, 600_000);
});
