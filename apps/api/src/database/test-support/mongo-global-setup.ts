import { MongoMemoryReplSet } from "mongodb-memory-server";

/** globalSetup 起的 replica set;同一個 jest 主行程的 globalTeardown 取回來關掉。 */
const REPL_SET_KEY = "__API_TEST_MONGO_REPL_SET__";

/**
 * jest globalSetup:整次測試共用一個**單一成員 replica set**(`MongoMemoryReplSet`),
 * 以 `MONGODB_URI` 交給各 worker —— 交易(`TransactionService.withTransaction`)只能跑在 replica set 上。
 * 本機與 CI 同一套;外部已給 `MONGODB_URI`(須是 replica set)就沿用它,不另起。
 * 各測試檔仍以自己的 databaseName 隔離(`openTestDatabase`、`startAuthTestApp`)。
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MONGODB_URI) {
    return;
  }
  const replSet = await startTestReplSet();
  (globalThis as Record<string, unknown>)[REPL_SET_KEY] = replSet;
  process.env.MONGODB_URI = replSet.getUri();
}

export async function stopGlobalReplSet(): Promise<void> {
  const replSet = (globalThis as Record<string, unknown>)[REPL_SET_KEY] as
    MongoMemoryReplSet | undefined;
  await replSet?.stop();
}

/** 單一成員 replica set(本機測試用;交易需要 replica set,單節點 mongod 不支援)。 */
export function startTestReplSet(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({ replSet: { count: 1 } });
}
