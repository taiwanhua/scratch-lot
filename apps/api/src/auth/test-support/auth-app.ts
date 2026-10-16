import { spawn } from "node:child_process";
import path from "node:path";

import type { INestApplication, Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Connection } from "mongoose";
import request from "supertest";

/** db-migrator 套件根目錄(以子行程跑其 seed 指令,不 import — STRUCT-01 禁 app 互 import)。 */
const DB_MIGRATOR_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "db-migrator",
);
const TSX_CLI = path.join(
  DB_MIGRATOR_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const SEED_ENTRY = path.join(DB_MIGRATOR_ROOT, "src", "seed", "run.ts");
const UPDATE_ENTRY = path.join(DB_MIGRATOR_ROOT, "src", "update", "run.ts");

/**
 * db-migrator 的空專案來源夾具 registry(`test/fixtures/seeds-base/`:只有底座、沒有任何定義),寫成指令參數。
 * api 的測試驗的是底座的行為,測試資料庫一律以這份夾具種,不讀正式的 `seeds/registry.ts`:
 * 引用專案在 `seeds/project/` 登記的模組、種子與定義不會混進這些測試的資料,
 * 也不會讓 seed 需要 api 的建置產物。migration 仍是正式來源的那幾支。
 */
export const BASE_ONLY_REGISTRY = `--registry=${path.join(DB_MIGRATOR_ROOT, "test", "fixtures", "seeds-base", "registry.ts")}`;

/** db-migrator 指令的結果(只給要驗指令行為的測試看)。 */
export interface MigratorResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** 子行程逾時:卡住就明確報錯,並把 stdout 尾端一起帶出來方便查(CI 曾因子行程卡住掛好幾小時)。 */
const MIGRATOR_TIMEOUT_MS = 180_000;

/**
 * 以非同步子行程跑 db-migrator 的指令(tsx 入口 + 參數),收齊 stdout / stderr 後回結果。
 * 不用 spawnSync:本機的 mongodb-memory-server 是測試行程的子程序,它的輸出靠測試行程的事件迴圈讀;
 * spawnSync 期間事件迴圈被擋住,mongod 的輸出管線塞滿後 mongod 停住,子行程連不上資料庫
 * (`Server selection timed out`)。與 seed-cli.test.ts 的 CLI 子程序同一個理由。
 */
function runMigrator(
  args: readonly string[],
  databaseUri: string,
): Promise<MigratorResult> {
  return new Promise<MigratorResult>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, ...args], {
      cwd: DB_MIGRATOR_ROOT,
      env: migratorEnv(databaseUri),
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
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `db-migrator 子行程逾時:${stderr}
${stdout.slice(-2000)}`,
        ),
      );
    }, MIGRATOR_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`db-migrator 子行程失敗(${error.message}):${stderr}`));
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function migratorEnv(databaseUri: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MONGODB_URI: databaseUri,
    ROOT_ADMIN_ACCOUNT: ROOT_ADMIN.account,
    ROOT_ADMIN_EMAIL: ROOT_ADMIN.email,
    ROOT_ADMIN_PASSWORD: ROOT_ADMIN.password,
  };
}

/**
 * 以子行程跑 db-migrator 的 update 指令(`args` 如 `["--down"]`、`["--status"]`),回結果不丟錯:
 * 給要驗「指令在這個資料庫狀態下被拒絕 / 放行」的測試用。
 */
export function runMigratorUpdate(
  databaseUri: string,
  args: readonly string[],
): Promise<MigratorResult> {
  return runMigrator([UPDATE_ENTRY, BASE_ONLY_REGISTRY, ...args], databaseUri);
}

/** 測試用 root 初始帳號(正式環境自 Secret Manager 注入,ADR-0002);密碼為測試假值。 */
export const ROOT_ADMIN = {
  account: "root-admin",
  email: "root-admin@example.com",
  password: ["initial", "secret", "123"].join("-"),
};

/** 測試自備的 JWT 密鑰(正式環境自 Secret Manager 注入)。 */
export const TEST_JWT_SECRET = "test-jwt-secret-not-for-production";

export const REFRESH_COOKIE_NAME = "refresh_token";

export interface GraphqlCallOptions {
  accessToken?: string;
  cookie?: string;
}

export interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

export interface GraphqlResult<TData = Record<string, unknown>> {
  status: number;
  data: TData | null;
  errors: GraphqlError[] | undefined;
  /** 回應的 Set-Cookie 標頭(每個 cookie 一條)。 */
  setCookies: string[];
}

export interface AuthTestApp {
  app: INestApplication;
  /** 直接操作測試資料庫的 Mongoose 連線(只用於準備夾具與驗證最終狀態)。 */
  connection: Connection;
  graphql: <TData = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    options?: GraphqlCallOptions,
  ) => Promise<GraphqlResult<TData>>;
  /**
   * 對**這個測試 app 自己的資料庫**再跑一次 seed(模擬一般部署的 update:migration → 種子),
   * 用來驗「人經 API 改過的值,重跑 seed 後還在」。資料庫由 harness 自己決定,不收外部 URI。
   */
  reseed: () => Promise<void>;
  /** 對這個測試 app 自己的資料庫跑 db-migrator 的 update 指令(帶參數),回結果不丟錯。 */
  runUpdate: (args: readonly string[]) => Promise<MigratorResult>;
  close: () => Promise<void>;
}

export function buildDatabaseUri(
  baseUri: string,
  databaseName: string,
): string {
  const uri = new URL(baseUri);
  uri.pathname = `/${databaseName}`;
  return uri.toString();
}

/**
 * 以子行程跑 db-migrator 的 seed 指令,對測試資料庫種 root 帳號 / 根組織 / 種子角色。
 * seed 是 update 的相容別名:同一次執行先跑尚未成功的 migration、再同步種子(與一般部署同一條路),
 * 自己取得並釋放整批互斥鎖。種的是空專案來源的夾具 registry:沒有登記受管定義,不需要 api 的建置產物。
 */
export async function seedDatabase(databaseUri: string): Promise<void> {
  const result = await runMigrator(
    [SEED_ENTRY, BASE_ONLY_REGISTRY],
    databaseUri,
  );
  if (result.status !== 0) {
    throw new Error(
      `seed 失敗(status ${String(result.status)}):${result.stderr}`,
    );
  }
}

/** 從 Set-Cookie 標頭取出指定 cookie 的 `name=value` 段(供下一個請求回送)。 */
export function cookiePair(
  setCookies: string[],
  name: string,
): string | undefined {
  const header = setCookies.find((line) => line.startsWith(`${name}=`));
  return header?.split(";", 1)[0];
}

/**
 * 啟動對真 MongoDB 的完整 Nest app(#61 Testing Decisions):
 * 本地起 mongodb-memory-server;CI 沿用 MongoDB service container(MONGODB_URI)。
 * 環境變數在 import AppModule 之前設定 — AppModule 載入時 ConfigModule 就讀 `.env`;
 * `MONGODB_URI` 則是連線 factory 執行時才讀。
 * `extraModules`:測試專用的額外 Nest module(如 #63 的 @RequirePermission 探針 resolver),與 AppModule 一起掛上。
 */
export async function startAuthTestApp(
  databaseName: string,
  env: Record<string, string> = {},
  extraModules: Type[] = [],
): Promise<AuthTestApp> {
  let memoryServer: MongoMemoryServer | undefined;
  let baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    memoryServer = await MongoMemoryServer.create();
    baseUri = memoryServer.getUri();
  }
  try {
    return await bootAuthTestApp(
      baseUri,
      memoryServer,
      databaseName,
      env,
      extraModules,
    );
  } catch (error) {
    // 啟動失敗(seed、AppModule 載入或組裝驗證)時沒有人拿得到 close():
    // 不在這裡關掉 mongod,jest 會收不了尾、一路卡到逾時
    await memoryServer?.stop();
    throw error;
  }
}

async function bootAuthTestApp(
  baseUri: string,
  memoryServer: MongoMemoryServer | undefined,
  databaseName: string,
  env: Record<string, string>,
  extraModules: Type[],
): Promise<AuthTestApp> {
  const databaseUri = buildDatabaseUri(baseUri, databaseName);
  await seedDatabase(databaseUri);

  process.env.MONGODB_URI = databaseUri;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  Object.assign(process.env, env);

  // 動態載入:ConfigModule 於 import 時載入 .env(連線字串在 factory 執行時才讀),環境變數就緒後才載入
  const { AppModule } = await import("../../app.module");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const connection = await mongoose.createConnection(databaseUri).asPromise();

  const graphql: AuthTestApp["graphql"] = async (
    query,
    variables = {},
    options = {},
  ) => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    let call = request(server)
      .post("/graphql")
      .set("Content-Type", "application/json");
    if (options.accessToken) {
      call = call.set("Authorization", `Bearer ${options.accessToken}`);
    }
    if (options.cookie) {
      call = call.set("Cookie", options.cookie);
    }
    const response = await call.send({ query, variables });
    const body = response.body as {
      data?: Record<string, unknown> | null;
      errors?: GraphqlError[];
    };
    const rawSetCookie = response.headers["set-cookie"] as
      string[] | string | undefined;
    let setCookies: string[] = [];
    if (Array.isArray(rawSetCookie)) {
      setCookies = rawSetCookie;
    } else if (rawSetCookie !== undefined) {
      setCookies = [rawSetCookie];
    }
    return {
      status: response.status,
      data: (body.data ?? null) as never,
      errors: body.errors,
      setCookies,
    };
  };

  return {
    app,
    connection,
    graphql,
    reseed: () => seedDatabase(databaseUri),
    runUpdate: (args) => runMigratorUpdate(databaseUri, args),
    close: async () => {
      await app.close();
      await connection.dropDatabase();
      await connection.close();
      await memoryServer?.stop();
    },
  };
}
