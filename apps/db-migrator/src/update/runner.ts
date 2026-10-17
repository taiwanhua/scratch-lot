/**
 * update 的執行器(`docs/concepts/data-layer-and-isolation.md`「Migration 與設定順序」)。
 *
 * `applyUpdatePlan` 依序:
 *
 * 1. 核對未完成的 journal(矛盾就拒絕,不會把它當成第一次)
 * 2. 逐支處理尚未成功的 migration(完整 filename 排序)。有未完成紀錄的沿用**保存的 context** 接續;
 *    第一次執行、且有 seed 依賴的才讀 `appliesTo`:沒有待轉換資料 → 以空的 definitions 執行 verify,
 *    通過才記成 no-op,不發布歷史種子;有待轉換資料 → 檢視依賴 → `assertSeedInstallable` →
 *    記 `preparing` → 逐筆安裝缺少的快照 → 記 `started`(含 context)→ `up` → `verify` → 記 `verified`
 *    → migrate-mongo 記 changelog
 * 3. 全部 migration 完成後套用目前的普通 registry(含 root),再依引用順序發布目前有效的定義
 * 4. 最後核對目前定義的目標內容
 *
 * 不取得也不釋放鎖:最外層命令(update、之後的 reset)持鎖後把 owner 傳進來,這裡每一步只核對。
 */
import type { Db, MongoClient } from "mongodb";

import {
  type DefinitionSeedItemResult,
  type DefinitionSeedSet,
  definitionSeedId,
  isDefinitionInstalled,
  isDefinitionSeedSet,
  isPlainRecord,
} from "@repo/domain/seed";

import {
  type SeedCounts,
  type SeedSetResult,
  formatCounts,
  runSeeds,
  sumCounts,
} from "../seed/seed-runner";
import type { DefinitionSeedClient } from "./definition-client";
import type { InstalledDefinitionResult } from "./definition-result";
import {
  InterruptedLifecycleError,
  findInterruptedLifecycles,
} from "./interrupted-lifecycles";
import {
  type InspectedDependency,
  type MigrationContext,
  type MigrationDefinitionContext,
  type MigrationJournalRecord,
  type MigrationStats,
  type RecordedInspection,
  UpdateJournal,
  UpdateJournalError,
} from "./journal";
import { type SeedLockHandle, assertSeedLockOwner } from "./lock";
import { applyMigration } from "./migrate-adapter";
import { loadMigrationModule } from "./migration-sources";
import type { PlannedMigration, PlannedSnapshot, UpdatePlan } from "./plan";
import type { UpdateHooks } from "./update-hooks";

export interface UpdateContext {
  database: Db;
  client: MongoClient;
  /** 最外層命令持有的鎖;這裡只核對 owner。 */
  lock: SeedLockHandle;
  /** root 初始帳號與 api 子程序要用的環境(`MONGODB_URI`、`ROOT_ADMIN_*`)。 */
  env: NodeJS.ProcessEnv;
  definitions: DefinitionSeedClient;
  hooks: UpdateHooks;
  print: (line: string) => void;
}

export type MigrationOutcome = "skipped" | "applied" | "noop";

export interface MigrationReport {
  fileName: string;
  outcome: MigrationOutcome;
  /** migration 的 `up` 回報的資料處理 / 跳過 / 衝突筆數(沒回報為 null)。 */
  stats: MigrationStats | null;
  /** 這次執行是否跑過它的 verify(`skipped` 與沒有 verify 的為 false)。 */
  verified: boolean;
}

export interface DefinitionReport {
  kind: string;
  key: string;
  revision: string;
  definitionId: string;
  /** 該環境的版號(revision → localVersion)。 */
  localVersion: number;
  outcome: string;
}

export interface RunReport {
  runId: string;
  /** 實際設定版本(與 api image 的 SHA 分開記)。 */
  releaseCommit: string;
  planHash: string;
  migrations: MigrationReport[];
  seeds: SeedSetResult[];
  totals: SeedCounts;
  definitions: DefinitionReport[];
}

/** migration 傳回的值或 export 不合契約。 */
export class MigrationContractError extends Error {
  override name = "MigrationContractError";
}

/** 最後核對沒過:目前定義的實際狀態不是宣告的目標。 */
export class UpdateVerifyError extends Error {
  override name = "UpdateVerifyError";
}

type MigrationCheck = (...args: unknown[]) => unknown;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `up` 回傳 `{ processed, skipped, conflicts }` 時收進報告;其餘回傳值不看。 */
function statsOf(result: unknown): MigrationStats | null {
  if (!isPlainRecord(result)) {
    return null;
  }
  const stats = {
    processed: countOf(result.processed),
    skipped: countOf(result.skipped),
    conflicts: countOf(result.conflicts),
  };
  return Object.values(stats).every((value) => value === null) ? null : stats;
}

function show(value: number | null): string {
  return value === null ? "-" : String(value);
}

function formatStats(stats: MigrationStats | null): string {
  if (stats === null) {
    return "資料筆數未回報";
  }
  return `資料 處理 ${show(stats.processed)} / 跳過 ${show(stats.skipped)} / 衝突 ${show(stats.conflicts)}`;
}

function contextOf(
  item: InstalledDefinitionResult,
): MigrationDefinitionContext {
  const { kind, key, revision, contentHash, snapshotHash } = item;
  return {
    kind,
    key,
    revision,
    contentHash,
    snapshotHash,
    definitionId: item.definitionId,
    localVersion: item.localVersion,
  };
}

function isSameMapping(
  left: Pick<MigrationDefinitionContext, "definitionId" | "localVersion">,
  right: Pick<MigrationDefinitionContext, "definitionId" | "localVersion">,
): boolean {
  return (
    left.definitionId === right.definitionId &&
    left.localVersion === right.localVersion
  );
}

function definitionsOf(
  dependencies: readonly PlannedSnapshot[],
): DefinitionSeedSet[] {
  return dependencies
    .map(({ seed }) => seed)
    .filter((seed) => isDefinitionSeedSet(seed));
}

function inspectedOf(
  dependency: PlannedSnapshot,
  item: DefinitionSeedItemResult | undefined,
): InspectedDependency {
  const { path, fileHash, seed, hashes } = dependency;
  const base = { path, fileHash, kind: seed.kind };
  if (!isDefinitionSeedSet(seed) || hashes === null || item === undefined) {
    return {
      ...base,
      key: null,
      revision: null,
      contentHash: null,
      snapshotHash: null,
      installed: false,
      definitionId: null,
      localVersion: null,
      currentVersion: null,
      currentContentHash: null,
    };
  }
  return {
    ...base,
    key: seed.key,
    revision: seed.revision,
    ...hashes,
    installed: isDefinitionInstalled(item),
    definitionId: item.definitionId,
    localVersion: item.localVersion,
    currentVersion: item.currentVersion ?? null,
    currentContentHash: item.currentContentHash ?? null,
  };
}

const OUTCOME_COUNTS: Readonly<Record<string, keyof SeedCounts>> = {
  created: "created",
  updated: "updated",
  adopted: "adopted",
  unchanged: "unchanged",
};

class UpdateRun {
  private readonly journal: UpdateJournal;
  private readonly migrations: MigrationReport[] = [];
  private definitions: InstalledDefinitionResult[] = [];
  private seeds: SeedSetResult[] = [];

  constructor(
    private readonly context: UpdateContext,
    private readonly plan: UpdatePlan,
  ) {
    this.journal = new UpdateJournal(context.database, context.lock);
  }

  async execute(): Promise<RunReport> {
    const { journal, plan, context } = this;
    await journal.beginRun(plan.planHash, "precheck");
    try {
      // 舊版(發布 / 退役交易化之前)留下的中斷:api 不會再接續,先擋下、不自動修
      const interrupted = await findInterruptedLifecycles(context.database);
      if (interrupted.length > 0) {
        throw new InterruptedLifecycleError(interrupted);
      }
      const open = await this.reconcile();
      await journal.setStage("migrations");
      for (const { fileName } of plan.applied) {
        this.report({
          fileName,
          outcome: "skipped",
          stats: null,
          verified: false,
        });
      }
      for (const planned of plan.pending) {
        this.report(
          await this.runMigration(planned, open.get(planned.source.fileName)),
        );
      }
      await journal.setStage("seeds");
      this.seeds = await runSeeds(context.database, plan.registry, {
        env: context.env,
        definitionHandler: (seeds) => this.publishCurrent(seeds),
      });
      if (plan.definitions.length === 0) {
        await context.hooks.reached("seeds-applied", null);
        await this.rebuildIndexesAfterFullReset();
      }
      await journal.setStage("verify");
      await this.verifyCurrent();
      const report = this.reportOf();
      await journal.finishRun("succeeded", { report });
      return report;
    } catch (error) {
      // 失敗也留下階段與已完成的部分;記不進去(例如鎖已被解除)不蓋掉原本的錯
      await journal
        .finishRun("failed", {
          error: messageOf(error),
          report: this.reportOf(),
        })
        .catch(() => {
          /* 見上 */
        });
      throw error;
    }
  }

  private report(entry: MigrationReport): void {
    this.migrations.push(entry);
    const { fileName, outcome, stats, verified } = entry;
    const verify = verified ? "verify 通過" : "沒有 verify";
    const detail: Record<MigrationOutcome, string> = {
      skipped: "skipped(已記在 changelog,不重跑)",
      applied: `applied(${formatStats(stats)};${verify})`,
      noop: `applied(no-op:沒有待轉換的資料;${verify})`,
    };
    this.context.print(`migration ${fileName}:${detail[outcome]}`);
  }

  private reportOf(): RunReport {
    const { lock } = this.context;
    return {
      runId: lock.runId,
      releaseCommit: lock.releaseCommit,
      planHash: this.plan.planHash,
      migrations: this.migrations,
      seeds: this.seeds,
      totals: sumCounts(this.seeds),
      definitions: this.definitions.map(
        ({ kind, key, revision, definitionId, localVersion, outcome }) => ({
          kind,
          key,
          revision,
          definitionId,
          localVersion,
          outcome,
        }),
      ),
    };
  }

  /**
   * 未完成的 journal 與目前的來源、changelog 對一遍:全部核對過才動任何紀錄。
   * 回傳「還要接續的」紀錄(以檔名查);矛盾一律丟錯,不因為這次沒有待處理的來源就略過。
   */
  private async reconcile(): Promise<Map<string, MigrationJournalRecord>> {
    const { journal, plan } = this;
    const sources = new Map(
      plan.sources.map((source) => [source.fileName, source]),
    );
    const applied = new Set(plan.applied.map(({ fileName }) => fileName));
    const resumable = new Map<string, MigrationJournalRecord>();
    const recorded: MigrationJournalRecord[] = [];
    for (const record of await journal.openMigrations()) {
      const { fileName, status } = record;
      if (status === "rollback-in-progress") {
        throw new UpdateJournalError(
          `${fileName} 的還原(down)尚未完成:請先以 migrate:down 接續完成,update 不會把它補記成功`,
        );
      }
      const source = sources.get(fileName);
      if (source === undefined) {
        throw new UpdateJournalError(
          `${fileName} 有未完成的執行紀錄(${status}),但來源檔已不存在;不能略過未完成的 migration`,
        );
      }
      if (source.sourceHash !== record.sourceHash) {
        throw new UpdateJournalError(
          `${fileName} 有未完成的執行紀錄(${status}),但來源檔內容與當時不同;已發布的 migration 不可改寫`,
        );
      }
      if (
        resumable.has(fileName) ||
        recorded.some((item) => item.fileName === fileName)
      ) {
        throw new UpdateJournalError(
          `${fileName} 有多筆未完成的執行紀錄,無法判斷要接續哪一筆`,
        );
      }
      if (!applied.has(fileName)) {
        resumable.set(fileName, record);
      } else if (status === "verified") {
        recorded.push(record);
      } else {
        throw new UpdateJournalError(
          `${fileName} 已記在 changelog,執行紀錄卻停在 ${status};兩者矛盾,請先查明再執行`,
        );
      }
    }
    await this.completeRecorded(recorded);
    return resumable;
  }

  /**
   * verify 已過、changelog 也已記,只差 journal 的最後一步:與其他接續一樣先核對依賴與映射都沒變,
   * 全部通過才補記(有一筆不符就一筆都不補)。
   */
  private async completeRecorded(
    recorded: readonly MigrationJournalRecord[],
  ): Promise<void> {
    for (const record of recorded) {
      const planned = this.plan.migrations.find(
        ({ source }) => source.fileName === record.fileName,
      );
      if (planned !== undefined) {
        await this.assertResumable(planned, record);
      }
    }
    for (const record of recorded) {
      await this.journal.transition(record, ["verified"], "applied");
    }
  }

  private async runMigration(
    planned: PlannedMigration,
    existing: MigrationJournalRecord | undefined,
  ): Promise<MigrationReport> {
    let record = existing ?? (await this.begin(planned));
    if (record.status === "preparing") {
      record = await this.prepare(planned, record);
    }
    return this.finish(planned, record);
  }

  private emptyContext(): MigrationContext {
    const { runId, releaseCommit } = this.context.lock;
    return { definitions: [], releaseCommit, runId };
  }

  /** 第一次執行:決定這一支怎麼走,並在任何依賴安裝之前把它記下來。 */
  private async begin(
    planned: PlannedMigration,
  ): Promise<MigrationJournalRecord> {
    const { source, dependencies } = planned;
    const { database, hooks } = this.context;
    const base = { fileName: source.fileName, sourceHash: source.sourceHash };
    if (source.seedDependencies.length === 0) {
      return this.journal.createMigration({
        ...base,
        status: "started",
        mode: "plain",
        inspection: null,
        context: this.emptyContext(),
      });
    }
    const module = await loadMigrationModule(source.filePath);
    const applies = await (module.appliesTo as MigrationCheck)(database);
    if (typeof applies !== "boolean") {
      throw new MigrationContractError(
        `${source.fileName} 的 appliesTo 必須回傳 boolean`,
      );
    }
    if (!applies) {
      return this.journal.createMigration({
        ...base,
        status: "started",
        mode: "noop",
        inspection: null,
        context: this.emptyContext(),
      });
    }
    const inspected = await this.inspect(dependencies);
    const inspection: RecordedInspection = {
      snapshots: inspected,
      // 普通種子每次都套用(冪等);定義只裝還沒安裝的
      pending: inspected
        .filter(({ installed }) => !installed)
        .map(({ path }) => path),
    };
    await (module.assertSeedInstallable as MigrationCheck)(database, {
      snapshots: inspected.map((item, index) => ({
        ...item,
        seed: dependencies[index]?.seed,
      })),
      pending: inspection.pending,
    });
    const record = await this.journal.createMigration({
      ...base,
      status: "preparing",
      mode: "convert",
      inspection,
      context: null,
    });
    await hooks.reached("migration-preparing", source.fileName);
    return record;
  }

  /** 檢視依賴閉包:定義問 api(只核對,不寫入),普通種子沒有安裝狀態可查。 */
  private async inspect(
    dependencies: readonly PlannedSnapshot[],
  ): Promise<InspectedDependency[]> {
    const items = await this.context.definitions.inspect(
      definitionsOf(dependencies),
    );
    const byId = new Map(items.map((item) => [definitionSeedId(item), item]));
    return dependencies.map((dependency) =>
      inspectedOf(
        dependency,
        isDefinitionSeedSet(dependency.seed)
          ? byId.get(definitionSeedId(dependency.seed))
          : undefined,
      ),
    );
  }

  /** 續跑時依賴必須還是記下的那幾份(路徑、檔案與快照 hash);不同就拒絕。 */
  private assertSameDependencies(
    planned: PlannedMigration,
    record: MigrationJournalRecord,
  ): void {
    const saved = (record.inspection?.snapshots ?? []).map(
      ({ path, fileHash, snapshotHash }) => ({ path, fileHash, snapshotHash }),
    );
    const now = planned.dependencies.map(({ path, fileHash, hashes }) => ({
      path,
      fileHash,
      snapshotHash: hashes?.snapshotHash ?? null,
    }));
    if (JSON.stringify(saved) !== JSON.stringify(now)) {
      throw new UpdateJournalError(
        `${record.fileName} 的依賴快照與未完成紀錄記下的不同;已發布的快照不可改寫,無法接續`,
      );
    }
  }

  /**
   * `preparing`:安裝依賴(第一次與續跑走同一段)。已安裝的只核對映射,還沒裝的逐筆安裝並各記一個檢查點;
   * 這裡不再讀 `appliesTo` 或 `assertSeedInstallable` —— 自己先前發布的內容不會被當成來源不符。
   */
  private async prepare(
    planned: PlannedMigration,
    preparing: MigrationJournalRecord,
  ): Promise<MigrationJournalRecord> {
    const { database, env, definitions, lock } = this.context;
    this.assertSameDependencies(planned, preparing);
    const plain = planned.dependencies
      .map(({ seed }) => seed)
      .filter((seed) => !isDefinitionSeedSet(seed));
    if (plain.length > 0) {
      await assertSeedLockOwner(database, lock);
      await runSeeds(database, plain, { env });
    }
    let record = preparing;
    const seeds = definitionsOf(planned.dependencies);
    const inspected = await definitions.inspect(seeds);
    for (const [index, seed] of seeds.entries()) {
      const item = inspected[index];
      const mapping =
        item !== undefined && isDefinitionInstalled(item)
          ? contextOf(item)
          : null;
      this.assertInspectedMapping(record, seed, mapping);
      record =
        mapping === null
          ? await this.installDependency(record, seed)
          : await this.adoptInstalled(record, mapping);
    }
    const installed = seeds.map((seed) => {
      const mapping = record.installed.find(
        (candidate) => definitionSeedId(candidate) === definitionSeedId(seed),
      );
      if (mapping === undefined) {
        throw new UpdateJournalError(
          `${record.fileName}:${definitionSeedId(seed)} 沒有安裝檢查點`,
        );
      }
      return mapping;
    });
    // context 的 runId / releaseCommit 是記下 preparing 的那次執行,續跑不換
    return this.journal.transition(record, ["preparing"], "started", {
      context: {
        definitions: installed,
        releaseCommit: record.releaseCommit,
        runId: record.runId,
      },
    });
  }

  /**
   * 記下 `preparing` 時就已安裝的依賴(`assertSeedInstallable` 看到的那個映射),接續時必須還在同一個映射上:
   * 不見了不另外重裝一份,換了也不改認新的。當時尚未安裝的不在此限(由這次安裝或接續)。
   */
  private assertInspectedMapping(
    record: MigrationJournalRecord,
    seed: DefinitionSeedSet,
    current: MigrationDefinitionContext | null,
  ): void {
    const original = record.inspection?.snapshots.find(
      ({ key, revision, kind }) =>
        kind === seed.kind && key === seed.key && revision === seed.revision,
    );
    if (
      original?.installed !== true ||
      original.definitionId === null ||
      original.localVersion === null
    ) {
      return;
    }
    const { definitionId, localVersion } = original;
    if (
      current === null ||
      !isSameMapping({ definitionId, localVersion }, current)
    ) {
      throw new UpdateJournalError(
        `${record.fileName}:${definitionSeedId(seed)} 在檢視時已安裝(版本 ${String(localVersion)}),現在的映射已不存在或不同(現場被改過),無法接續`,
      );
    }
  }

  /** 依賴已經安裝在環境裡:核對與檢查點一致,還沒記過就補記。 */
  private async adoptInstalled(
    record: MigrationJournalRecord,
    mapping: MigrationDefinitionContext,
  ): Promise<MigrationJournalRecord> {
    const id = definitionSeedId(mapping);
    const saved = record.installed.find(
      (candidate) => definitionSeedId(candidate) === id,
    );
    if (saved === undefined) {
      return this.journal.recordInstalled(record, mapping);
    }
    if (!isSameMapping(saved, mapping)) {
      throw new UpdateJournalError(
        `${record.fileName}:${id} 的映射與檢查點記下的不同(現場被改過),無法接續`,
      );
    }
    return record;
  }

  /** 依賴還沒安裝:交給 api 安裝(或接續它自己中斷的安裝),完成後記一個檢查點。 */
  private async installDependency(
    record: MigrationJournalRecord,
    seed: DefinitionSeedSet,
  ): Promise<MigrationJournalRecord> {
    const { database, definitions, hooks, lock } = this.context;
    const id = definitionSeedId(seed);
    if (
      record.installed.some((candidate) => definitionSeedId(candidate) === id)
    ) {
      throw new UpdateJournalError(
        `${record.fileName}:${id} 的檢查點記為已安裝,環境裡卻沒有這個 revision,無法接續`,
      );
    }
    await assertSeedLockOwner(database, lock);
    const [applied] = await definitions.apply([seed]);
    if (applied === undefined) {
      throw new MigrationContractError(`${id} 沒有安裝結果`);
    }
    await hooks.reached("dependency-installed", id);
    const updated = await this.journal.recordInstalled(
      record,
      contextOf(applied),
    );
    await hooks.reached("dependency-recorded", id);
    return updated;
  }

  /**
   * `started` / `verified` 的接續(含只差補記 changelog 或 journal 最後一步的):這支轉換當初依賴的快照
   * 必須還是記下的那幾份,保存的 context 指到的定義也必須還在原來的映射上。依賴只有普通種子、
   * definitions 是空的轉換照樣核對快照;沒有 seed 依賴的 migration 與 no-op 沒有可核對的依賴。
   */
  private async assertResumable(
    planned: PlannedMigration,
    record: MigrationJournalRecord,
  ): Promise<void> {
    if (record.mode !== "convert") {
      return;
    }
    this.assertSameDependencies(planned, record);
    const mappings = record.context?.definitions ?? [];
    if (mappings.length === 0) {
      return;
    }
    const inspected = await this.context.definitions.inspect(
      definitionsOf(planned.dependencies),
    );
    for (const saved of mappings) {
      const id = definitionSeedId(saved);
      const item = inspected.find(
        (candidate) => definitionSeedId(candidate) === id,
      );
      if (
        item === undefined ||
        !isDefinitionInstalled(item) ||
        !isSameMapping(saved, item)
      ) {
        throw new UpdateJournalError(
          `${record.fileName}:${id} 已不在保存的 context 記下的映射上(現場被改過),無法接續`,
        );
      }
    }
  }

  /**
   * `started` / `verified` → changelog:經 migrate-mongo 的單檔 wrapper 執行。`started` 會執行 up
   * (no-op 除外)再 verify;`verified` 只再核對一次,通過後補記 changelog。
   */
  private async finish(
    planned: PlannedMigration,
    started: MigrationJournalRecord,
  ): Promise<MigrationReport> {
    const { source } = planned;
    const { fileName } = source;
    const { database, client, hooks, lock } = this.context;
    const { context, mode } = started;
    if (context === null) {
      throw new UpdateJournalError(
        `${fileName} 的執行紀錄(${started.status})沒有保存 context,無法接續`,
      );
    }
    const runUp = started.status === "started" && mode !== "noop";
    if (started.status === "started") {
      await hooks.reached("migration-started", fileName);
    }
    // verify 已過、只差 changelog 的也一樣:依賴或映射變了就不補成功
    await this.assertResumable(planned, started);
    let record = started;
    let stats = started.stats;
    try {
      await applyMigration(database, client, source, {
        context,
        runUp,
        beforeUp: () => assertSeedLockOwner(database, lock),
        afterUp: async (result) => {
          stats = statsOf(result);
          await hooks.reached("migration-up-done", fileName);
        },
        afterVerify: async () => {
          if (record.status === "started") {
            record = await this.journal.transition(
              record,
              ["started"],
              "verified",
              { stats },
            );
          }
          await hooks.reached("migration-verified", fileName);
        },
      });
    } catch (error) {
      // no-op 的核對沒過:沒有寫入任何資料,結掉這筆,下次重新判斷有沒有待轉換的資料
      if (mode === "noop" && record.status === "started") {
        await this.journal
          .transition(record, ["started"], "failed", {
            error: messageOf(error),
          })
          .catch(() => {
            /* 記不進去不蓋掉原本的錯 */
          });
      }
      throw error;
    }
    await hooks.reached("migration-recorded", fileName);
    await this.journal.transition(record, ["verified"], "applied");
    return {
      fileName,
      outcome: mode === "noop" ? "noop" : "applied",
      stats,
      verified: source.exports.verify,
    };
  }

  /**
   * full reset 清掉了每個 collection 的索引,而目前沒有任何定義要發布(不會啟動 api 的 runtime):
   * 以空的 apply 請求啟動同一個 runtime,它啟動時會等全部登記 schema 的索引建好。root 已由普通種子建立,
   * 鎖的 owner 與操作者照樣核對;失敗就停在 `definitions` 階段,這次執行不會被記成成功。
   * 有定義時發布本來就會啟動 runtime;一般 update 與 data reset 不 drop 索引,不走這一步。
   */
  private async rebuildIndexesAfterFullReset(): Promise<void> {
    const { database, definitions, lock } = this.context;
    if (lock.operation !== "reset-full") {
      return;
    }
    await this.journal.setStage("definitions");
    await assertSeedLockOwner(database, lock);
    await definitions.apply([], { initializeRuntime: true });
  }

  /** 目前有效的定義:普通種子都套用之後,依引用順序交給 api 發布。 */
  private async publishCurrent(
    seeds: readonly DefinitionSeedSet[],
  ): Promise<SeedSetResult[]> {
    const { database, definitions, hooks, lock } = this.context;
    await hooks.reached("seeds-applied", null);
    await this.journal.setStage("definitions");
    await assertSeedLockOwner(database, lock);
    this.definitions = await definitions.apply(seeds);
    await hooks.reached("definitions-applied", null);
    return this.definitions.map((item) => {
      const counts: SeedCounts = {
        created: 0,
        updated: 0,
        adopted: 0,
        unchanged: 0,
      };
      const counted = OUTCOME_COUNTS[item.outcome];
      if (counted !== undefined) {
        counts[counted] += 1;
      }
      return {
        label: `${definitionSeedId(item)} → 版本 ${String(item.localVersion)}`,
        counts,
      };
    });
  }

  /** 最後核對:每一份目前定義都對應到剛才的映射,而且實際的目前版本就是宣告的目標。 */
  private async verifyCurrent(): Promise<void> {
    const { plan, definitions } = this;
    if (plan.definitions.length === 0) {
      return;
    }
    const inspected = await this.context.definitions.inspect(plan.definitions);
    const problems: string[] = [];
    for (const [index, seed] of plan.definitions.entries()) {
      const id = definitionSeedId(seed);
      const item = inspected[index];
      const applied = definitions.find(
        (candidate) => definitionSeedId(candidate) === id,
      );
      if (
        item === undefined ||
        applied === undefined ||
        !isDefinitionInstalled(item) ||
        !isSameMapping(applied, item)
      ) {
        problems.push(`${id} 沒有對應到這次安裝的版本`);
        continue;
      }
      const current = item.currentVersion ?? null;
      if (seed.desiredStatus === "retired") {
        if (current !== null) {
          problems.push(`${id} 應為已退役,目前版本卻是 ${String(current)}`);
        }
      } else if (
        current !== item.localVersion ||
        item.currentContentHash !== item.contentHash
      ) {
        problems.push(
          `${id} 應為目前發布版(版本 ${String(item.localVersion)}),實際目前版本是 ${String(current)}`,
        );
      }
    }
    if (problems.length > 0) {
      throw new UpdateVerifyError(
        `目標內容核對未通過:\n- ${problems.join("\n- ")}`,
      );
    }
  }
}

/**
 * 執行一份計畫。任何一步失敗都會丟錯(不會回報整批成功);已完成的部分留在 journal,
 * 下次以同一份來源重跑會接續。
 */
export async function applyUpdatePlan(
  context: UpdateContext,
  plan: UpdatePlan,
): Promise<RunReport> {
  const report = await new UpdateRun(context, plan).execute();
  for (const { label, counts } of report.seeds) {
    context.print(`${label}:${formatCounts(counts)}`);
  }
  return report;
}
