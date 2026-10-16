/**
 * reset 指令(`docs/deployment.md`「資料庫還原(reset)」;判準正本 ADR-0002「還原(reset)」)。
 *
 * ```
 * pnpm --filter @repo/db-migrator reset --environment=<dev|staging|production> --mode=<data|full> \
 *   --confirm=reset:<environment>:<資料庫名>:<mode>
 * ```
 *
 * - `data`:只刪人建的資料(刪留計畫見 `reset-plan.ts`、`reset-retention.ts`)→ 以同一版來源執行 update 補齊目標。
 *   root 現值、模組初始值、目前 registry 受管定義的歷史版本與權限 id 都保留;有任何做到一半的 migration、
 *   安裝就整次拒絕(`reset-precheck.ts`)
 * - `full`:逐一 drop 整批鎖以外的每個 collection → 立即重建這次的執行紀錄 → 以同一版來源從空庫執行 update
 *
 * 流程(三個環境相同;production 沒有另外的永久拒絕):
 *
 * 1. 安全閥(`reset-safety.ts`):環境允許清單 + 完整的人工確認字串。不過即結束,此時還沒有連線
 * 2. 來源預檢(與 update 同一套):registry 組裝、migration 與快照、定義的可攜性與依賴、root 初始帳號的環境變數、
 *    受管定義 CLI 已建置。不過即結束,一筆都不刪
 * 3. 取得整批鎖(`reset-data` / `reset-full`),**同一把鎖涵蓋預檢、清除與內部的 update**:
 *    內部直接呼叫 `applyUpdatePlan`、api 子程序沿用同一個 owner,不外呼會重新搶鎖的 update 指令
 * 4. 失敗時留下證據再釋放鎖:執行紀錄記失敗與階段(`full` 清庫時連執行紀錄也會被清掉,所以重建它);
 *    連執行紀錄都寫不進去時**不釋放鎖**,階段留在鎖上。清除中途失敗後再次明確執行 `full` 會從還在的 collection 接著清
 *
 * 輸出只有環境、資料庫名、模式與各 collection 的筆數,不含連線字串與任何機密。
 * 本檔沒有載入時的副作用(入口檔才有),測試用的入口可以 import 它接上檢查點。
 */
import path from "node:path";

import { type Db, MongoClient } from "mongodb";

import {
  SEED_LOCK_COLLECTION,
  SEED_UPDATE_RUNS_COLLECTION,
} from "@repo/domain/seed";

import { DEFAULT_REGISTRY_PATH, PACKAGE_ROOT, print, requireEnv } from "../cli";
import { readRootAdminInput } from "../seed/root-admin";
import { formatCounts, prepareSeedRun } from "../seed/seed-runner";
import {
  type UpdateSources,
  loadUpdateSources,
  planNeedsDefinitionCli,
  planUpdate,
  resolveReleaseCommit,
} from "../update/command";
import {
  DEFINITION_CLI_PATH,
  assertDefinitionCliBuilt,
  createDefinitionSeedClient,
} from "../update/definition-client";
import {
  type RunRecord,
  type RunStage,
  UpdateJournal,
} from "../update/journal";
import {
  type SeedLockHandle,
  acquireSeedLock,
  recordSeedLockProgress,
  releaseSeedLock,
} from "../update/lock";
import { type UpdatePlan, buildUpdatePlan } from "../update/plan";
import { type RunReport, applyUpdatePlan } from "../update/runner";
import { NO_UPDATE_HOOKS, type UpdateHooks } from "../update/update-hooks";
import { NO_RESET_HOOKS, type ResetHooks } from "./reset-hooks";
import { ResetPrecheckError, findResetBlockers } from "./reset-precheck";
import { planDefinitionRetention } from "./reset-retention";
import {
  type ClearCallbacks,
  dropCollections,
  executeDataReset,
  listClearableCollections,
  planDataReset,
} from "./reset-runner";
import {
  RESET_ALLOW_ENV_NAME,
  RESET_ENVIRONMENTS,
  RESET_MODES,
  type ResetMode,
  findSafetyViolation,
  parseDatabaseName,
} from "./reset-safety";

const USAGE = `用法:reset --environment=<${RESET_ENVIRONMENTS.join("|")}> --mode=<${RESET_MODES.join("|")}> --confirm=reset:<environment>:<資料庫名>:<mode> [--registry=<檔>] [--source-root=<目錄>]`;

interface ResetArgs {
  mode: ResetMode;
  environment: string | undefined;
  confirm: string | undefined;
  /** `seeds/` 與 `migrations/` 所在的目錄(預設是本套件;測試以夾具目錄驗證)。 */
  sourceRoot: string;
  registryPath: string;
}

/** 一次指令可注入的東西:檢查點(測試讓指定步驟中斷)與環境。 */
export interface ResetCommandOptions {
  hooks?: ResetHooks;
  /** 內部 update 的檢查點。 */
  updateHooks?: UpdateHooks;
  env?: NodeJS.ProcessEnv;
  /** api 的受管定義 CLI(預設是同一個 checkout 建置出的固定路徑;只有測試會換)。 */
  definitionCliPath?: string;
}

const MODE_RULE = `--mode 必須是 ${RESET_MODES.join(" 或 ")}(${USAGE})`;

function isMode(value: string): value is ResetMode {
  return (RESET_MODES as readonly string[]).includes(value);
}

function requireValue(flag: string, value: string): string {
  if (value === "") {
    throw new Error(`${flag} 需要一個值(${USAGE})`);
  }
  return value;
}

export function parseResetArgs(argv: readonly string[]): ResetArgs {
  let mode: ResetMode | undefined;
  let environment: string | undefined;
  let confirm: string | undefined;
  let sourceRoot = PACKAGE_ROOT;
  let registryPath: string | null = null;
  for (const argument of argv) {
    const [flag, ...rest] = argument.split("=");
    const value = rest.join("=");
    // 錯誤訊息不回顯參數值:--confirm 可能被誤貼成連線字串
    switch (flag) {
      case "--mode": {
        if (!isMode(value)) {
          throw new Error(MODE_RULE);
        }
        mode = value;
        break;
      }
      // 空值與沒給同義,由安全閥拒絕並說明
      case "--environment": {
        environment = value;
        break;
      }
      case "--confirm": {
        confirm = value;
        break;
      }
      case "--registry": {
        registryPath = path.resolve(requireValue(flag, value));
        break;
      }
      case "--source-root": {
        sourceRoot = path.resolve(requireValue(flag, value));
        break;
      }
      default: {
        throw new Error(`無法辨識的參數(${USAGE})`);
      }
    }
  }
  if (!mode) {
    throw new Error(MODE_RULE);
  }
  const defaultRegistry =
    sourceRoot === PACKAGE_ROOT
      ? DEFAULT_REGISTRY_PATH
      : path.join(sourceRoot, "seeds", "registry.ts");
  return {
    mode,
    environment,
    confirm,
    sourceRoot,
    registryPath: registryPath ?? defaultRegistry,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 這次清除與重建的對象(都不是機密;出現在摘要與執行紀錄旁的輸出)。 */
interface ResetTargetSummary {
  environment: string;
  databaseName: string;
  mode: ResetMode;
}

interface ResetContext {
  database: Db;
  client: MongoClient;
  lock: SeedLockHandle;
  sources: UpdateSources;
  mode: ResetMode;
  /** root 初始帳號:`data` 模式靠它認出不刪的那個人。 */
  rootAccount: string;
  env: NodeJS.ProcessEnv;
  hooks: ResetHooks;
  updateHooks: UpdateHooks;
  definitionCliPath: string;
}

/** 目前走到哪:前三個是 reset 自己的階段,`update` 之後的階段由內部的 update 記。 */
type ResetPhase =
  Extract<RunStage, "precheck" | "reset-clear" | "reset-cleared"> | "update";

/** 持鎖後的一次 reset:預檢 → 清除 → 內部 update。不取得也不釋放鎖。 */
class ResetRun {
  private readonly journal: UpdateJournal;
  private phase: ResetPhase = "precheck";
  private planHash: string | null = null;

  constructor(private readonly context: ResetContext) {
    this.journal = new UpdateJournal(context.database, context.lock);
  }

  execute(): Promise<RunReport> {
    return this.context.mode === "data" ? this.resetData() : this.resetFull();
  }

  /**
   * 失敗後留下證據:執行紀錄記成失敗並帶著階段。回傳是否記成了 —— 記不進去時呼叫端不釋放鎖
   * (階段已在鎖上),不能讓一般錯誤在鎖釋放、執行紀錄又已清掉之後什麼都沒留下。
   */
  async recordFailure(error: unknown): Promise<boolean> {
    const message = messageOf(error);
    try {
      if (this.phase !== "update") {
        // full 清庫時先前建立的執行紀錄可能已被清掉:重建(upsert)後再記失敗
        await this.journal.beginRun(this.planHash, this.phase);
        await this.journal.finishRun("failed", { error: message });
        return true;
      }
      const run = await this.currentRun();
      if (run === null) {
        await this.journal.beginRun(this.planHash, "reset-cleared");
        await this.journal.finishRun("failed", { error: message });
      } else if (run.status !== "failed") {
        await this.journal.finishRun("failed", { error: message });
      } else if (run.stage === "precheck") {
        // 內部 update 停在它自己的預檢:這次已經清過資料,不能看起來像「預檢沒過、什麼都沒做」
        await this.journal.setStage("reset-cleared");
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 目前的階段(記在鎖上與失敗訊息裡)。 */
  get stage(): string {
    return this.phase;
  }

  /** 這次執行在 `seed_update_runs` 的紀錄(唯讀;被清掉或還沒建為 null)。 */
  private currentRun(): Promise<RunRecord | null> {
    const { database, lock } = this.context;
    return database
      .collection(SEED_UPDATE_RUNS_COLLECTION)
      .findOne<RunRecord>({ type: "run", runId: lock.runId });
  }

  /** 進入 reset 的下一個階段:執行紀錄與鎖都記(鎖已不在自己手上就丟錯,不再往下)。 */
  private async enter(
    stage: Exclude<ResetPhase, "update">,
    detail: string | null,
  ): Promise<void> {
    const { database, lock } = this.context;
    this.phase = stage;
    await recordSeedLockProgress(database, lock, { stage, detail });
    await this.journal.setStage(stage);
  }

  /**
   * 清除每個 collection 的前後:**動手之前**把「正要清第幾個」記在鎖上(清庫中唯一不會被清掉的地方;
   * 依 owner 條件寫入,鎖已不在自己手上就丟錯、這一個不清),清完後過檢查點。
   */
  private clearCallbacks(): ClearCallbacks {
    const { database, lock, hooks } = this.context;
    return {
      before: (collection, position, total) =>
        recordSeedLockProgress(database, lock, {
          stage: "reset-clear",
          detail: `${String(position)}/${String(total)}:${collection}`,
        }),
      after: (collection) =>
        hooks.reached("reset-collection-cleared", collection),
    };
  }

  private async resetData(): Promise<RunReport> {
    const { database, sources, lock, rootAccount, hooks } = this.context;
    const plan = await planUpdate(database, sources);
    this.planHash = plan.planHash;
    await this.journal.beginRun(plan.planHash, "precheck");
    const blockers = await findResetBlockers(database, lock.runId);
    if (blockers.length > 0) {
      throw new ResetPrecheckError(blockers);
    }
    const retention = await planDefinitionRetention(database, plan.definitions);
    const deletion = await planDataReset(
      database,
      plan.registry,
      rootAccount,
      retention.retained,
    );
    for (const line of retention.summary) {
      print(line);
    }
    for (const { collection, ids, kept } of deletion.collections) {
      print(
        `刪留計畫 ${collection}:刪除 ${String(ids.length)} 筆 / 保留 ${String(kept)} 筆`,
      );
    }
    await hooks.reached("reset-prechecked", null);
    await this.enter("reset-clear", null);
    const deletions = await executeDataReset(
      database,
      deletion,
      this.clearCallbacks(),
    );
    for (const { collection, deleted } of deletions) {
      print(`${collection}:刪除 ${String(deleted)} 筆`);
    }
    await this.enter("reset-cleared", null);
    await hooks.reached("reset-cleared", null);
    return this.update(plan);
  }

  private async resetFull(): Promise<RunReport> {
    const { database, sources, lock, hooks } = this.context;
    this.planHash = emptyDatabasePlan(sources).planHash;
    // 清除前先建一筆(清除前就失敗時有紀錄);它會跟著 seed_update_runs 一起被清掉,清完立即重建
    await this.journal.beginRun(this.planHash, "precheck");
    const names = await listClearableCollections(database);
    print(
      `刪留計畫 full:清除 ${String(names.length)} 個 collection 與其索引(${names.join("、")});保留 ${SEED_LOCK_COLLECTION}`,
    );
    await hooks.reached("reset-prechecked", null);
    await this.enter("reset-clear", `0/${String(names.length)}`);
    await dropCollections(database, names, this.clearCallbacks());
    // changelog 已清空:重新排計畫(全部 migration 待執行),並立即重建這次的執行紀錄
    const plan = await planUpdate(database, sources);
    this.phase = "reset-cleared";
    this.planHash = plan.planHash;
    await this.journal.beginRun(plan.planHash, "reset-cleared");
    await recordSeedLockProgress(database, lock, {
      stage: "reset-cleared",
      detail: null,
    });
    print(
      `full:已清除 ${String(names.length)} 個 collection(保留 ${SEED_LOCK_COLLECTION})`,
    );
    await hooks.reached("reset-cleared", null);
    return this.update(plan);
  }

  /** 以同一版來源、同一把鎖執行 update(不重新搶鎖;api 子程序沿用同一個 owner)。 */
  private update(plan: UpdatePlan): Promise<RunReport> {
    const { database, client, lock, env, updateHooks, definitionCliPath } =
      this.context;
    this.phase = "update";
    return applyUpdatePlan(
      {
        database,
        client,
        lock,
        env,
        definitions: createDefinitionSeedClient({
          lock,
          env,
          cliPath: definitionCliPath,
        }),
        hooks: updateHooks,
        print,
      },
      plan,
    );
  }
}

/** `full` 清庫之後的計畫:changelog 是空的,所有 migration 都待執行。 */
function emptyDatabasePlan(sources: UpdateSources): UpdatePlan {
  return buildUpdatePlan({
    current: sources.registry,
    snapshots: sources.snapshots,
    migrations: sources.migrations,
    applied: [],
  });
}

function printSummary(target: ResetTargetSummary, report: RunReport): void {
  const count = (outcome: string): number =>
    report.migrations.filter((item) => item.outcome === outcome).length;
  for (const item of report.definitions) {
    print(
      `定義 ${item.kind}:${item.key}@${item.revision} → 版本 ${String(item.localVersion)}(${item.outcome})`,
    );
  }
  print(
    `reset(${target.mode})完成:環境 ${target.environment}、資料庫 ${target.databaseName}、模式 ${target.mode}、commit ${report.releaseCommit};migration 執行 ${String(count("applied"))} / no-op ${String(count("noop"))} / 略過 ${String(count("skipped"))};目標內容核對通過`,
  );
  print(`seed 完成:${formatCounts(report.totals)}`);
}

/** 持鎖執行;失敗時先留下證據,記得進去才釋放鎖。 */
async function runLocked(
  context: Omit<ResetContext, "lock">,
  target: ResetTargetSummary,
): Promise<void> {
  const { database, mode, env } = context;
  const lock = await acquireSeedLock(database, {
    operation: `reset-${mode}`,
    releaseCommit: resolveReleaseCommit(env),
  });
  print(
    `reset:環境 ${target.environment}、資料庫 ${target.databaseName}、模式 ${mode}(run ${lock.runId}、commit ${lock.releaseCommit})`,
  );
  const run = new ResetRun({ ...context, lock });
  let report: RunReport;
  try {
    report = await run.execute();
  } catch (error) {
    if (await run.recordFailure(error)) {
      await releaseSeedLock(database, lock);
      throw error;
    }
    throw new Error(
      `${messageOf(error)}\n失敗紀錄寫不進執行紀錄,整批鎖未釋放、階段(${run.stage})留在鎖上作為證據:owner ${lock.owner}。查明後以 update --unlock-owner=${lock.owner} 解除`,
      { cause: error },
    );
  }
  await releaseSeedLock(database, lock);
  printSummary(target, report);
}

/** 執行一次指令;失敗丟錯(由入口檔印出並設定結束碼)。 */
export async function runResetCommand(
  argv: readonly string[],
  options: ResetCommandOptions = {},
): Promise<void> {
  const {
    hooks = NO_RESET_HOOKS,
    updateHooks = NO_UPDATE_HOOKS,
    env = process.env,
    definitionCliPath = DEFINITION_CLI_PATH,
  } = options;
  const args = parseResetArgs(argv);
  const { mode, environment } = args;
  const uri = requireEnv("MONGODB_URI");
  const databaseName = parseDatabaseName(uri);

  const violation = findSafetyViolation({
    databaseName,
    environment,
    mode,
    confirm: args.confirm,
    allowEnv: env[RESET_ALLOW_ENV_NAME],
  });
  if (violation !== null || environment === undefined) {
    throw new Error(violation ?? USAGE);
  }

  // 刪除之前把之後的 update 跑不跑得完先確認掉:來源(registry 組裝、migration、快照、定義的可攜性與依賴)
  // 與 root 初始帳號的環境變數(`data` 還要靠 account 認出「不刪的那個人」)。不通過就一筆都不刪
  const sources = await loadUpdateSources(args.sourceRoot, args.registryPath);
  prepareSeedRun(sources.registry, {
    env,
    definitionHandler: () => Promise.resolve([]),
  });
  const { account } = readRootAdminInput(env);

  const client = await MongoClient.connect(uri);
  try {
    const database = client.db();
    // 鎖外先排一次計畫:任何一項不合就還沒搶鎖、也還沒有寫入;受管定義 CLI 是否已建置也在這裡確認。
    // full 一律需要它:清掉的索引靠 api 的 runtime 建回,沒有登記任何定義時也一樣
    const preview =
      mode === "full"
        ? emptyDatabasePlan(sources)
        : await planUpdate(database, sources);
    if (mode === "full" || planNeedsDefinitionCli(preview)) {
      assertDefinitionCliBuilt(definitionCliPath);
    }
    await runLocked(
      {
        database,
        client,
        sources,
        mode,
        rootAccount: account,
        env,
        hooks,
        updateHooks,
        definitionCliPath,
      },
      { environment, databaseName, mode },
    );
  } finally {
    await client.close();
  }
}

/** 訊息裡若帶到連線字串、其中的密碼或 root 初始密碼,一律遮掉(輸出只留資料庫名)。 */
function redactSecrets(message: string, env: NodeJS.ProcessEnv): string {
  const secrets = [env.MONGODB_URI, env.ROOT_ADMIN_PASSWORD];
  try {
    const { password } = new URL(env.MONGODB_URI ?? "");
    secrets.push(password, decodeURIComponent(password));
  } catch {
    // 不是合法的連線字串:沒有可拆的密碼
  }
  let redacted = message;
  for (const secret of secrets) {
    if (secret !== undefined && secret !== "") {
      redacted = redacted.replaceAll(secret, "***");
    }
  }
  return redacted;
}

/** 入口檔共用:執行並把失敗寫到 stderr、結束碼設為 1。 */
export async function runResetEntry(
  argv: readonly string[],
  options: ResetCommandOptions = {},
): Promise<void> {
  try {
    await runResetCommand(argv, options);
  } catch (error: unknown) {
    const message = redactSecrets(messageOf(error), options.env ?? process.env);
    process.stderr.write(`reset 失敗:${message}\n`);
    process.exitCode = 1;
  }
}
