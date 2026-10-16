import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MONGOOSE_MODULE_OPTIONS } from "@nestjs/mongoose/dist/mongoose.constants";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Connection } from "mongoose";

import {
  type DefinitionSeedOperation,
  type DefinitionSeedResult,
  type DefinitionSeedSet,
  isDefinitionSeedResultOk,
  parseDefinitionSeedResult,
} from "@repo/domain/seed";

import { AuthService } from "../auth/auth.service";
import {
  ROOT_ADMIN,
  buildDatabaseUri,
  seedDatabase,
} from "../auth/test-support/auth-app";
import { DataScopeService } from "../data-scope/data-scope.service";
import { getDataScopeRuleProvider } from "../database/plugins/data-scope-provider";
import { MailService } from "../mail/mail.service";
import { StorageService } from "../storage/storage.service";
import { WorkflowEngineService } from "../workflows/workflow-engine/workflow-engine.service";
import { DefinitionSeedService } from "./definition-seed.service";
import { ROOT_ADMIN_ACCOUNT_ENV } from "./seed-operator.service";
import { MONGODB_URI_ENV, SeedRuntimeModule } from "./seed-runtime.module";
import {
  auditCount,
  definitionDoc,
  formSeed,
  holdSeedLock,
  installationsOf,
  releaseSeedLock,
  seedHashes,
  seedRequest,
  workflowSeed,
} from "./test-support/seed-fixtures";

/** 建置(turbo 連依賴一起)與每次起一個 Node 子程序都慢,放寬逾時。 */
const BUILD_TIMEOUT_MS = 600_000;
const CLI_TIMEOUT_MS = 120_000;
jest.setTimeout(CLI_TIMEOUT_MS * 3);

const API_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(API_ROOT, "..", "..");
const CLI_ENTRY = path.join(API_ROOT, "dist", "seed", "run.js");
const TURBO_CLI = path.join(REPO_ROOT, "node_modules", "turbo", "bin", "turbo");

/** CLI 不需要的 api 執行期設定:子程序的環境裡拿掉,證明它不靠這些啟動。 */
const SERVER_ONLY_ENV = new Set([
  "JWT_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "RESEND_API_KEY",
  "PORT",
  "ROOT_ADMIN_EMAIL",
  "ROOT_ADMIN_PASSWORD",
]);

const FORM = "form-definition";
const WORKFLOW = "workflow-definition";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** 建置 api 與它的 workspace 依賴(同一個 checkout 的產物),不依賴本機恰好留著的 dist。 */
function buildCli(): void {
  const build = spawnSync(
    process.execPath,
    [TURBO_CLI, "run", "build", "--filter=@repo/api"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: BUILD_TIMEOUT_MS - 30_000 },
  );
  if (build.status !== 0) {
    throw new Error(
      `建置 api 失敗(status ${String(build.status)}):${build.stdout.slice(-3000)}\n${build.stderr.slice(-3000)}`,
    );
  }
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`建置後沒有 ${CLI_ENTRY}`);
  }
}

/**
 * 以真正的子程序跑建置後的 CLI:`process.execPath` + 固定路徑、不經 shell,stdin 一份請求。
 * 工作目錄刻意放在 repo 之外:CLI 不讀工作目錄的 `.env`,也不靠相對路徑。
 */
function runCli(
  input: string,
  env: Record<string, string | undefined>,
): Promise<CliRun> {
  const childEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      ([name]) => !SERVER_ONLY_ENV.has(name),
    ),
  );
  // 非同步 spawn(不是 spawnSync):本機的 mongodb-memory-server 是這個測試行程的子程序,
  // 測試行程的事件迴圈被擋住時沒人讀它的輸出,管線塞滿後 mongod 會停住、CLI 跟著卡死
  return new Promise<CliRun>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY], {
      cwd: os.tmpdir(),
      env: childEnv,
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
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI 子程序逾時:${stderr}`));
    }, CLI_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`CLI 子程序失敗(${error.message}):${stderr}`));
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

/** 還原環境變數(原本沒設就拿掉;指派 undefined 會變成字串 "undefined")。 */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

/** stdout 必須恰好是一份協定 JSON 加換行,沒有任何其他輸出。 */
function resultOf(
  run: CliRun,
  operation: DefinitionSeedOperation,
): DefinitionSeedResult {
  const parsed = parseDefinitionSeedResult(JSON.parse(run.stdout), operation);
  expect(run.stdout).toBe(`${JSON.stringify(JSON.parse(run.stdout))}\n`);
  return parsed;
}

/**
 * 受管定義的最小 Nest 組裝與受控 CLI(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」)。
 * 前半在測試行程裡起 `SeedRuntimeModule`;後半先建置,再以子程序跑 `dist/seed/run.js`,
 * 鎖用共用契約的隔離夾具(不依賴 db-migrator 的 update)。
 */
describe("受管定義的最小 Nest 組裝與 CLI 子程序", () => {
  let memoryServer: MongoMemoryServer | undefined;
  let uriA: string;
  let uriB: string;
  let connectionA: Connection;
  let connectionB: Connection;

  beforeAll(async () => {
    let baseUri = process.env[MONGODB_URI_ENV];
    if (!baseUri) {
      memoryServer = await MongoMemoryServer.create();
      baseUri = memoryServer.getUri();
    }
    uriA = buildDatabaseUri(baseUri, "cookhome-test-seed-cli-a");
    uriB = buildDatabaseUri(baseUri, "cookhome-test-seed-cli-b");
    await seedDatabase(uriA);
    await seedDatabase(uriB);
    connectionA = await mongoose.createConnection(uriA).asPromise();
    connectionB = await mongoose.createConnection(uriB).asPromise();
    await holdSeedLock(connectionA);
    await holdSeedLock(connectionB);
    buildCli();
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    for (const connection of [connectionA, connectionB]) {
      await connection.dropDatabase();
      await connection.close();
    }
    await memoryServer?.stop();
  });

  function cli(
    seeds: DefinitionSeedSet[],
    operation: DefinitionSeedOperation = "apply",
    options: {
      uri?: string;
      env?: Record<string, string | undefined>;
      lockOwner?: string;
    } = {},
  ): Promise<CliRun> {
    return runCli(
      JSON.stringify(
        seedRequest(
          seeds,
          operation,
          options.lockOwner === undefined
            ? {}
            : { lockOwner: options.lockOwner },
        ),
      ),
      {
        MONGODB_URI: options.uri ?? uriA,
        ROOT_ADMIN_ACCOUNT: ROOT_ADMIN.account,
        ...options.env,
      },
    );
  }

  describe("SeedRuntimeModule(測試行程內)", () => {
    let context: INestApplicationContext;
    const originalEnv = {
      uri: process.env[MONGODB_URI_ENV],
      account: process.env[ROOT_ADMIN_ACCOUNT_ENV],
    };

    beforeAll(async () => {
      process.env[MONGODB_URI_ENV] = uriA;
      process.env[ROOT_ADMIN_ACCOUNT_ENV] = ROOT_ADMIN.account;
      context = await NestFactory.createApplicationContext(SeedRuntimeModule, {
        logger: false,
        abortOnError: false,
      });
    });

    afterAll(async () => {
      await context.close();
      restoreEnv(MONGODB_URI_ENV, originalEnv.uri);
      restoreEnv(ROOT_ADMIN_ACCOUNT_ENV, originalEnv.account);
    });

    it("啟動時真正的 DataScopeService 註冊成規則提供者(資料層的啟動檢查通過),沒有 HTTP 伺服器", () => {
      expect(getDataScopeRuleProvider()).toBe(
        context.get(DataScopeService, { strict: false }),
      );
      expect(getDataScopeRuleProvider()).toBeInstanceOf(DataScopeService);
      expect("listen" in context).toBe(false);
      expect("getHttpServer" in context).toBe(false);
    });

    it("連線字串原樣交給 driver(環境變數給什麼就連什麼)", () => {
      expect(
        context.get<{ uri: string }>(MONGOOSE_MODULE_OPTIONS, {
          strict: false,
        }).uri,
      ).toBe(uriA);
    });

    it("沒有登入線、檔案儲存、寄信與流程引擎:這些 provider 根本不在容器裡", () => {
      for (const token of [
        AuthService,
        StorageService,
        MailService,
        WorkflowEngineService,
      ]) {
        expect(() => context.get(token, { strict: false })).toThrow();
      }
    });

    it("在這個最小組裝裡可以安裝與核對(真實操作者、真實權限解析與稽核)", async () => {
      const seeds = context.get(DefinitionSeedService);
      const seed = formSeed("runtime_form", "r1");

      const applied = await seeds.execute(seedRequest([seed]));
      const inspected = await seeds.execute(seedRequest([seed], "inspect"));

      expect(applied.errors).toEqual([]);
      expect(applied.results).toMatchObject([
        { outcome: "created", localVersion: 1 },
      ]);
      expect(inspected.results).toMatchObject([
        { outcome: "unchanged", localVersion: 1, currentVersion: 1 },
      ]);
      const root = await connectionA
        .collection("users")
        .findOne({ account: ROOT_ADMIN.account });
      const form = await definitionDoc(connectionA, FORM, "runtime_form");
      expect(form?.createdBy).toEqual(root?._id);
      expect(
        await auditCount(connectionA, {
          action: "form-version.publish",
          actorId: root?._id,
        }),
      ).toBe(1);
    });
  });

  describe("CLI 子程序(dist/seed/run.js)", () => {
    it("apply:stdout 只有一份協定 JSON、診斷都在 stderr、成功結束碼 0;實體照原生命週期發布", async () => {
      const form = formSeed("cli_form", "r1");
      const flow = workflowSeed("cli_flow", "r1");

      const run = await cli([form, flow]);

      expect(run.status).toBe(0);
      const result = resultOf(run, "apply");
      expect(isDefinitionSeedResultOk(result)).toBe(true);
      expect(result.results).toMatchObject([
        {
          kind: FORM,
          key: "cli_form",
          ...seedHashes(form),
          outcome: "created",
        },
        {
          kind: WORKFLOW,
          key: "cli_flow",
          ...seedHashes(flow),
          outcome: "created",
        },
      ]);
      // Nest 的啟動 log 在 stderr;沒有載入 HTTP / GraphQL、登入線、儲存、寄信、流程引擎
      expect(run.stderr).toContain(
        "SeedRuntimeModule dependencies initialized",
      );
      for (const absent of [
        "GraphQLModule",
        "AuthModule",
        "StorageModule",
        "MailModule",
        "WorkflowEngineModule",
        "AppModule",
      ]) {
        expect(run.stderr).not.toContain(absent);
      }
    });

    it("apply 之後資料庫裡是已發布的共用定義與安裝紀錄;重跑未變且結束碼 0", async () => {
      expect(await definitionDoc(connectionA, FORM, "cli_form")).toMatchObject({
        ownerOrgId: null,
        currentVersion: 1,
      });
      expect(
        await definitionDoc(connectionA, WORKFLOW, "cli_flow"),
      ).toMatchObject({ tenantId: null, currentVersion: 1 });
      const auditsBefore = await auditCount(connectionA);

      const rerun = await cli([
        formSeed("cli_form", "r1"),
        workflowSeed("cli_flow", "r1"),
      ]);

      expect(rerun.status).toBe(0);
      expect(resultOf(rerun, "apply").results).toMatchObject([
        { outcome: "unchanged", localVersion: 1 },
        { outcome: "unchanged", localVersion: 1 },
      ]);
      expect(await auditCount(connectionA)).toBe(auditsBefore);
    });

    it("inspect:已安裝回 unchanged、尚未安裝回 absent(結束碼仍是 0),不寫入", async () => {
      const auditsBefore = await auditCount(connectionA);

      const run = await cli(
        [formSeed("cli_form", "r1"), formSeed("cli_never", "r1")],
        "inspect",
      );

      expect(run.status).toBe(0);
      expect(resultOf(run, "inspect").results).toMatchObject([
        { outcome: "unchanged", localVersion: 1, currentVersion: 1 },
        { outcome: "absent", localVersion: null, definitionId: null },
      ]);
      expect(await definitionDoc(connectionA, FORM, "cli_never")).toBeNull();
      expect(await auditCount(connectionA)).toBe(auditsBefore);
    });

    it("衝突:結束碼 1,stdout 仍是一份合法結果並帶具體衝突", async () => {
      const run = await cli([
        formSeed("cli_form", "r1", { changelog: "同 revision 改了內容" }),
      ]);

      expect(run.status).toBe(1);
      const result = resultOf(run, "apply");
      expect(result.errors).toEqual([]);
      expect(result.results).toMatchObject([
        { outcome: null, conflict: { code: "REVISION_HASH_MISMATCH" } },
      ]);
    });

    it("鎖:沒有人持鎖或 owner 不符 → 結束碼 1、零寫入;CLI 不會自己取得或釋放鎖", async () => {
      const seed = formSeed("cli_locked", "r1");

      const foreign = await cli([seed], "apply", {
        lockOwner: "not-the-owner",
      });
      await releaseSeedLock(connectionA);
      const unlocked = await cli([seed]);
      const lockCount = await connectionA
        .collection("changelog_lock")
        .countDocuments();
      await holdSeedLock(connectionA);

      expect(foreign.status).toBe(1);
      expect(resultOf(foreign, "apply").errors).toMatchObject([
        { code: "LOCK_OWNER_MISMATCH" },
      ]);
      expect(unlocked.status).toBe(1);
      expect(resultOf(unlocked, "apply").errors).toMatchObject([
        { code: "LOCK_NOT_HELD" },
      ]);
      expect(lockCount).toBe(0);
      expect(await definitionDoc(connectionA, FORM, "cli_locked")).toBeNull();
      expect(await installationsOf(connectionA, "cli_locked")).toEqual([]);
    });

    it("操作者:沒有帳號設定、帳號不存在 → 結束碼 1、零寫入", async () => {
      const seed = formSeed("cli_operator", "r1");

      const missing = await cli([seed], "apply", {
        env: { ROOT_ADMIN_ACCOUNT: undefined },
      });
      const unknown = await cli([seed], "apply", {
        env: { ROOT_ADMIN_ACCOUNT: "no-such-account" },
      });

      for (const run of [missing, unknown]) {
        expect(run.status).toBe(1);
        expect(resultOf(run, "apply").errors).toMatchObject([
          { code: "OPERATOR_UNAVAILABLE" },
        ]);
      }
      expect(await definitionDoc(connectionA, FORM, "cli_operator")).toBeNull();
      expect(await installationsOf(connectionA, "cli_operator")).toEqual([]);
    });

    it("請求格式不符(不是 JSON、協定版本不對、宣告形狀不對):結束碼 1,不連資料庫", async () => {
      const notJson = await runCli("not json", { MONGODB_URI: undefined });
      const wrongVersion = await runCli(
        JSON.stringify({ ...seedRequest([]), protocolVersion: 2 }),
        { MONGODB_URI: undefined },
      );
      const badSeed = await runCli(
        JSON.stringify(
          seedRequest([
            { ...formSeed("cli_bad", "r1"), revision: "Not Valid" },
          ]),
        ),
        { MONGODB_URI: undefined },
      );

      for (const run of [notJson, wrongVersion, badSeed]) {
        expect(run.status).toBe(1);
        expect(resultOf(run, "apply")).toMatchObject({
          results: [],
          errors: [{ code: "PROTOCOL_ERROR" }],
        });
      }
    });

    it("啟動失敗(連線字串沒給、空字串、純空白):結束碼 1,stdout 仍是一份結果,細節在 stderr", async () => {
      for (const uri of [undefined, "", " \t "]) {
        const run = await runCli(JSON.stringify(seedRequest([])), {
          MONGODB_URI: uri,
          ROOT_ADMIN_ACCOUNT: ROOT_ADMIN.account,
        });

        expect(run.status).toBe(1);
        expect(resultOf(run, "apply")).toMatchObject({
          results: [],
          errors: [
            { code: "CLI_FAILED", message: expect.stringContaining("缺少") },
          ],
        });
        expect(run.stderr).toContain("MONGODB_URI");
      }
    });

    it("兩個環境裝同一份宣告:hash 相同,定義 id 與本地版號各自不同", async () => {
      const r1 = formSeed("cli_shared", "r1");
      const r2 = formSeed("cli_shared", "r2", { name: "跨環境表單 二版" });
      const flow = workflowSeed("cli_shared_flow", "r1");
      // 環境 B 的歷史比較長:先裝過 r1 才到 r2;環境 A 直接裝 r2
      const firstOnB = await cli([r1], "apply", { uri: uriB });
      expect(firstOnB.status).toBe(0);

      const onA = resultOf(await cli([r2, flow]), "apply");
      const onB = resultOf(
        await cli([r2, flow], "apply", { uri: uriB }),
        "apply",
      );

      expect(isDefinitionSeedResultOk(onA)).toBe(true);
      expect(isDefinitionSeedResultOk(onB)).toBe(true);
      const [formA, flowA] = onA.results;
      const [formB, flowB] = onB.results;
      expect(formA).toMatchObject({ ...seedHashes(r2), localVersion: 1 });
      expect(formB).toMatchObject({ ...seedHashes(r2), localVersion: 2 });
      expect(formA?.definitionId).not.toBe(formB?.definitionId);
      expect(flowA?.contentHash).toBe(flowB?.contentHash);
      expect(flowA?.snapshotHash).toBe(flowB?.snapshotHash);
      expect(flowA?.definitionId).not.toBe(flowB?.definitionId);
      // 兩邊目前發布內容的 hash 相同(inspect 回的是目前版本的內容 hash)
      const inspectA = resultOf(await cli([r2], "inspect"), "inspect");
      const inspectB = resultOf(
        await cli([r2], "inspect", { uri: uriB }),
        "inspect",
      );
      expect(inspectA.results[0]?.currentContentHash).toBe(
        seedHashes(r2).contentHash,
      );
      expect(inspectB.results[0]?.currentContentHash).toBe(
        seedHashes(r2).contentHash,
      );
      expect(inspectA.results[0]?.currentVersion).toBe(1);
      expect(inspectB.results[0]?.currentVersion).toBe(2);
    });
  });
});
