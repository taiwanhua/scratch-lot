import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { MongoMemoryReplSet } from "mongodb-memory-server";
import type { PreviewServer } from "vite";

import {
  ADMIN_PORT,
  ADMIN_URL,
  API_LOG_PATH,
  API_PORT,
  DB_NAME,
  GRAPHQL_ENDPOINT,
  HOST,
  JWT_SECRET,
  MONGODB_URI,
  REPO_ROOT,
  ROOT_ACCOUNT,
  ROOT_EMAIL,
  ROOT_PASSWORD,
  SKIP_BUILD,
  SKIP_STACK,
  TMP_DIR,
} from "../config";
import {
  type FakeGcsState,
  apiStorageEnv,
  startFakeGcs,
  stopFakeGcs,
} from "./fake-gcs";
import { log, run, start, stopProcess, waitUntil } from "./process";

/**
 * 一整套本機 stack(TEST-11):**記憶體 / 拋棄式 Mongo → update(migration → 種子)→ fake GCS(有 Docker 才起)→ api → admin 靜態檔**。
 *
 * `globalSetup` 起、`globalTeardown` 收,兩者跑在 Playwright 的同一個行程裡,
 * 所以 handle 放模組層就夠(worker 是另外的行程,要跨行程的東西一律走環境變數或 `.tmp` 下的檔案)。
 */

interface StackState {
  mongo: MongoMemoryReplSet | null;
  api: ChildProcess | null;
  admin: PreviewServer | null;
}

let state: StackState | null = null;

/**
 * 起 Mongo:給了 `E2E_MONGODB_URI`(須為 replica set)就用它,否則自起單一成員 replica set
 *(MongoMemoryReplSet;api 的交易需要 replica set)。本機與 CI(e2e.yml)都走自起。
 */
async function startMongo(): Promise<{
  uri: string;
  server: MongoMemoryReplSet | null;
}> {
  if (MONGODB_URI !== "") {
    log(`使用外部 MongoDB(E2E_MONGODB_URI)`);
    return { uri: MONGODB_URI, server: null };
  }
  log("啟動 mongodb-memory-server(單一成員 replica set)");
  const { MongoMemoryReplSet: Server } = await import("mongodb-memory-server");
  const server = await Server.create({
    replSet: { count: 1, dbName: DB_NAME },
  });
  return { uri: server.getUri(DB_NAME), server };
}

/** admin 的 api 端點是 build 時烘進 bundle 的,所以埠一改就得重建(見 apps/admin/turbo.json 的 `env`)。 */
async function buildApps(): Promise<void> {
  if (SKIP_BUILD) {
    log("E2E_SKIP_BUILD=1:沿用現有的 api / admin 產物");
    return;
  }
  await run(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@repo/api",
      "--filter=@repo/admin",
    ],
    {
      label: "build api / admin",
      env: { VITE_GRAPHQL_ENDPOINT: GRAPHQL_ENDPOINT },
    },
  );
}

/**
 * 與部署同一個入口:一次 update 跑完 migration → 種子 → 受管定義(定義由 api 建置後的 CLI 發布,
 * `buildApps` 已先建好 api)。要寫 `run update` —— 少了 `run`,pnpm 會把 update 當成自己的升級依賴指令。
 */
async function updateDatabase(uri: string): Promise<void> {
  await run("pnpm", ["--filter", "@repo/db-migrator", "run", "update"], {
    label: "update",
    env: {
      MONGODB_URI: uri,
      ROOT_ADMIN_ACCOUNT: ROOT_ACCOUNT,
      ROOT_ADMIN_EMAIL: ROOT_EMAIL,
      ROOT_ADMIN_PASSWORD: ROOT_PASSWORD,
    },
  });
}

async function isGraphqlReady(): Promise<boolean> {
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{__typename}" }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function isAdminReady(): Promise<boolean> {
  try {
    const response = await fetch(ADMIN_URL);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * api 以子行程起(STRUCT-01:app 之間不互 import)。
 * cwd 指到 `.tmp` 有兩個作用:`autoSchemaFile` 產出的 schema.gql 不會弄髒 repo,
 * 也不會誤讀開發者本機 `apps/api/.env` 的設定。
 */
function startApi(uri: string, gcs: FakeGcsState): ChildProcess {
  return start(
    process.execPath,
    [path.join(REPO_ROOT, "apps/api/dist/main.js")],
    {
      label: "api",
      cwd: TMP_DIR,
      logFile: API_LOG_PATH,
      env: {
        MONGODB_URI: uri,
        PORT: String(API_PORT),
        JWT_SECRET,
        // RESEND_API_KEY 不設 → 記錄用 adapter,啟用信只印到 stdout(測試從 api.log 撈 token)
        RESEND_API_KEY: "",
        MAIL_ALLOWLIST: "",
        GRAPHQL_SANDBOX: "false",
        // 檔案儲存:fake GCS 起得來就指過去(劇本 11 / 15),否則維持記錄用 adapter(#402)
        ...apiStorageEnv(gcs),
      },
    },
  );
}

async function startAdmin(): Promise<PreviewServer> {
  const { preview } = await import("vite");
  return preview({
    root: path.join(REPO_ROOT, "apps/admin"),
    // 不讀 admin 的 vite.config.ts:preview 只是靜態檔伺服器,載設定等於把 build 的外掛一起拉進來
    configFile: false,
    build: { outDir: "dist" },
    preview: { host: HOST, port: ADMIN_PORT, strictPort: true },
    logLevel: "warn",
  });
}

export async function startStack(): Promise<void> {
  if (SKIP_STACK) {
    log("E2E_SKIP_STACK=1:直接使用已經跑著的 api / admin");
    return;
  }
  mkdirSync(TMP_DIR, { recursive: true });
  await buildApps();

  const { uri, server } = await startMongo();
  state = { mongo: server, api: null, admin: null };
  await updateDatabase(uri);
  const gcs = await startFakeGcs();

  state.api = startApi(uri, gcs);
  await waitUntil(isGraphqlReady, { label: `api ${GRAPHQL_ENDPOINT}` });
  log(`api 就緒:${GRAPHQL_ENDPOINT}`);

  state.admin = await startAdmin();
  await waitUntil(isAdminReady, { label: `admin ${ADMIN_URL}` });
  log(`admin 就緒:${ADMIN_URL}`);
}

export async function stopStack(): Promise<void> {
  const current = state;
  state = null;
  if (current === null) {
    return;
  }
  await current.admin?.close();
  await stopProcess(current.api);
  await stopFakeGcs();
  await current.mongo?.stop();
  log("stack 已停止");
}
