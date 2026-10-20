/* eslint-disable sonarjs/no-os-command-from-path -- 本機開發時以 git 讀目前的 commit:git 的安裝位置因機器而異,只能靠 PATH;不經 shell、參數固定、失敗就記 unknown;到期條件:無 */
/**
 * update 指令(`docs/deployment.md`「設定與資料更新」)。
 *
 * ```
 * pnpm --filter @repo/db-migrator run update                 完整更新:migration → 普通種子 → 定義 → 核對
 * pnpm --filter @repo/db-migrator run update --status        唯讀:所有來源的 migration 與 changelog、未完成紀錄、鎖
 * pnpm --filter @repo/db-migrator run update --status --json 唯讀:同上加執行紀錄的成功基準,輸出一個 JSON object(`status-json.ts`)
 * pnpm --filter @repo/db-migrator run update --down          還原最後一支已執行的 migration(只還原它的資料變更)
 * pnpm --filter @repo/db-migrator run update --unlock-owner=<token>   解除硬中止留下的鎖(先確認原程序已停止)
 * pnpm --filter @repo/db-migrator run update --check-cli     確認 api 的受管定義 CLI 已建置且啟動得起來
 * ```
 *
 * `migrate`、`seed`(`src/seed/run.ts`)是同一個入口的相容別名,兩者都執行完整更新;
 * `migrate:status`、`migrate:down` 分別是 `--status`、`--down`。注意 `update` 要寫 `pnpm … run update`:
 * 少了 `run`,pnpm 會把它當成自己的升級依賴指令。
 *
 * 本檔沒有載入時的副作用(入口檔才有),所以別名入口可以 import 它。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { type Db, MongoClient } from "mongodb";

import type {
  PortableLookupProvider,
  SeedLockOperation,
  SeedRegistry,
} from "@repo/domain/seed";

import {
  DEFAULT_REGISTRY_PATH,
  PACKAGE_ROOT,
  loadLookupProviders,
  loadRegistry,
  print,
  requireEnv,
} from "../cli";
import { formatCounts, prepareSeedRun } from "../seed/seed-runner";
import {
  assertDefinitionCliBuilt,
  createDefinitionSeedClient,
  probeDefinitionCli,
} from "./definition-client";
import { findOpenMigrations, findRecentRuns, recordUnlock } from "./journal";
import {
  type SeedLockHandle,
  currentSeedLock,
  unlockSeedLock,
  withSeedLock,
} from "./lock";
import { readAppliedMigrations } from "./migrate-adapter";
import { collectMigrationSources } from "./migration-sources";
import {
  type MigrationSource,
  type SeedSnapshot,
  type UpdatePlan,
  buildUpdatePlan,
} from "./plan";
import { rollbackLastMigration } from "./rollback";
import { type RunReport, applyUpdatePlan } from "./runner";
import { loadSeedSnapshots } from "./seed-snapshots";
import { resolveSourceCommit } from "./source-commit";
import {
  STATUS_JSON_FLAG,
  StatusJsonError,
  isStatusJsonRequest,
  readUpdateStatus,
  statusJsonErrorLine,
  statusJsonStep,
} from "./status-json";
import { NO_UPDATE_HOOKS, type UpdateHooks } from "./update-hooks";

const USAGE =
  "用法:update [registry 檔] [--registry=<檔>] [--source-root=<目錄>] [--status [--json] | --down | --unlock-owner=<token> | --check-cli]";

type UpdateAction = "update" | "status" | "down" | "unlock" | "check-cli";

interface UpdateArgs {
  action: UpdateAction;
  /** `seeds/` 與 `migrations/` 所在的目錄(預設是本套件;測試以夾具目錄驗證)。 */
  sourceRoot: string;
  registryPath: string;
  unlockOwner: string | null;
  /** status 以一個 JSON object 輸出(只搭配 `--status`)。 */
  json: boolean;
}

/** 一次指令可注入的東西:顯示名稱(別名)與檢查點(測試讓指定步驟中斷)。 */
export interface UpdateCommandOptions {
  /** 失敗訊息的前綴:`update`、`seed`、`migrate`。 */
  label: string;
  hooks?: UpdateHooks;
  env?: NodeJS.ProcessEnv;
}

const FLAG_ACTIONS: Readonly<Record<string, UpdateAction>> = {
  "--status": "status",
  "--down": "down",
  "--check-cli": "check-cli",
};

const JSON_FLAG = STATUS_JSON_FLAG;
/** 會寫入(或不是 status)的動作旗標:不能與 `--json` 併用。 */
const NON_STATUS_FLAGS: ReadonlySet<string> = new Set([
  "--down",
  "--check-cli",
  "--unlock-owner",
]);

function flagOf(argument: string): string {
  return argument.split("=", 1)[0] ?? "";
}

/**
 * `--json` 只用於唯讀的 status。一般參數是「最後一個動作為準」,這裡在讀來源與連資料庫之前另外收緊:
 * 不得混入其他動作、旗標不得重複(registry 的位置參數與 `--registry` 算同一個)、`--json` 不帶值。
 * 失敗一律是固定代碼 `invalid-arguments`,不回顯參數。
 */
function assertJsonStatusArgs(argv: readonly string[]): void {
  const seen = new Set<string>();
  for (const argument of argv) {
    const flag = argument.startsWith("--") ? flagOf(argument) : "--registry";
    if (
      (flag === JSON_FLAG && argument !== JSON_FLAG) ||
      NON_STATUS_FLAGS.has(flag) ||
      seen.has(flag)
    ) {
      throw new StatusJsonError("invalid-arguments");
    }
    seen.add(flag);
  }
  if (!seen.has("--status")) {
    throw new StatusJsonError("invalid-arguments");
  }
}

export function parseUpdateArgs(argv: readonly string[]): UpdateArgs {
  const json = isStatusJsonRequest(argv);
  if (json) {
    assertJsonStatusArgs(argv);
  }
  let action: UpdateAction = "update";
  let sourceRoot = PACKAGE_ROOT;
  let registryPath: string | null = null;
  let unlockOwner: string | null = null;
  // `--json` 已由 assertJsonStatusArgs 核對過,其餘照原本的規則解析
  for (const argument of argv.filter((item) => item !== JSON_FLAG || !json)) {
    const [flag = "", ...rest] = argument.split("=");
    const value = rest.join("=");
    const flagAction = FLAG_ACTIONS[argument];
    if (flagAction !== undefined) {
      action = flagAction;
    } else if (flag === "--unlock-owner" && value !== "") {
      action = "unlock";
      unlockOwner = value;
    } else if (flag === "--registry" && value !== "") {
      registryPath = path.resolve(value);
    } else if (flag === "--source-root" && value !== "") {
      sourceRoot = path.resolve(value);
    } else if (!argument.startsWith("--") && registryPath === null) {
      // seed 指令沿用的寫法:第一個參數是 registry 檔
      registryPath = path.resolve(argument);
    } else {
      throw new Error(`無法辨識的參數 ${argument}(${USAGE})`);
    }
  }
  const defaultRegistry =
    sourceRoot === PACKAGE_ROOT
      ? DEFAULT_REGISTRY_PATH
      : path.join(sourceRoot, "seeds", "registry.ts");
  return {
    action,
    sourceRoot,
    registryPath: registryPath ?? defaultRegistry,
    unlockOwner,
    json,
  };
}

/**
 * 這次執行的設定版本:Actions 上是 `GITHUB_SHA`(就是 checkout 的 commit),本機取 `git rev-parse HEAD`。
 * 它與 api image 的 SHA 分開記 —— 只改種子或 migration 的部署不會換 api image。
 */
export function resolveReleaseCommit(env: NodeJS.ProcessEnv): string {
  const fromActions = env.GITHUB_SHA;
  if (fromActions !== undefined && /^[0-9a-f]{7,40}$/.test(fromActions)) {
    return fromActions;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** 一次指令讀到的全部來源(還沒對照資料庫)。 */
export interface UpdateSources {
  registry: SeedRegistry;
  /** 專案宣告的可攜 lookup 來源(registry 檔的 `seedLookupProviders`);預檢明確傳入。 */
  lookupProviders: Readonly<Record<string, PortableLookupProvider>>;
  migrations: MigrationSource[];
  snapshots: SeedSnapshot[];
}

/**
 * 載入目前的 registry、三個來源的 migration 與它們依賴的快照(含遞迴前置)。
 * 全部在連資料庫之前完成:來源不合法時不會有任何寫入。
 */
export async function loadUpdateSources(
  sourceRoot: string,
  registryPath: string,
): Promise<UpdateSources> {
  const registry = await loadRegistry(registryPath);
  const lookupProviders = await loadLookupProviders(registryPath);
  const migrations = await collectMigrationSources(
    path.join(sourceRoot, "migrations"),
  );
  const snapshots = await loadSeedSnapshots(
    path.join(sourceRoot, "seeds"),
    migrations.flatMap(({ seedDependencies }) => seedDependencies),
  );
  return { registry, lookupProviders, migrations, snapshots };
}

/** 以目前的 changelog 排出計畫(唯讀)。 */
export async function planUpdate(
  database: Db,
  sources: UpdateSources,
): Promise<UpdatePlan> {
  return buildUpdatePlan({
    current: sources.registry,
    lookupProviders: sources.lookupProviders,
    snapshots: sources.snapshots,
    migrations: sources.migrations,
    applied: await readAppliedMigrations(database),
  });
}

/** 這份計畫會不會用到 api 的受管定義 CLI(目前有定義,或待處理的 migration 依賴定義快照)。 */
export function planNeedsDefinitionCli(plan: UpdatePlan): boolean {
  return (
    plan.definitions.length > 0 ||
    plan.pending.some(({ dependencies }) =>
      dependencies.some(({ hashes }) => hashes !== null),
    )
  );
}

/**
 * 整批成功後的摘要。最後一行固定是種子的 `seed 完成:新增 N / 更新 M / 認養 A / 未變 K`
 * (seed 指令沿用的輸出;失敗時不會有這一行)。
 */
function printSummary(report: RunReport): void {
  const count = (outcome: string): number =>
    report.migrations.filter((item) => item.outcome === outcome).length;
  for (const item of report.definitions) {
    print(
      `定義 ${item.kind}:${item.key}@${item.revision} → 版本 ${String(item.localVersion)}(${item.outcome})`,
    );
  }
  print(
    `update 摘要:commit ${report.releaseCommit};migration 執行 ${String(count("applied"))} / no-op ${String(count("noop"))} / 略過 ${String(count("skipped"))};目標內容核對通過`,
  );
  print(`seed 完成:${formatCounts(report.totals)}`);
}

async function withDatabase<T>(work: (client: MongoClient) => Promise<T>) {
  const client = await MongoClient.connect(requireEnv("MONGODB_URI"));
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

/**
 * 持鎖執行一段需要計畫的工作。計畫先在鎖外排一次(來源與依賴都通過才搶鎖,不合法時零寫入;
 * `operation` 是 update 時連受管定義 CLI 是否已建置也先確認),取得鎖之後再以當下的 changelog 重排,
 * 避免用到別的程序剛改過的狀態。
 */
async function withLockedPlan<T>(
  client: MongoClient,
  sources: UpdateSources,
  operation: SeedLockOperation,
  env: NodeJS.ProcessEnv,
  work: (lock: SeedLockHandle, plan: UpdatePlan) => Promise<T>,
): Promise<T> {
  const database = client.db();
  const plan = await planUpdate(database, sources);
  if (operation === "update" && planNeedsDefinitionCli(plan)) {
    assertDefinitionCliBuilt();
  }
  return withSeedLock(
    database,
    { operation, releaseCommit: resolveReleaseCommit(env) },
    async (lock) => work(lock, await planUpdate(database, sources)),
  );
}

async function runUpdate(
  args: UpdateArgs,
  { label, hooks = NO_UPDATE_HOOKS, env = process.env }: UpdateCommandOptions,
): Promise<void> {
  const sources = await loadUpdateSources(args.sourceRoot, args.registryPath);
  // 與低階 seed 同一個預檢(root 初始帳號的環境變數);定義的發布由下面接上的處理器負責
  prepareSeedRun(sources.registry, {
    env,
    lookupProviders: sources.lookupProviders,
    definitionHandler: () => Promise.resolve([]),
  });
  await withDatabase((client) =>
    withLockedPlan(client, sources, "update", env, async (lock, plan) => {
      print(
        `${label}:run ${lock.runId}、commit ${lock.releaseCommit}、待處理 migration ${String(plan.pending.length)} 支`,
      );
      const report = await applyUpdatePlan(
        {
          database: client.db(),
          client,
          lock,
          env,
          definitions: createDefinitionSeedClient({ lock, env }),
          hooks,
          print,
        },
        plan,
      );
      printSummary(report);
    }),
  );
}

async function runDown(
  args: UpdateArgs,
  { hooks = NO_UPDATE_HOOKS, env = process.env }: UpdateCommandOptions,
): Promise<void> {
  const sources = await loadUpdateSources(args.sourceRoot, args.registryPath);
  await withDatabase((client) =>
    withLockedPlan(client, sources, "migrate-down", env, (lock, plan) =>
      rollbackLastMigration(
        { database: client.db(), client, lock, hooks, print },
        plan,
      ),
    ),
  );
}

/** 唯讀:不取得鎖、不建立任何 collection。 */
async function runStatus(args: UpdateArgs): Promise<void> {
  const sources = await loadUpdateSources(args.sourceRoot, args.registryPath);
  await withDatabase(async (client) => {
    const database = client.db();
    const plan = await planUpdate(database, sources);
    const appliedAt = new Map(
      [...plan.applied, ...plan.orphaned].map((entry) => [
        entry.fileName,
        entry.appliedAt,
      ]),
    );
    const open = await findOpenMigrations(database);
    for (const { fileName, origin } of plan.sources) {
      const at = appliedAt.get(fileName);
      const unfinished = open.find((record) => record.fileName === fileName);
      print(
        [
          fileName,
          origin,
          at === undefined ? "PENDING" : at.toISOString(),
          ...(unfinished === undefined ? [] : [`未完成:${unfinished.status}`]),
        ].join("  "),
      );
    }
    for (const { fileName, appliedAt: at } of plan.orphaned) {
      print(`${fileName}  (來源已不存在)  ${at.toISOString()}`);
    }
    for (const record of open) {
      if (!plan.sources.some(({ fileName }) => fileName === record.fileName)) {
        print(`${record.fileName}  (來源已不存在)  未完成:${record.status}`);
      }
    }
    const lock = await currentSeedLock(database);
    print(
      lock === null
        ? "鎖:無"
        : `鎖:owner ${lock.owner}(run ${lock.runId}、${lock.operation}、開始於 ${lock.startedAt.toISOString()})`,
    );
    const [last] = await findRecentRuns(database, 1);
    if (last !== undefined) {
      print(
        `最近一次執行:${last.operation} ${last.status}(階段 ${last.stage}、commit ${last.releaseCommit}、run ${last.runId})`,
      );
    }
  });
}

/**
 * 唯讀:同 status 的查詢,輸出一個 JSON object(stdout 沒有其他文字)。
 * 失敗只丟固定代碼(`StatusJsonError`),原始錯誤不往外帶。
 */
async function runStatusJson(args: UpdateArgs): Promise<void> {
  const sources = await statusJsonStep("invalid-sources", () =>
    loadUpdateSources(args.sourceRoot, args.registryPath),
  );
  const sourceCommit = resolveSourceCommit({
    checkoutRoot: PACKAGE_ROOT,
    sourceRoot: args.sourceRoot,
    registryPath: args.registryPath,
  });
  const status = await statusJsonStep("query-failed", () =>
    withDatabase(async (client) => {
      const database = client.db();
      return readUpdateStatus(
        database,
        await planUpdate(database, sources),
        sourceCommit,
      );
    }),
  );
  print(JSON.stringify(status));
}

async function runUnlock(owner: string): Promise<void> {
  await withDatabase(async (client) => {
    const database = client.db();
    const removed = await unlockSeedLock(database, owner);
    await recordUnlock(database, removed);
    print(
      `已解除整批互斥鎖:owner ${removed.owner}(run ${removed.runId}、${removed.operation})。未完成的步驟留在執行紀錄裡,重新執行 update 會接續`,
    );
  });
}

/** 執行一次指令;失敗丟錯(由入口檔印出並設定結束碼)。 */
export async function runUpdateCommand(
  argv: readonly string[],
  options: UpdateCommandOptions,
): Promise<void> {
  const args = isStatusJsonRequest(argv)
    ? await statusJsonStep("invalid-arguments", () =>
        Promise.resolve().then(() => parseUpdateArgs(argv)),
      )
    : parseUpdateArgs(argv);
  switch (args.action) {
    case "update": {
      await runUpdate(args, options);
      return;
    }
    case "down": {
      await runDown(args, options);
      return;
    }
    case "status": {
      await (args.json ? runStatusJson(args) : runStatus(args));
      return;
    }
    case "unlock": {
      await runUnlock(args.unlockOwner ?? "");
      return;
    }
    case "check-cli": {
      await probeDefinitionCli(options.env ?? process.env);
      print("受管定義 CLI 可啟動");
    }
  }
}

/** 入口檔共用:執行並把失敗寫到 stderr、結束碼設為 1(exit 0 不會掩蓋未完成的更新)。 */
export async function runUpdateEntry(
  argv: readonly string[],
  options: UpdateCommandOptions,
): Promise<void> {
  try {
    await runUpdateCommand(argv, options);
  } catch (error: unknown) {
    if (isStatusJsonRequest(argv)) {
      // `--json`:只寫固定代碼,不帶別名前綴與原始錯誤
      process.stderr.write(`${statusJsonErrorLine(error)}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${options.label} 失敗:${message}\n`);
    }
    process.exitCode = 1;
  }
}
