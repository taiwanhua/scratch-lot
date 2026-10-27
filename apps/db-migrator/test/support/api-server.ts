/**
 * 起一個真的 api(`apps/api/dist/main.js`,子行程;STRUCT-01 app 之間不互 import)接在測試資料庫上,
 * 給「只透過 GraphQL 寫資料」的 demo 指令(與專案的 populate)做整合測試。
 *
 * 順序同部署:建置 api(turbo,快取命中只要幾秒)→ 以正式 registry 跑一次 update(migration → 種子 → 受管定義)
 * → 起 api → 等 GraphQL 回應。cwd 指到暫存目錄:schema 產物不弄髒 repo,也不讀開發者本機的 `apps/api/.env`。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PACKAGE_ROOT,
  ROOT_ADMIN_ENV,
  buildDefinitionCli,
  runUpdate,
} from "./update-harness";

const API_ENTRY = path.resolve(PACKAGE_ROOT, "..", "api", "dist", "main.js");
const TSX_CLI = path.join(
  PACKAGE_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
export const DEMO_ENTRY = path.join(PACKAGE_ROOT, "src", "demo", "run.ts");

/** 測試自備的 JWT 密鑰(正式環境自 Secret Manager 注入)。 */
const TEST_JWT_SECRET = "db-migrator-test-jwt-secret";
const READY_TIMEOUT_MS = 60_000;

export interface ApiServer {
  /** api 的 origin(`http://127.0.0.1:<port>`;GraphQL 在 `/graphql`)。 */
  apiUrl: string;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function isReady(apiUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{__typename}" }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(
  apiUrl: string,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`api 啟動失敗(exit ${String(child.exitCode)}):${log()}`);
    }
    if (await isReady(apiUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`api 在 ${String(READY_TIMEOUT_MS)}ms 內沒有就緒:${log()}`);
}

/** 建置 api、種好資料庫、起 api;回傳網址與停止函式。 */
export async function startApiServer(databaseUri: string): Promise<ApiServer> {
  await buildDefinitionCli();
  const update = await runUpdate(databaseUri);
  if (update.status !== 0) {
    throw new Error(
      `update 失敗:${update.stderr}\n${update.stdout.slice(-2000)}`,
    );
  }
  const port = await freePort();
  const apiUrl = `http://127.0.0.1:${String(port)}`;
  const child = spawn(process.execPath, [API_ENTRY], {
    cwd: mkdtempSync(path.join(tmpdir(), "db-migrator-api-")),
    env: {
      ...process.env,
      MONGODB_URI: databaseUri,
      PORT: String(port),
      JWT_SECRET: TEST_JWT_SECRET,
      // 寄信用記錄用 adapter(只印到 stdout);檔案儲存用記錄用 adapter
      RESEND_API_KEY: "",
      MAIL_ALLOWLIST: "",
      GCS_BUCKET_PRIVATE: "",
      GCS_BUCKET_PUBLIC: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => {
      output = (output + chunk).slice(-4000);
    });
  }
  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("close", () => {
        resolve();
      });
      child.kill();
    });
  try {
    await waitUntilReady(apiUrl, child, () => output);
  } catch (error) {
    await stop();
    throw error;
  }
  return { apiUrl, stop };
}

/**
 * 以子行程跑 demo 指令入口(tsx),機密從標準輸入以管線送入(同 workflow 的做法)。
 * 非同步 spawn(不是 spawnSync):mongodb-memory-server 的輸出靠測試行程的事件迴圈讀(TEST-07)。
 */
export function runDemoEntry(
  args: readonly string[],
  databaseUri: string,
  stdinLines: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [TSX_CLI, DEMO_ENTRY, ...args], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      ...ROOT_ADMIN_ENV,
      MONGODB_URI: databaseUri,
      DEMO_ALLOW_ENV: "dev",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(stdinLines.map((line) => `${line}\n`).join(""));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
