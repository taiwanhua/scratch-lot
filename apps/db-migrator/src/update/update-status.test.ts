/* eslint-disable sonarjs/no-os-command-from-path -- 預期值取同一個 checkout 的 `git rev-parse HEAD`:git 的安裝位置因機器而異,只能靠 PATH;不經 shell、參數固定;到期條件:無 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import {
  type CommandResult,
  PACKAGE_ROOT,
  TestMongo,
  collectionNames,
  dumpDatabase,
  runUpdate,
  withDatabase,
} from "../../test/support/update-harness";
import { contentHashOf, sourceFileHashOf } from "./content-hash";
import { resolveSourceCommit } from "./source-commit";

/**
 * `migrate:status` / `update --status` 的 `--json`(`docs/deployment.md`「設定與資料更新」):唯讀 JSON 狀態,
 * 對真的拋棄式 MongoDB。`--json` 只接受唯讀 status;最後成功的 update / reset 與其後的 failed / down 都看得到。
 */

const mongo = new TestMongo("db-migrator-status");

const LEGACY = "20270101000000_data_alpha.js";
const BASE = "20270102000000_data_beta.js";
const PROJECT = "20270103000000_data_gamma.js";
const GONE_A = "20200101000000_data_gone-a.js";
const GONE_B = "20200102000000_data_gone-b.js";

const SHA_BASELINE = "b".repeat(40);
const SHA_OLD = "a".repeat(40);
const SHA_FAILED = "c".repeat(40);
/** 與這個 checkout 無關的 `GITHUB_SHA`:sourceCommit 不得沿用它。 */
const UNRELATED_GITHUB_SHA = "d".repeat(40);

const PLAIN_MIGRATION = `export const up = async (db) => {
  await db.collection("update_fixture_marks").insertOne({ at: new Date() });
};
`;
/** 來源檔的 hash(三支 migration 內容相同)。 */
const PLAIN_HASH = sourceFileHashOf(Buffer.from(PLAIN_MIGRATION));

/** 暫存目錄的來源:legacy / base / project 各一支 migration,registry 是空的。 */
function sourceRoot(): string {
  return writeSources(
    mkdtempSync(path.join(os.tmpdir(), "db-migrator-status-")),
  );
}

function writeSources(root: string): string {
  const files: Record<string, string> = {
    // 暫存目錄不在任何套件底下:指明裡面的 .js 是 ESM(與本套件相同)
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    "seeds/registry.ts": "export const seedRegistry = [];\n",
    [`migrations/${LEGACY}`]: PLAIN_MIGRATION,
    [`migrations/base/${BASE}`]: PLAIN_MIGRATION,
    [`migrations/project/${PROJECT}`]: PLAIN_MIGRATION,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

const at = (time: string): Date => new Date(`2026-10-01T${time}.000Z`);
const iso = (time: string): string => at(time).toISOString();

interface RunFixture {
  runId: string;
  operation: string;
  status: string;
  stage: string;
  releaseCommit: string;
  startedAt: string;
  finishedAt: string | null;
}

/** 一筆 `type: "run"` 的執行紀錄(含不該輸出的 owner / planHash / error / report)。 */
function runDocument(run: RunFixture) {
  return {
    type: "run",
    ...run,
    owner: `owner-${run.runId}`,
    planHash: "sha256:plan",
    error:
      run.status === "failed" ? "raw failure mongodb://user:pw@host/db" : null,
    report: { business: { name: "should not leak" } },
    startedAt: at(run.startedAt),
    finishedAt: run.finishedAt === null ? null : at(run.finishedAt),
  };
}

/** 預期的 `RunSummary`。 */
function summaryOf(run: RunFixture, releaseCommit: string | null) {
  return {
    runId: run.runId,
    operation: run.operation,
    status: run.status,
    stage: run.stage,
    releaseCommit,
    startedAt: iso(run.startedAt),
    finishedAt: run.finishedAt === null ? null : iso(run.finishedAt),
  };
}

async function insertRuns(
  databaseUri: string,
  runs: readonly RunFixture[],
): Promise<void> {
  await withDatabase(databaseUri, (database) =>
    database
      .collection("seed_update_runs")
      .insertMany(runs.map((run) => runDocument(run))),
  );
}

function runStatusJson(
  databaseUri: string,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
) {
  return runUpdate(databaseUri, ["--status", "--json", ...args], env);
}

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=status-test",
      "-c",
      "user.email=status-test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** 把來源目錄做成一個只有一個 commit 的 git checkout,回 HEAD。 */
function commitAll(root: string): string {
  gitIn(root, "init", "--quiet");
  gitIn(root, "add", "--all");
  gitIn(root, "commit", "--quiet", "-m", "sources");
  return gitIn(root, "rev-parse", "HEAD");
}

/** `--json` 失敗時的整個結果:非零、stdout 空、stderr 只有固定代碼。 */
function failure(code: string): CommandResult {
  return {
    status: 1,
    stdout: "",
    stderr: `${JSON.stringify({ error: code })}\n`,
  };
}

function outcome({ status, stdout, stderr }: CommandResult): CommandResult {
  return { status, stdout, stderr };
}

/** stdout 必須正好是一個 JSON object(沒有其他文字)。 */
function parseOne(stdout: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stdout);
  expect(parsed).toEqual(expect.any(Object));
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

function expectGeneratedAt(value: unknown): void {
  expect(typeof value).toBe("string");
  expect(new Date(value as string).toISOString()).toBe(value);
}

beforeAll(async () => {
  await mongo.start();
}, 600_000);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("--json 的參數:只接受唯讀 status", () => {
  it("混入寫入動作、沒有 --status、重複或帶值的旗標:在讀來源與連資料庫之前拒絕", async () => {
    const databaseUri = mongo.uri("args");
    // 來源目錄不存在:若先讀來源,錯誤會是來源的錯而不是參數的錯
    const missingRoot = `--source-root=${path.join(os.tmpdir(), "db-migrator-status-missing")}`;
    const cases: string[][] = [
      ["--json"],
      ["--json", "--down"],
      // 目前的「最後一個動作為準」不能把它導回 status 而略過 down
      ["--down", "--status", "--json"],
      ["--status", "--json", "--down"],
      ["--json", "--unlock-owner=owner-x", "--status"],
      ["--json", "--check-cli", "--status"],
      ["--status", "--json", "--json"],
      ["--status", "--status", "--json"],
      ["--status", "--json", "--registry=a.ts", "--registry=b.ts"],
      // 帶值與別名的內容都不得回顯到錯誤裡
      ["--alias=F2_ALIAS_MARKER", "--status", "--json=F2_PRIVATE_VALUE"],
      ["--status", "--json", "--F2_UNKNOWN_MARKER"],
    ];
    for (const args of cases) {
      const result = await runUpdate(databaseUri, [missingRoot, ...args]);
      expect({ args, ...result }).toEqual({
        args,
        status: 1,
        stdout: "",
        stderr: `${JSON.stringify({ error: "invalid-arguments" })}\n`,
      });
    }
    expect(await collectionNames(databaseUri)).toEqual([]);
  }, 180_000);
});

describe("sourceCommit 的來源證明", () => {
  it("乾淨的 checkout 回完整 HEAD;同 checkout 任何已追蹤改動、來源底下未追蹤或被忽略的檔,或來源在外部 / 另一個 checkout 時回 null", () => {
    // checkout 根目錄:共用程式 shared/、套件 app/(source-root,含 seeds/ 以外的程式);忽略建置產物
    const checkout = mkdtempSync(path.join(os.tmpdir(), "db-migrator-status-"));
    const root = writeSources(path.join(checkout, "app"));
    const sharedHelper = path.join(checkout, "shared", "helper.ts");
    const siblingHelper = path.join(root, "src", "helper.ts");
    for (const file of [sharedHelper, siblingHelper]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "export const helper = 1;\n");
    }
    writeFileSync(
      path.join(checkout, ".gitignore"),
      "node_modules/\ndist/\n*.local\n",
    );
    const head = commitAll(checkout);
    const registryPath = path.join(root, "seeds", "registry.ts");
    const own = { checkoutRoot: root, sourceRoot: root, registryPath };
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(resolveSourceCommit(own)).toBe(head);

    // 被忽略的建置產物與 node_modules 不影響
    for (const file of [
      path.join(root, "node_modules", "x", "index.js"),
      path.join(checkout, "shared", "dist", "helper.js"),
    ]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "export {};\n");
    }
    expect(resolveSourceCommit(own)).toBe(head);

    // 已追蹤檔的改動:migration、seeds/ 以外的同套件程式、同 checkout 的共用程式
    for (const file of [
      path.join(root, "migrations", "base", BASE),
      siblingHelper,
      sharedHelper,
    ]) {
      writeFileSync(file, "// changed\n");
      expect({ file, commit: resolveSourceCommit(own) }).toEqual({
        file,
        commit: null,
      });
      gitIn(checkout, "checkout", "--", ".");
      expect(resolveSourceCommit(own)).toBe(head);
    }

    // seeds/ 底下未追蹤的快照、被忽略的檔
    for (const file of [
      path.join(root, "seeds", "base", "revisions", "x.seed.ts"),
      path.join(root, "seeds", "base", "revisions", "x.seed.local"),
      // source-root 之外、同 checkout 的共用程式多了未追蹤的檔
      path.join(checkout, "shared", "new-helper.ts"),
    ]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "export const seed = {};\n");
      expect({ file, commit: resolveSourceCommit(own) }).toEqual({
        file,
        commit: null,
      });
      rmSync(file);
      expect(resolveSourceCommit(own)).toBe(head);
    }

    // registry 在 checkout 之外
    const external = path.join(
      mkdtempSync(path.join(os.tmpdir(), "db-migrator-status-registry-")),
      "registry.ts",
    );
    writeFileSync(external, "export const seedRegistry = [];\n");
    expect(resolveSourceCommit({ ...own, registryPath: external })).toBeNull();

    // 來源屬於另一個(乾淨的)checkout
    const other = sourceRoot();
    commitAll(other);
    expect(
      resolveSourceCommit({
        checkoutRoot: root,
        sourceRoot: other,
        registryPath: path.join(other, "seeds", "registry.ts"),
      }),
    ).toBeNull();

    // 執行位置不是 git checkout
    expect(
      resolveSourceCommit({ ...own, checkoutRoot: sourceRoot() }),
    ).toBeNull();
  }, 60_000);
});

describe("--json 的輸出(對真 MongoDB)", () => {
  it("空資料庫(migrate:status 別名):全部 pending、沒有執行紀錄與鎖;sourceCommit 是 checkout 的 SHA,不沿用 GITHUB_SHA;不建立 collection", async () => {
    const databaseUri = mongo.uri("empty");
    const migrationsIn = (origin: "legacy" | "base" | "project") => {
      const directory = path.join(
        PACKAGE_ROOT,
        "migrations",
        ...(origin === "legacy" ? [] : [origin]),
      );
      return existsSync(directory)
        ? readdirSync(directory)
            .filter((fileName) => fileName.endsWith(".js"))
            .map((fileName) => ({ fileName, origin }))
        : [];
    };
    // 根目錄的歷史檔 + 之後新增的 base / project migration(檔名全域唯一,依檔名排)
    const pending = [
      ...migrationsIn("legacy"),
      ...migrationsIn("base"),
      ...migrationsIn("project"),
    ].toSorted((left, right) =>
      left.fileName.localeCompare(right.fileName, "zh-Hant"),
    );
    const head = gitIn(PACKAGE_ROOT, "rev-parse", "HEAD");

    const result = await runUpdate(
      databaseUri,
      ["--alias=migrate:status", "--status", "--json"],
      { GITHUB_SHA: UNRELATED_GITHUB_SHA },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    const { generatedAt, sourceCommit, ...status } = parseOne(result.stdout);
    expectGeneratedAt(generatedAt);
    // 只能是這個 checkout 的 HEAD(證明得了)或 null(工作中的 checkout 有改動);
    // 不會是繼承來的 GITHUB_SHA。乾淨 / 有改動的確切值由上方的來源證明案例驗
    expect([head, null]).toContainEqual(sourceCommit);
    expect(sourceCommit).not.toBe(UNRELATED_GITHUB_SHA);
    expect(status).toStrictEqual({
      schemaVersion: 1,
      lastAttempt: null,
      lastSuccessfulUpdate: null,
      subsequentRuns: null,
      migrations: {
        applied: [],
        pending,
        orphaned: [],
        open: [],
      },
      definitions: { open: [] },
      lock: null,
    });
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(result.stdout).not.toContain(databaseUri);
    expect(await collectionNames(databaseUri)).toEqual([]);
  }, 120_000);

  it("changelog / journal / 鎖並存:最後成功的 reset 為基準(依完成時間),其後重疊、同毫秒、失敗、down 與執行中都列出;查詢前後資料不變", async () => {
    const databaseUri = mongo.uri("seeded");
    const root = sourceRoot();

    const oldSuccess: RunFixture = {
      runId: "run-old",
      operation: "update",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_OLD,
      startedAt: "00:00:00",
      finishedAt: "00:01:00",
    };
    const precheckFailed: RunFixture = {
      runId: "run-precheck",
      operation: "update",
      status: "failed",
      stage: "precheck",
      releaseCommit: "unknown",
      startedAt: "00:02:00",
      finishedAt: "00:02:30",
    };
    // 開始得比基準早,完成時間恰好等於基準的開始:列為後續
    const finishedAtBaselineStart: RunFixture = {
      runId: "run-reset-data",
      operation: "reset-data",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_OLD,
      startedAt: "00:05:00",
      finishedAt: "00:10:00",
    };
    const baseline: RunFixture = {
      runId: "run-baseline",
      operation: "reset-full",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_BASELINE,
      startedAt: "00:10:00",
      finishedAt: "00:40:00",
    };
    // 開始得比基準晚、完成得比基準早(重疊):不是基準,但列為後續
    const overlapping: RunFixture = {
      runId: "run-overlap",
      operation: "update",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_OLD,
      startedAt: "00:20:00",
      finishedAt: "00:30:00",
    };
    // succeeded 但沒有走到 done:不能當基準
    const notDone: RunFixture = {
      runId: "run-not-done",
      operation: "update",
      status: "succeeded",
      stage: "verify",
      releaseCommit: SHA_OLD,
      startedAt: "00:45:00",
      finishedAt: "00:55:00",
    };
    // 同一毫秒開始的兩筆:依 runId 排;down 完成得比基準晚也不能當基準
    const down: RunFixture = {
      runId: "run-tie-b",
      operation: "migrate-down",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_BASELINE,
      startedAt: "00:50:00",
      finishedAt: "01:00:00",
    };
    const failed: RunFixture = {
      runId: "run-tie-a",
      operation: "update",
      status: "failed",
      stage: "migrations",
      releaseCommit: SHA_FAILED,
      startedAt: "00:50:00",
      finishedAt: "00:51:00",
    };
    const running: RunFixture = {
      runId: "run-running",
      operation: "update",
      status: "running",
      stage: "seeds",
      releaseCommit: "abc1234",
      startedAt: "01:10:00",
      finishedAt: null,
    };

    // 刻意不依預期順序寫入
    await insertRuns(databaseUri, [
      running,
      down,
      failed,
      baseline,
      notDone,
      overlapping,
      finishedAtBaselineStart,
      precheckFailed,
      oldSuccess,
    ]);
    await withDatabase(databaseUri, async (database) => {
      await database.collection("seed_update_runs").insertMany([
        {
          type: "unlock",
          owner: "owner-x",
          runId: "run-unlocked",
          operation: "update",
          releaseCommit: SHA_OLD,
          lockedAt: at("00:56:00"),
          unlockedAt: at("00:57:00"),
        },
        {
          type: "migration",
          fileName: LEGACY,
          status: "applied",
          sourceHash: PLAIN_HASH,
          runId: overlapping.runId,
          releaseCommit: SHA_OLD,
          createdAt: at("00:21:00"),
        },
        {
          type: "migration",
          fileName: BASE,
          status: "started",
          mode: "plain",
          // 與目前來源檔相同(沒有漂移)
          sourceHash: PLAIN_HASH,
          runId: failed.runId,
          releaseCommit: SHA_FAILED,
          error: "raw error",
          context: { definitions: [], releaseCommit: SHA_FAILED },
          createdAt: at("00:50:30"),
        },
        {
          type: "migration",
          fileName: GONE_A,
          status: "rollback-in-progress",
          mode: "plain",
          // 來源已不存在:沒有可比對的檔,照常列出(還原中,不當成已完成)
          sourceHash: contentHashOf("removed source"),
          runId: down.runId,
          releaseCommit: "unknown",
          createdAt: at("00:52:00"),
        },
      ]);
      // changelog:刻意不依檔名寫入
      await database.collection("changelog").insertMany([
        { fileName: PROJECT, appliedAt: at("00:35:00"), migrationBlock: 2 },
        { fileName: GONE_B, appliedAt: at("00:00:30"), migrationBlock: 1 },
        { fileName: LEGACY, appliedAt: at("00:21:30"), migrationBlock: 1 },
        { fileName: GONE_A, appliedAt: at("00:00:20"), migrationBlock: 1 },
      ]);
      const locks = database.collection<{
        _id: string;
        [field: string]: unknown;
      }>("changelog_lock");
      await locks.insertOne({
        _id: "seed-update",
        owner: "owner-running",
        runId: running.runId,
        operation: "update",
        releaseCommit: "abc1234",
        startedAt: at("01:10:00"),
        progress: { stage: "seeds", detail: "x", updatedAt: at("01:11:00") },
      });
      // 中斷的定義安裝:run-old 留下的那一筆,之後成功的 update(registry 已不再登記它)也不會清掉,仍要列出
      await database.collection("seed_definition_installations").insertMany([
        {
          kind: "workflow-definition",
          key: "approval",
          revision: "r2",
          status: "in-progress",
          runId: failed.runId,
          contentHash: "sha256:workflow",
        },
        {
          kind: "form-definition",
          key: "request",
          revision: "r1",
          status: "installed",
          runId: baseline.runId,
          contentHash: "sha256:installed",
        },
        {
          kind: "form-definition",
          key: "request",
          revision: "r2",
          status: "in-progress",
          runId: oldSuccess.runId,
          contentHash: "sha256:form",
          definitionId: "should not leak",
        },
      ]);
    });
    const before = await dumpDatabase(databaseUri);

    const result = await runStatusJson(databaseUri, [`--source-root=${root}`]);
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    const { generatedAt, ...status } = parseOne(result.stdout);
    expectGeneratedAt(generatedAt);
    expect(status).toStrictEqual({
      schemaVersion: 1,
      // 暫存目錄的來源不在任何 git checkout 裡:未知
      sourceCommit: null,
      lastAttempt: summaryOf(running, null),
      lastSuccessfulUpdate: summaryOf(baseline, SHA_BASELINE),
      subsequentRuns: [
        summaryOf(finishedAtBaselineStart, SHA_OLD),
        summaryOf(overlapping, SHA_OLD),
        summaryOf(notDone, SHA_OLD),
        summaryOf(failed, SHA_FAILED),
        summaryOf(down, SHA_BASELINE),
        summaryOf(running, null),
      ],
      migrations: {
        applied: [
          { fileName: LEGACY, origin: "legacy", appliedAt: iso("00:21:30") },
          { fileName: PROJECT, origin: "project", appliedAt: iso("00:35:00") },
        ],
        pending: [{ fileName: BASE, origin: "base" }],
        orphaned: [
          { fileName: GONE_A, appliedAt: iso("00:00:20") },
          { fileName: GONE_B, appliedAt: iso("00:00:30") },
        ],
        open: [
          {
            fileName: GONE_A,
            status: "rollback-in-progress",
            runId: down.runId,
            releaseCommit: null,
          },
          {
            fileName: BASE,
            status: "started",
            runId: failed.runId,
            releaseCommit: SHA_FAILED,
          },
        ],
      },
      definitions: {
        open: [
          {
            kind: "form-definition",
            key: "request",
            revision: "r2",
            runId: oldSuccess.runId,
          },
          {
            kind: "workflow-definition",
            key: "approval",
            revision: "r2",
            runId: failed.runId,
          },
        ],
      },
      lock: {
        owner: "owner-running",
        runId: running.runId,
        operation: "update",
        releaseCommit: null,
        startedAt: iso("01:10:00"),
      },
    });
    expect(result.stdout).not.toContain("should not leak");
    expect(result.stdout).not.toContain("raw failure");
    expect(await dumpDatabase(databaseUri)).toEqual(before);

    // 反例:同名來源檔已被改寫(未完成紀錄的 sourceHash 與目前來源不同)→ 來源漂移,不輸出 JSON、不寫入
    await withDatabase(databaseUri, (database) =>
      database.collection("seed_update_runs").insertOne({
        type: "migration",
        fileName: PROJECT,
        status: "verified",
        mode: "plain",
        sourceHash: contentHashOf("published content before rewrite"),
        runId: running.runId,
        releaseCommit: SHA_FAILED,
        createdAt: at("01:12:00"),
      }),
    );
    const drifted = await dumpDatabase(databaseUri);
    expect(
      outcome(await runStatusJson(databaseUri, [`--source-root=${root}`])),
    ).toEqual(failure("invalid-sources"));
    expect(await dumpDatabase(databaseUri)).toEqual(drifted);
  }, 120_000);

  it("沒有成功的 update / reset(只有失敗與 down):沒有基準,subsequentRuns 是 null 而不是全部執行", async () => {
    const databaseUri = mongo.uri("no-baseline");
    const down: RunFixture = {
      runId: "run-down",
      operation: "migrate-down",
      status: "succeeded",
      stage: "done",
      releaseCommit: SHA_OLD,
      startedAt: "00:00:00",
      finishedAt: "00:01:00",
    };
    const failed: RunFixture = {
      runId: "run-failed",
      operation: "reset-data",
      status: "failed",
      stage: "reset-clear",
      releaseCommit: SHA_FAILED,
      startedAt: "00:02:00",
      finishedAt: "00:03:00",
    };
    await insertRuns(databaseUri, [failed, down]);
    const before = await dumpDatabase(databaseUri);

    const result = await runStatusJson(databaseUri, [
      `--source-root=${sourceRoot()}`,
    ]);
    expect(result.status).toBe(0);
    const status = parseOne(result.stdout);
    expect({
      lastAttempt: status.lastAttempt,
      lastSuccessfulUpdate: status.lastSuccessfulUpdate,
      subsequentRuns: status.subsequentRuns,
    }).toStrictEqual({
      lastAttempt: summaryOf(failed, SHA_FAILED),
      lastSuccessfulUpdate: null,
      subsequentRuns: null,
    });
    expect(await dumpDatabase(databaseUri)).toEqual(before);
  }, 120_000);

  it("來源不合法、資料庫讀取失敗或必填欄位不合形狀:非零結束、stdout 沒有 JSON,stderr 只有固定代碼", async () => {
    const databaseUri = mongo.uri("drift");
    // base 與 project 有同一個 basename:來源不合法
    const duplicateRoot = sourceRoot();
    writeFileSync(
      path.join(duplicateRoot, "migrations", "project", BASE),
      PLAIN_MIGRATION,
    );
    // registry 載入時丟出帶連線字串的錯誤:不得回顯
    const throwingRoot = sourceRoot();
    writeFileSync(
      path.join(throwingRoot, "seeds", "registry.ts"),
      'throw new Error("mongodb://leak-user:F2_SOURCE_SECRET@db.example/x");\n',
    );
    for (const root of [duplicateRoot, throwingRoot]) {
      expect(
        outcome(await runStatusJson(databaseUri, [`--source-root=${root}`])),
      ).toEqual(failure("invalid-sources"));
    }
    expect(await collectionNames(databaseUri)).toEqual([]);

    const unreachable = await runStatusJson(
      "mongodb://status-user:status-secret@127.0.0.1:1/status?serverSelectionTimeoutMS=500",
      [`--source-root=${sourceRoot()}`],
    );
    expect(outcome(unreachable)).toEqual(failure("query-failed"));

    // 必填的 startedAt 不是日期:不輸出 startedAt 為 null 的「成功」結果
    const malformedUri = mongo.uri("malformed");
    await withDatabase(malformedUri, (database) =>
      database.collection("seed_update_runs").insertOne({
        ...runDocument({
          runId: "run-malformed",
          operation: "update",
          status: "succeeded",
          stage: "done",
          releaseCommit: SHA_OLD,
          startedAt: "00:00:00",
          finishedAt: "00:01:00",
        }),
        startedAt: "not a date",
      }),
    );
    const before = await dumpDatabase(malformedUri);
    expect(
      outcome(
        await runStatusJson(malformedUri, [`--source-root=${sourceRoot()}`]),
      ),
    ).toEqual(failure("malformed-state"));
    expect(await dumpDatabase(malformedUri)).toEqual(before);
  }, 120_000);
});
