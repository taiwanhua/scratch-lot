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
  "20261027120000_schema_transfer-receipts-per-ticket.js",
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
  uri.pathname = `/db-migrator-transfer-receipts-${String(process.pid)}-${suffix}`;
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

describe("遷移:調貨點收紀錄一列可以有好幾筆", () => {
  it("拿掉 (submissionId, rowId) 唯一索引、換成一般索引;重跑不出錯", async () => {
    const databaseUri = databaseUriOf("once");
    const database = await openDatabase(databaseUri);
    const receipts = database.collection("lottery_transfer_receipts");
    await receipts.createIndex(
      { submissionId: 1, rowId: 1 },
      {
        unique: true,
        partialFilterExpression: { deletedAt: { $type: "null" } },
      },
    );
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
    const indexes = await receipts.indexes();
    const index = indexes.find(
      (item) => JSON.stringify(item.key) === '{"submissionId":1,"rowId":1}',
    );
    expect(index).toBeDefined();
    expect(index?.unique).not.toBe(true);
    const submissionId = new ObjectId();
    await receipts.insertMany([
      { submissionId, rowId: "r1", deletedAt: null },
      { submissionId, rowId: "r1", deletedAt: null },
    ]);
    expect(await receipts.countDocuments({ submissionId })).toBe(2);
  }, 600_000);
});
