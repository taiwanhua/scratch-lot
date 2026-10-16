/**
 * update 指令測試的共用工具:拋棄式 MongoDB、以子行程跑指令、讀資料庫最終狀態。
 * 測試檔只寫行為。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { type Db, type Document, MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const TSX_CLI = path.join(
  PACKAGE_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
export const UPDATE_ENTRY = path.join(PACKAGE_ROOT, "src", "update", "run.ts");
export const SEED_ENTRY = path.join(PACKAGE_ROOT, "src", "seed", "run.ts");
/** 可以讓指定檢查點中斷的入口(見該檔)。 */
export const FAULT_ENTRY = path.join(
  PACKAGE_ROOT,
  "test",
  "support",
  "update-fault-entry.ts",
);

const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const TURBO_CLI = path.join(REPO_ROOT, "node_modules", "turbo", "bin", "turbo");
/** api 建置後的受管定義 CLI(update 以子程序呼叫的那一支)。 */
export const DEFINITION_CLI = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "dist",
  "seed",
  "run.js",
);

/** 建置(turbo 連依賴一起)可能要幾分鐘。 */
export const BUILD_TIMEOUT_MS = 600_000;

/**
 * 建置 api 與它的 workspace 依賴(同一個 checkout 的產物),不依賴本機恰好留著的 dist。
 * 會發布定義的測試在 `beforeAll` 呼叫;turbo 快取命中時只要幾秒。
 */
export async function buildDefinitionCli(): Promise<void> {
  const child = spawn(
    process.execPath,
    [TURBO_CLI, "run", "build", "--filter=@repo/api"],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
  }
  const status = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (status !== 0 || !existsSync(DEFINITION_CLI)) {
    throw new Error(
      `建置 api 失敗(status ${String(status)}):${output.slice(-3000)}`,
    );
  }
}

/** 測試用 root 初始帳號;密碼為測試假值。 */
export const ROOT_ADMIN_ENV = {
  ROOT_ADMIN_ACCOUNT: "root-admin",
  ROOT_ADMIN_EMAIL: "root-admin@example.com",
  ROOT_ADMIN_PASSWORD: ["initial", "secret", "123"].join("-"),
};

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunningCommand {
  /** 子行程結束後的結果。 */
  done: Promise<CommandResult>;
  kill: () => void;
}

/**
 * 以子行程跑 node(`args` 照給)。非同步 spawn(不是 spawnSync):本機的 mongodb-memory-server 是這個測試行程的
 * 子程序,它的輸出靠測試行程的事件迴圈讀;事件迴圈被擋住時管線塞滿、mongod 停住,子行程連不上資料庫
 * (`Server selection timed out`)或跟著卡住。對資料庫跑子行程的測試一律走這裡,不用 spawnSync。
 */
export function startNode(
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): RunningCommand {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? PACKAGE_ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  return {
    done: new Promise<CommandResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (status) => {
        resolve({ status, stdout, stderr });
      });
    }),
    kill: () => {
      child.kill();
    },
  };
}

/** {@link startNode} 跑完的結果。 */
export function runNode(
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return startNode(args, options).done;
}

/** 以子行程跑一支 tsx 入口(帶 root 初始帳號與 `MONGODB_URI`)。 */
export function startEntry(
  entry: string,
  args: readonly string[],
  databaseUri: string,
  env: Record<string, string | undefined> = {},
): RunningCommand {
  return startNode([TSX_CLI, entry, ...args], {
    env: {
      ...process.env,
      ...ROOT_ADMIN_ENV,
      MONGODB_URI: databaseUri,
      ...env,
    },
  });
}

/** 跑 update 指令(等同 `pnpm --filter @repo/db-migrator run update …`)。 */
export function runUpdate(
  databaseUri: string,
  args: readonly string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<CommandResult> {
  return startEntry(UPDATE_ENTRY, args, databaseUri, env).done;
}

/**
 * 跑 update,並讓指定的檢查點中斷。`fault` 是 `<檢查點>` 或 `<檢查點>@<對象的片段>`;
 * `mode`:`throw` = 那一步丟錯(程序正常失敗、釋放鎖),`exit` = 直接結束程序(硬中止,鎖留著)。
 */
export function runUpdateWithFault(
  databaseUri: string,
  args: readonly string[],
  fault: string,
  mode: "throw" | "exit" = "throw",
): Promise<CommandResult> {
  return startEntry(FAULT_ENTRY, [fault, mode, ...args], databaseUri).done;
}

/** 硬中止(`exit`)時程序的結束碼。 */
export const HARD_ABORT_EXIT_CODE = 86;

/** 夾具的來源目錄(裡面是 `seeds/` 與 `migrations/`)。 */
export function fixtureSourceRoot(...segments: string[]): string {
  return path.join(PACKAGE_ROOT, "test", "fixtures", ...segments);
}

/**
 * 空專案來源的夾具 registry(`test/fixtures/seeds-base/`:只有底座、沒有任何定義),寫成指令參數。
 * 驗底座固定內容或「沒有登記定義」的案例用它,不用正式的 `seeds/registry.ts`(引用專案會在那裡登記自己的內容);
 * migration 仍是正式來源的那幾支。
 */
export const BASE_ONLY_REGISTRY = `--registry=${fixtureSourceRoot("seeds-base", "registry.ts")}`;

/** 沿用 jest globalSetup 起的單一成員 replica set(MONGODB_URI);沒有時自起 MongoMemoryReplSet。 */
export class TestMongo {
  private memoryServer: MongoMemoryReplSet | undefined;
  private baseUri = "";
  private readonly used: string[] = [];

  constructor(private readonly prefix: string) {}

  async start(): Promise<void> {
    if (process.env.MONGODB_URI) {
      this.baseUri = process.env.MONGODB_URI;
      return;
    }
    this.memoryServer = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    this.baseUri = this.memoryServer.getUri();
  }

  /** 一個測試案例專用的資料庫。 */
  uri(suffix: string): string {
    const uri = new URL(this.baseUri);
    uri.pathname = `/${this.prefix}-${String(process.pid)}-${suffix}`;
    this.used.push(uri.toString());
    return uri.toString();
  }

  async stop(): Promise<void> {
    for (const databaseUri of this.used) {
      await withDatabase(databaseUri, (database) => database.dropDatabase());
    }
    await this.memoryServer?.stop();
  }
}

export async function withDatabase<T>(
  databaseUri: string,
  work: (database: Db) => Promise<T>,
): Promise<T> {
  const client = await MongoClient.connect(databaseUri);
  try {
    return await work(client.db());
  } finally {
    await client.close();
  }
}

export function collectionNames(databaseUri: string): Promise<string[]> {
  return withDatabase(databaseUri, async (database) => {
    const collections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();
    return collections
      .map(({ name }) => name)
      .toSorted((left, right) => left.localeCompare(right, "zh-Hant"));
  });
}

/** 一個 collection 裡符合條件的文件(預設依 `_id`,也就是建立順序)。 */
export function documentsOf(
  databaseUri: string,
  collection: string,
  query: Document = {},
  sortField = "_id",
): Promise<Document[]> {
  return withDatabase(databaseUri, (database) => {
    // eslint-disable-next-line unicorn/no-array-callback-reference -- mongodb driver 的 `find` 收的是 filter 不是 callback
    const cursor = database.collection(collection).find(query);
    return cursor.sort({ [sortField]: 1 }).toArray();
  });
}

/** changelog 的全部紀錄(依 fileName)。 */
export function changelogOf(databaseUri: string): Promise<Document[]> {
  return documentsOf(databaseUri, "changelog", {}, "fileName");
}

/** `seed_update_runs` 裡某一類的紀錄(依建立順序)。 */
export function journalOf(
  databaseUri: string,
  type: "run" | "migration" | "unlock",
): Promise<Document[]> {
  return documentsOf(databaseUri, "seed_update_runs", { type });
}

/** 每個 collection 的全部文件:前後完全相同 = 一筆都沒寫、沒改、沒刪,也沒有多出 collection。 */
export function dumpDatabase(
  databaseUri: string,
): Promise<Record<string, Document[]>> {
  return withDatabase(databaseUri, async (database) => {
    const collections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();
    const names = collections
      .map(({ name }) => name)
      .toSorted((left, right) => left.localeCompare(right, "zh-Hant"));
    const dump: Record<string, Document[]> = {};
    for (const name of names) {
      const cursor = database.collection(name).find();
      dump[name] = await cursor.sort({ _id: 1 }).toArray();
    }
    return dump;
  });
}

export function lockOf(databaseUri: string): Promise<Document | null> {
  return withDatabase(databaseUri, (database) =>
    database
      .collection<{ _id: string }>("changelog_lock")
      .findOne({ _id: "seed-update" }),
  );
}
