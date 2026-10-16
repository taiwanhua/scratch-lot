import { MongoMemoryReplSet } from "mongodb-memory-server";

/** globalSetup 起的 replica set;同一個 jest 主行程的 globalTeardown 取回來關掉。 */
const REPL_SET_KEY = "__DB_MIGRATOR_TEST_MONGO_REPL_SET__";

/**
 * jest globalSetup:整次測試共用一個**單一成員 replica set**(`MongoMemoryReplSet`),以 `MONGODB_URI`
 * 交給測試 —— 與 api 的測試、正式環境(Atlas)同為 replica set,大批次遷移的「每批一個交易」才測得到。
 * 外部已給 `MONGODB_URI`(須是 replica set)就沿用它,不另起;各測試仍以自己的資料庫名隔離。
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MONGODB_URI) {
    return;
  }
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (globalThis as Record<string, unknown>)[REPL_SET_KEY] = replSet;
  process.env.MONGODB_URI = replSet.getUri();
}

export async function stopGlobalReplSet(): Promise<void> {
  const replSet = (globalThis as Record<string, unknown>)[REPL_SET_KEY] as
    MongoMemoryReplSet | undefined;
  await replSet?.stop();
}
