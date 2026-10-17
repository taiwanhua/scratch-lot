import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  DEFINITION_SEED_ABSENT,
  type DefinitionSeedItemResult,
  type DefinitionSeedSet,
  definitionSeedId,
} from "@repo/domain/seed";

import type { Persisted } from "../database/base.repository";
import {
  type SeedDefinitionInstallationDocument,
  SeedDefinitionInstallationsRepository,
} from "../database/database.module";
import {
  SEED_INSTALLATION_STEPS,
  type SeedInstallationMode,
  type SeedInstallationStep,
} from "../database/schemas/seed-definition-installation.schema";
import type { FormOperatorFacts } from "../forms/form-access.service";
import { isDuplicateKeyError } from "../forms/forms-error";
import {
  type DefinitionAdapter,
  type DefinitionSnapshot,
  type IdentityMetadata,
  SeedConflictError,
  type VersionSnapshot,
  isSameIdentityMetadata,
} from "./definition-adapter";
import { FormDefinitionAdapter } from "./form-definition.adapter";
import { hashesOfSeed, shapeDefinitionSeed } from "./seed-content";
import { SeedInstallHooks } from "./seed-install-hooks";
import { WorkflowDefinitionAdapter } from "./workflow-definition.adapter";

type InstallationRecord = Persisted<SeedDefinitionInstallationDocument>;

/** 一次執行(一份請求)共用的事實:真實操作者、執行識別與設定版本。 */
export interface SeedRun {
  runId: string;
  releaseCommit: string;
  facts: FormOperatorFacts;
}

/** 一份宣告整形後要對照資料庫的目標:落庫內容的 hash 與身分上的 metadata。 */
interface Target {
  contentHash: string;
  identity: IdentityMetadata;
}

/** 零寫入的判斷結果:這份宣告在本環境該怎麼安裝。 */
type Plan =
  /** 目前(或已退役的最新)版本內容就是宣告:只記映射,不發版。 */
  | { action: "adopt"; definition: DefinitionSnapshot; localVersion: number }
  /** 目前版本內容就是宣告、目標是退役:記映射後照本地版號退役。 */
  | {
      action: "retire-existing";
      definition: DefinitionSnapshot;
      localVersion: number;
      mode: SeedInstallationMode;
    }
  /** 要經草稿發布一個新版本(`definition` 為 null = 連身分一起建)。 */
  | {
      action: "publish";
      definition: DefinitionSnapshot | null;
      mode: SeedInstallationMode;
    };

interface Prepared<TSeed extends DefinitionSeedSet> {
  adapter: DefinitionAdapter<TSeed>;
  /** 整形後的宣告(與設計服務存進資料庫的形狀相同)。 */
  seed: TSeed;
  target: Target;
  /** 原宣告的兩個 hash(協定回報、同 revision 不可變的比對)。 */
  hashes: { contentHash: string; snapshotHash: string };
}

function stepIndex(step: SeedInstallationStep): number {
  return SEED_INSTALLATION_STEPS.indexOf(step);
}

/**
 * 受管定義的安裝流程(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」)。
 *
 * 表單與流程共用同一套判斷,差異收在 `DefinitionAdapter`;**所有身分 / 版本寫入都經原設計服務**,
 * 這裡只決定「要不要寫、接著哪一步」,並在第一筆寫入前把所有權(預配置的 id、預期前置狀態、兩個 hash)
 * 記進安裝紀錄。整次安裝不包成單一交易(每個原服務動作各自是一個交易,ADR-0013):任何一步失敗就停在
 * 那一步之前,重跑時以**實體的實際狀態**找接續點 —— 預配置 id 的草稿還在就接著存 / 發布(發布是一個交易,
 * 不會停在發布到一半),已發布只差紀錄就核對後補記,所以不會重試成第二個正式版本。
 */
@Injectable()
export class DefinitionInstaller {
  private readonly adapters: readonly DefinitionAdapter[];

  constructor(
    private readonly installations: SeedDefinitionInstallationsRepository,
    private readonly hooks: SeedInstallHooks,
    formAdapter: FormDefinitionAdapter,
    workflowAdapter: WorkflowDefinitionAdapter,
  ) {
    this.adapters = [formAdapter, workflowAdapter];
  }

  /** 這份宣告的種類在某個操作下會用到的既有權限。 */
  permissionsFor(
    seed: DefinitionSeedSet,
    operation: "apply" | "inspect",
  ): readonly string[] {
    return this.adapterOf(seed).permissionsFor(operation);
  }

  /**
   * 寫入前的整批預檢(零寫入):回這份宣告的衝突,沒有為 null。
   * 涵蓋不依賴同批其他宣告的判斷(同 revision 異 hash、所有權、模組、現場漂移、非本次草稿、發布中斷);
   * 定義檢查器要等被引用的定義裝好才驗得了,留在 `apply` 該筆的寫入之前。
   */
  async preflight(
    run: SeedRun,
    rawSeed: DefinitionSeedSet,
  ): Promise<DefinitionSeedItemResult | null> {
    const prepared = this.prepare(rawSeed);
    let installation: InstallationRecord | null = null;
    try {
      installation = await this.findInstallation(run, prepared);
      if (installation === null) {
        await this.plan(run, prepared);
      } else if (installation.status === "installed") {
        await this.verifyInstalled(run, prepared, installation);
      } else {
        await this.assertResumable(run, prepared, installation);
      }
      return null;
    } catch (error) {
      return this.conflictResult(prepared, installation, error);
    }
  }

  /** 安裝或續跑一份宣告;衝突回在結果裡,其餘失敗照原樣丟出(下次以同一份紀錄接續)。 */
  async apply(
    run: SeedRun,
    rawSeed: DefinitionSeedSet,
  ): Promise<DefinitionSeedItemResult> {
    const prepared = this.prepare(rawSeed);
    let installation: InstallationRecord | null = null;
    try {
      installation = await this.findInstallation(run, prepared);
      if (installation?.status === "installed") {
        await this.verifyInstalled(run, prepared, installation);
        return this.doneResult(prepared, installation, "unchanged");
      }
      if (installation === null) {
        const plan = await this.plan(run, prepared);
        if (plan.action === "publish") {
          await this.assertValid(run, prepared);
        }
        installation = await this.reserve(run, prepared, plan);
      }
      installation = await this.proceed(run, prepared, installation);
      return this.doneResult(prepared, installation, installation.mode);
    } catch (error) {
      return this.conflictResult(prepared, installation, error);
    }
  }

  /**
   * 只核對既有映射與凍結的版本內容(允許已退役),不寫入、不改 `currentVersion` 或目前 metadata。
   * 受管 metadata 以安裝時保存的該版快照核對,不要求舊版的名稱仍等於目前身分的名稱。
   */
  async inspect(
    run: SeedRun,
    rawSeed: DefinitionSeedSet,
  ): Promise<DefinitionSeedItemResult> {
    const prepared = this.prepare(rawSeed);
    const { adapter, seed, hashes } = prepared;
    let installation: InstallationRecord | null = null;
    try {
      installation = await this.findInstallation(run, prepared);
      const definition = await adapter.findDefinition(run.facts, seed.key);
      const current = await this.currentOf(run, prepared, definition);
      if (installation?.status !== "installed") {
        return {
          kind: seed.kind,
          key: seed.key,
          revision: seed.revision,
          ...hashes,
          // 租戶的同 key 定義不是受管對象,不回它的 id
          definitionId: definition?.isShared ? String(definition.id) : null,
          localVersion: null,
          outcome: DEFINITION_SEED_ABSENT,
          conflict: null,
          ...current,
        };
      }
      const version = await this.requireMappedVersion(
        run,
        prepared,
        installation,
        definition,
      );
      if (
        version.contentHashWith(installation.metadata) !==
        installation.storedContentHash
      ) {
        throw new SeedConflictError(
          "CONTENT_MISMATCH",
          `${definitionSeedId(seed)} 對應的版本 ${String(installation.localVersion)} 內容與安裝時不同`,
        );
      }
      return {
        ...this.doneResult(prepared, installation, "unchanged"),
        ...current,
      };
    } catch (error) {
      return this.conflictResult(prepared, installation, error);
    }
  }

  // ---- 判斷(零寫入) ----

  private adapterOf<TSeed extends DefinitionSeedSet>(
    seed: TSeed,
  ): DefinitionAdapter<TSeed> {
    const adapter = this.adapters.find(
      (candidate) => candidate.kind === seed.kind,
    );
    if (adapter === undefined) {
      throw new Error(`沒有 ${seed.kind} 的安裝適配`);
    }
    return adapter as unknown as DefinitionAdapter<TSeed>;
  }

  private prepare<TSeed extends DefinitionSeedSet>(
    rawSeed: TSeed,
  ): Prepared<TSeed> {
    const adapter = this.adapterOf(rawSeed);
    const seed = shapeDefinitionSeed(rawSeed);
    return {
      adapter,
      seed,
      target: {
        contentHash: hashesOfSeed(seed).contentHash,
        identity: adapter.identityMetadataOf(seed),
      },
      hashes: hashesOfSeed(rawSeed),
    };
  }

  /** 這個 revision 的安裝紀錄;同 revision 的內容與已登記的不同 → 衝突(revision 不可改內容)。 */
  private async findInstallation(
    run: SeedRun,
    { seed, hashes }: Prepared<DefinitionSeedSet>,
  ): Promise<InstallationRecord | null> {
    const installation = await this.installations.findOne(run.facts.operator, {
      kind: seed.kind,
      key: seed.key,
      revision: seed.revision,
    });
    if (
      installation !== null &&
      installation.snapshotHash !== hashes.snapshotHash
    ) {
      throw new SeedConflictError(
        "REVISION_HASH_MISMATCH",
        `${definitionSeedId(seed)} 已登記過不同內容;內容或目標狀態有變請換新的 revision`,
      );
    }
    return installation;
  }

  /** 同 key、指向同一個定義的上次安裝(最近一次核對完成的)。 */
  private async lastInstalled(
    run: SeedRun,
    seed: DefinitionSeedSet,
    definitionId: Types.ObjectId,
  ): Promise<InstallationRecord | null> {
    const [last] = await this.installations.findMany(
      run.facts.operator,
      { kind: seed.kind, key: seed.key, status: "installed", definitionId },
      { sort: { installedAt: -1, _id: -1 }, limit: 1 },
    );
    return last ?? null;
  }

  private async plan(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
  ): Promise<Plan> {
    const { adapter, seed } = prepared;
    const { facts } = run;
    const id = definitionSeedId(seed);
    const unfinished = await this.installations.findOne(facts.operator, {
      kind: seed.kind,
      key: seed.key,
      status: "in-progress",
    });
    if (unfinished !== null) {
      throw new SeedConflictError(
        "INSTALLATION_IN_PROGRESS",
        `${id}:同 key 的 revision ${unfinished.revision} 安裝尚未完成,請先以該 revision 續跑`,
      );
    }
    const definition = await adapter.findDefinition(facts, seed.key);
    if (definition === null) {
      return { action: "publish", definition: null, mode: "created" };
    }
    this.assertOwnership(prepared, definition);
    // 這個 revision 還沒登記過,現場的任何草稿都不是這次安裝的:採納、退役、發新版都先報衝突
    await this.assertNoForeignDraft(run, prepared, null);
    const prior = await this.lastInstalled(run, seed, definition.id);
    const existing = await this.matchExisting(
      run,
      prepared,
      definition,
      prior === null ? "adopted" : "updated",
    );
    if (existing !== null) {
      await this.assertAdoptable(run, prepared, existing);
      return existing;
    }
    // 以下都要發布一個新版本:現場必須還是上次安裝留下的樣子
    if (prior === null) {
      throw new SeedConflictError(
        "UNMANAGED_DEFINITION",
        `${id}:同 key 的共用定義已存在且目前發布內容與宣告不同;請整理現場或重新匯出進版控`,
      );
    }
    await this.assertMatchesPrior(run, prepared, definition, prior);
    return { action: "publish", definition, mode: "updated" };
  }

  /**
   * 現場有不是這次安裝的設計草稿 → 衝突(安裝不丟棄、也不略過別人的草稿)。
   * `ownDraftId`:這次安裝預配置的草稿 id(還沒有自己的草稿時給 null,任何草稿都算別人的)。
   */
  private async assertNoForeignDraft(
    run: SeedRun,
    { adapter, seed }: Prepared<DefinitionSeedSet>,
    ownDraftId: Types.ObjectId | null,
  ): Promise<void> {
    const draft = await adapter.findDraft(run.facts, seed.key);
    if (draft !== null && ownDraftId?.equals(draft.id) !== true) {
      throw new SeedConflictError(
        "UNEXPECTED_DRAFT",
        `${definitionSeedId(seed)}:有不是這次安裝建立的設計草稿;請先發布或刪除草稿(安裝不丟棄現場草稿)`,
      );
    }
  }

  /**
   * 沿用既有版本(採納 / 照它退役)之前的完整核對,在記下任何東西之前:
   * 採納要現場已經是宣告的完整目標狀態(版本狀態、`currentVersion`、metadata、凍結內容、動態權限);
   * 照它退役要它此刻是完好的目前發布版(不是別人退役到一半的版本)。
   */
  private async assertAdoptable(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    plan: Exclude<Plan, { action: "publish" }>,
  ): Promise<void> {
    const { adapter, seed } = prepared;
    const version = await adapter.findVersionByNumber(
      run.facts,
      seed.key,
      plan.localVersion,
    );
    if (version === null) {
      throw new SeedConflictError(
        "VERSION_MISSING",
        `${definitionSeedId(seed)}:版本 ${String(plan.localVersion)} 不存在`,
      );
    }
    await this.assertSettled(
      run,
      prepared,
      plan.definition,
      version,
      plan.action === "adopt" ? seed.desiredStatus : "published",
    );
  }

  /** 現場已有內容等於宣告的版本時怎麼沿用它(不發新版);沒有回 null。 */
  private async matchExisting(
    run: SeedRun,
    { adapter, seed, target }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot,
    mode: SeedInstallationMode,
  ): Promise<Exclude<Plan, { action: "publish" }> | null> {
    const { facts } = run;
    const current =
      definition.currentVersion === null
        ? null
        : await adapter.findVersionByNumber(
            facts,
            seed.key,
            definition.currentVersion,
          );
    // 目前內容已等於這次要交付的:採納該版,保留 id / 歷史 / 分派,不另發一版
    if (
      current !== null &&
      definition.currentVersion !== null &&
      current.contentHashWith(definition.metadata) === target.contentHash
    ) {
      const localVersion = definition.currentVersion;
      return seed.desiredStatus === "published"
        ? { action: "adopt", definition, localVersion }
        : { action: "retire-existing", definition, localVersion, mode };
    }
    // 目標是退役:相符的最新版已退役且沒有目前版本 = 已在目標狀態(已退役的內容不會被重新發布)
    if (
      seed.desiredStatus === "retired" &&
      definition.currentVersion === null
    ) {
      const latest = await adapter.findLatestVersion(facts, seed.key);
      if (
        latest !== null &&
        latest.version !== null &&
        latest.status === "retired" &&
        latest.contentHashWith(definition.metadata) === target.contentHash
      ) {
        return { action: "adopt", definition, localVersion: latest.version };
      }
    }
    return null;
  }

  private assertOwnership(
    { adapter, seed }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot,
  ): void {
    const id = definitionSeedId(seed);
    if (!definition.isShared) {
      throw new SeedConflictError(
        "OWNER_MISMATCH",
        `${id}:同 key 的定義屬於租戶(客製),不會被受管定義接管`,
      );
    }
    const moduleKey = adapter.installationMetadataOf(seed).moduleKey;
    if (moduleKey !== undefined && definition.moduleKey !== moduleKey) {
      throw new SeedConflictError(
        "MODULE_MISMATCH",
        `${id}:既有表單掛在模組 ${String(definition.moduleKey)},宣告是 ${moduleKey}(模組建立後不可改)`,
      );
    }
  }

  /** 已受管改版的前提:目前內容符合上次安裝的版本(否則是現場漂移)。 */
  private async assertMatchesPrior(
    run: SeedRun,
    { adapter, seed }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot,
    prior: InstallationRecord,
  ): Promise<void> {
    const id = definitionSeedId(seed);
    const priorVersion =
      prior.localVersion === null
        ? null
        : await adapter.findVersionByNumber(
            run.facts,
            seed.key,
            prior.localVersion,
          );
    const expectedCurrent =
      prior.desiredStatus === "published" ? prior.localVersion : null;
    const expectedStatus =
      prior.desiredStatus === "published" ? "published" : "retired";
    if (
      definition.currentVersion !== expectedCurrent ||
      priorVersion?.status !== expectedStatus
    ) {
      throw new SeedConflictError(
        "CURRENT_VERSION_DRIFT",
        `${id}:目前版本是 ${String(definition.currentVersion)},上次安裝(revision ${prior.revision})留下的是 ${String(expectedCurrent)};現場另外發布或退役過`,
      );
    }
    if (!isSameIdentityMetadata(definition.metadata, prior.metadata)) {
      throw new SeedConflictError(
        "METADATA_DRIFT",
        `${id}:名稱或頁籤模板與上次安裝(revision ${prior.revision})不同;現場改過`,
      );
    }
    if (
      priorVersion.contentHashWith(definition.metadata) !==
      prior.storedContentHash
    ) {
      throw new SeedConflictError(
        "CONTENT_MISMATCH",
        `${id}:版本 ${String(prior.localVersion)} 的內容與上次安裝(revision ${prior.revision})不同`,
      );
    }
  }

  private async assertValid(
    run: SeedRun,
    { adapter, seed }: Prepared<DefinitionSeedSet>,
  ): Promise<void> {
    const issues = await adapter.validate(run.facts, seed);
    if (issues.length > 0) {
      throw new SeedConflictError(
        "DEFINITION_INVALID",
        `${definitionSeedId(seed)} 定義檢查不通過:${issues.join(";")}`,
      );
    }
  }

  /** 已記成功的紀錄仍核對實體:不能只看到紀錄就跳過缺失或被改過的資料。 */
  private async verifyInstalled(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
  ): Promise<void> {
    const { adapter, seed } = prepared;
    const definition = await adapter.findDefinition(run.facts, seed.key);
    const version = await this.requireMappedVersion(
      run,
      prepared,
      installation,
      definition,
    );
    // 已安裝的重跑也不略過別人的草稿(純 inspect 不走這裡)
    await this.assertNoForeignDraft(run, prepared, null);
    await this.assertSettled(run, prepared, definition, version);
  }

  /** 安裝紀錄指向的定義與版本都還在、id 相符。 */
  private async requireMappedVersion(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
    definition: DefinitionSnapshot | null,
  ): Promise<VersionSnapshot> {
    const { adapter, seed } = prepared;
    const id = definitionSeedId(seed);
    if (definition === null) {
      throw new SeedConflictError(
        "DEFINITION_MISSING",
        `${id}:安裝紀錄指向的定義已不存在`,
      );
    }
    if (!definition.id.equals(installation.definitionId)) {
      throw new SeedConflictError(
        "DEFINITION_ID_MISMATCH",
        `${id}:同 key 的定義不是安裝紀錄指向的那一筆`,
      );
    }
    this.assertOwnership(prepared, definition);
    const version =
      installation.localVersion === null
        ? null
        : await adapter.findVersionByNumber(
            run.facts,
            seed.key,
            installation.localVersion,
          );
    if (version === null) {
      throw new SeedConflictError(
        "VERSION_MISSING",
        `${id}:安裝紀錄指向的版本 ${String(installation.localVersion)} 不存在`,
      );
    }
    return version;
  }

  /**
   * 目標狀態已達成的核對(記成功之前、以及每次重跑):`currentVersion`、版本狀態、身分 metadata、
   * 凍結內容與動態權限都要符合宣告。`state` 預設是宣告的目標狀態;照既有版本退役之前則核對它
   * 此刻是完好的目前發布版。
   */
  private async assertSettled(
    run: SeedRun,
    { adapter, seed, target }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot | null,
    version: VersionSnapshot,
    state: DefinitionSeedSet["desiredStatus"] = seed.desiredStatus,
  ): Promise<void> {
    const id = definitionSeedId(seed);
    const isPublished = state === "published";
    const expectedCurrent = isPublished ? version.version : null;
    if (definition === null) {
      throw new SeedConflictError("DEFINITION_MISSING", `${id}:定義已不存在`);
    }
    if (
      definition.currentVersion !== expectedCurrent ||
      version.status !== state
    ) {
      throw new SeedConflictError(
        "CURRENT_VERSION_DRIFT",
        `${id}:版本 ${String(version.version)} 應為${isPublished ? "目前發布版" : "已退役且沒有目前版本"},` +
          `實際是 ${version.status}、目前版本 ${String(definition.currentVersion)}`,
      );
    }
    if (!isSameIdentityMetadata(definition.metadata, target.identity)) {
      throw new SeedConflictError(
        "METADATA_DRIFT",
        `${id}:名稱或頁籤模板與宣告不同;現場改過`,
      );
    }
    if (version.contentHashWith(target.identity) !== target.contentHash) {
      throw new SeedConflictError(
        "CONTENT_MISMATCH",
        `${id}:版本 ${String(version.version)} 的內容與宣告不同`,
      );
    }
    if (isPublished) {
      const missing = await adapter.missingPermissions(run.facts, seed);
      if (missing.length > 0) {
        throw new SeedConflictError(
          "PERMISSIONS_INCOMPLETE",
          `${id}:欄位級權限不齊(${missing.join("、")})`,
        );
      }
    }
  }

  // ---- 寫入 ----

  /**
   * 登記(所有權在第一筆身分 / 版本寫入前建立):預先配好定義與草稿的 id,記下當下的前置狀態。
   * 採納既有版本不需要任何身分 / 版本寫入,直接記成功。
   */
  private async reserve(
    run: SeedRun,
    { adapter, seed, target, hashes }: Prepared<DefinitionSeedSet>,
    plan: Plan,
  ): Promise<InstallationRecord> {
    const { definition } = plan;
    const now = new Date();
    const isAdopted = plan.action === "adopt";
    const step: SeedInstallationStep = isAdopted ? "installed" : "reserved";
    await this.hooks.reached(isAdopted ? "record-installed" : "reserve");
    try {
      return await this.installations.create(run.facts.operator, {
        kind: seed.kind,
        key: seed.key,
        revision: seed.revision,
        contentHash: hashes.contentHash,
        snapshotHash: hashes.snapshotHash,
        storedContentHash: target.contentHash,
        desiredStatus: seed.desiredStatus,
        status: isAdopted ? "installed" : "in-progress",
        step,
        mode: plan.action === "adopt" ? "adopted" : plan.mode,
        definitionId: definition?.id ?? new Types.ObjectId(),
        draftId: plan.action === "publish" ? new Types.ObjectId() : null,
        localVersion: plan.action === "publish" ? null : plan.localVersion,
        metadata: adapter.installationMetadataOf(seed),
        expected: {
          definitionExists: definition !== null,
          currentVersion: definition?.currentVersion ?? null,
          metadata: definition?.metadata ?? null,
        },
        runId: run.runId,
        releaseCommit: run.releaseCommit,
        checkpoints: [{ step, runId: run.runId, at: now }],
        installedAt: isAdopted ? now : null,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new SeedConflictError(
          "INSTALLATION_IN_PROGRESS",
          `${definitionSeedId(seed)}:另一個程序同時登記了這個 revision`,
        );
      }
      throw error;
    }
  }

  /** 從安裝紀錄接著做到核對完成;每一步先看實體是不是已在目標狀態。 */
  private async proceed(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    reserved: InstallationRecord,
  ): Promise<InstallationRecord> {
    if (reserved.status === "installed") {
      return reserved;
    }
    const { adapter, seed } = prepared;
    const { facts } = run;
    let installation = reserved;
    // 先把看得出來的現場衝突全部查完,才開始這一輪的任何寫入
    await this.assertResumable(run, prepared, installation);
    const definition = await this.ensureIdentity(run, prepared, installation);
    installation = await this.checkpoint(run, installation, "identity");

    let version: VersionSnapshot;
    if (installation.draftId === null) {
      version = await this.requireMappedVersion(
        run,
        prepared,
        installation,
        definition,
      );
    } else {
      [installation, version] = await this.ensurePublished(
        run,
        prepared,
        installation,
        definition,
      );
    }
    const localVersion = version.version;
    if (localVersion === null) {
      throw new Error(`${definitionSeedId(seed)}:發布後的版本沒有版號`);
    }
    if (seed.desiredStatus === "retired") {
      version = await this.ensureRetired(run, prepared, version);
      installation = await this.checkpoint(run, installation, "retired", {
        localVersion,
      });
    } else {
      installation = await this.checkpoint(run, installation, "published", {
        localVersion,
      });
    }
    await this.assertSettled(
      run,
      prepared,
      await adapter.findDefinition(facts, seed.key),
      version,
    );
    await this.hooks.reached("record-installed");
    return this.checkpoint(run, installation, "installed", {
      status: "installed",
      localVersion,
      installedAt: new Date(),
    });
  }

  /**
   * 未完成的安裝能不能接續(零寫入):整批預檢與每一輪續跑開頭都先過這一關,
   * 所以「改了名稱才發現有別人的草稿」不會發生 —— 身分、所有權、別人的草稿、`currentVersion`、
   * metadata 與自己草稿有沒有被改過,都在第一筆寫入之前判斷。
   */
  private async assertResumable(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
  ): Promise<void> {
    const { adapter, seed } = prepared;
    const id = definitionSeedId(seed);
    const definition = await adapter.findDefinition(run.facts, seed.key);
    if (definition === null) {
      if (installation.expected.definitionExists) {
        throw new SeedConflictError(
          "DEFINITION_MISSING",
          `${id}:登記時存在的定義已不存在`,
        );
      }
      return;
    }
    if (!definition.id.equals(installation.definitionId)) {
      throw new SeedConflictError(
        "DEFINITION_ID_MISMATCH",
        `${id}:同 key 的定義不是這次安裝登記的那一筆`,
      );
    }
    this.assertOwnership(prepared, definition);
    const ours =
      installation.draftId === null
        ? null
        : await adapter.findVersionById(
            run.facts,
            seed.key,
            installation.draftId,
          );
    await this.assertNoForeignDraft(run, prepared, installation.draftId);
    if (installation.draftId === null) {
      // 照既有版本退役:那一版只能是「還沒退役(目前版本)/ 已退役」
      const mapped = await this.requireMappedVersion(
        run,
        prepared,
        installation,
        definition,
      );
      await this.assertLegalStep(run, prepared, definition, mapped);
      return;
    }
    if (ours === null || ours.status === "draft") {
      this.assertPublishable(run, prepared, installation, definition, ours);
      return;
    }
    await this.assertLegalStep(run, prepared, definition, ours);
  }

  /**
   * 版本已有版號之後的續跑前提(零寫入):現場只能是**這次安裝自己合法步驟**留下的狀態 ——
   * 已發布且是目前版本、(目標是退役時)已退役。發布與退役都是一個交易,不會停在半路;
   * 其餘的 `currentVersion` / 版本狀態、名稱 / 頁籤模板或凍結內容不是宣告的值,
   * 都是外部漂移,在退役或記成功之前就拒絕。
   */
  private async assertLegalStep(
    run: SeedRun,
    { adapter, seed, target }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot,
    version: VersionSnapshot,
  ): Promise<void> {
    const id = definitionSeedId(seed);
    const current = definition.currentVersion;
    const isCurrent = current === version.version;
    const isLegal =
      (version.status === "published" && isCurrent) ||
      (version.status === "retired" &&
        seed.desiredStatus === "retired" &&
        current === null);
    if (!isLegal) {
      throw new SeedConflictError(
        "CURRENT_VERSION_DRIFT",
        `${id}:版本 ${String(version.version)} 是 ${version.status}、目前版本 ${String(current)};不是這次安裝留下的狀態,現場另外發布或退役過`,
      );
    }
    // 走到這裡 metadata 已是宣告的值(發新版時先改好才發布;照既有版本退役時登記前就相符)
    if (!isSameIdentityMetadata(definition.metadata, target.identity)) {
      throw new SeedConflictError(
        "METADATA_DRIFT",
        `${id}:名稱或頁籤模板與宣告不同;現場改過`,
      );
    }
    if (version.contentHashWith(target.identity) !== target.contentHash) {
      throw new SeedConflictError(
        "CONTENT_MISMATCH",
        `${id}:版本 ${String(version.version)} 的內容與宣告不同`,
      );
    }
    // 已是目前發布版(只差記成功,或接著要退役):該有的欄位級權限要齊
    if (version.status === "published" && isCurrent) {
      const missing = await adapter.missingPermissions(run.facts, seed);
      if (missing.length > 0) {
        throw new SeedConflictError(
          "PERMISSIONS_INCOMPLETE",
          `${id}:欄位級權限不齊(${missing.join("、")})`,
        );
      }
    }
  }

  /** 發布前(自己的版本還不存在或還是草稿)的現場前提;全部是讀取。 */
  private assertPublishable(
    run: SeedRun,
    { adapter, seed, target }: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
    definition: DefinitionSnapshot,
    ownDraft: VersionSnapshot | null,
  ): void {
    const id = definitionSeedId(seed);
    if (definition.currentVersion !== installation.expected.currentVersion) {
      throw new SeedConflictError(
        "CURRENT_VERSION_DRIFT",
        `${id}:目前版本是 ${String(definition.currentVersion)},登記時是 ${String(installation.expected.currentVersion)};現場另外發布或退役過`,
      );
    }
    // metadata:已是目標值(含自己先前的寫入),或還是登記時看到的值;其餘是現場改過
    const expected =
      installation.expected.metadata ?? adapter.initialMetadataOf(seed);
    if (
      !isSameIdentityMetadata(definition.metadata, target.identity) &&
      !isSameIdentityMetadata(definition.metadata, expected)
    ) {
      throw new SeedConflictError(
        "METADATA_DRIFT",
        `${id}:名稱或頁籤模板與登記時不同;現場改過`,
      );
    }
    if (
      ownDraft !== null &&
      ownDraft.draftRevision !== 0 &&
      ownDraft.contentHashWith(target.identity) !== target.contentHash
    ) {
      throw new SeedConflictError(
        "DRAFT_DRIFT",
        `${id}:這次安裝建立的草稿被改過(draftRevision ${String(ownDraft.draftRevision)})`,
      );
    }
  }

  /** 身分:不存在且登記時也不存在 → 以預配置的 id 建立;已存在則 id 必須相符。 */
  private async ensureIdentity(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
  ): Promise<DefinitionSnapshot> {
    const { adapter, seed } = prepared;
    const id = definitionSeedId(seed);
    let definition = await adapter.findDefinition(run.facts, seed.key);
    if (definition === null) {
      if (installation.expected.definitionExists) {
        throw new SeedConflictError(
          "DEFINITION_MISSING",
          `${id}:登記時存在的定義已不存在`,
        );
      }
      await this.hooks.reached("create-identity");
      await adapter.createIdentity(run.facts, seed, installation.definitionId);
      definition = await adapter.findDefinition(run.facts, seed.key);
    }
    if (definition === null) {
      throw new Error(`${id}:建立後讀不到定義`);
    }
    if (!definition.id.equals(installation.definitionId)) {
      throw new SeedConflictError(
        "DEFINITION_ID_MISMATCH",
        `${id}:同 key 的定義不是這次安裝登記的那一筆`,
      );
    }
    this.assertOwnership(prepared, definition);
    return definition;
  }

  /**
   * 讓預配置 id 的那一版成為已發布且 `currentVersion` 指向它(或已退役 —— 交給後面的步驟判斷)。
   * 依那一版現在的狀態接續:不存在 / 草稿 → metadata、草稿、存檔、發布(一個交易);已有版號 → 不再發布。
   */
  private async ensurePublished(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    reserved: InstallationRecord,
    definition: DefinitionSnapshot,
  ): Promise<[InstallationRecord, VersionSnapshot]> {
    const { adapter, seed } = prepared;
    const { facts } = run;
    const id = definitionSeedId(seed);
    const draftId = reserved.draftId;
    if (draftId === null) {
      throw new Error(`${id}:安裝紀錄沒有預配置的草稿 id`);
    }
    let installation = reserved;
    let ours = await adapter.findVersionById(facts, seed.key, draftId);
    if (ours === null || ours.status === "draft") {
      installation = await this.ensureDraftReady(
        run,
        prepared,
        installation,
        definition,
        ours,
      );
      const draft = await this.requireVersion(run, prepared, draftId);
      await this.hooks.reached("publish");
      await adapter.publish(facts, seed, draftId, draft.draftRevision, {
        definitionId: installation.definitionId,
        currentVersion: installation.expected.currentVersion,
      });
    }
    ours = await this.requireVersion(run, prepared, draftId);
    return [installation, ours];
  }

  /** 發布前的三步:metadata(條件更新)、預配置 id 的草稿、草稿內容 = 宣告。 */
  private async ensureDraftReady(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    reserved: InstallationRecord,
    definition: DefinitionSnapshot,
    existingDraft: VersionSnapshot | null,
  ): Promise<InstallationRecord> {
    const { adapter, seed, target } = prepared;
    const { facts } = run;
    const id = definitionSeedId(seed);
    const draftId = reserved.draftId;
    if (draftId === null) {
      throw new Error(`${id}:安裝紀錄沒有預配置的草稿 id`);
    }
    let installation = reserved;
    // 寫入之前再核對一次全部前提(續跑開頭查過;身分剛建好時這裡是第一次)
    await this.assertNoForeignDraft(run, prepared, draftId);
    this.assertPublishable(
      run,
      prepared,
      installation,
      definition,
      existingDraft,
    );
    // metadata:已是目標值(含自己先前的寫入)就跳過;否則以「同一筆定義、同一個目前版本、
    // 同一份 metadata」為條件更新 —— 比對之後現場另外發布 / 改名,原服務的條件更新不會命中
    if (!isSameIdentityMetadata(definition.metadata, target.identity)) {
      await this.hooks.reached("update-metadata");
      await adapter.updateMetadata(facts, seed, {
        definitionId: definition.id,
        currentVersion: definition.currentVersion,
        metadata: definition.metadata,
      });
    }
    installation = await this.checkpoint(run, installation, "metadata");

    let draft = existingDraft;
    if (draft === null) {
      await this.hooks.reached("create-draft");
      await adapter.createDraft(facts, seed.key, draftId);
      draft = await this.requireVersion(run, prepared, draftId);
    }
    installation = await this.checkpoint(run, installation, "draft");

    // 內容已是宣告(存過但檢查點沒記到)就不再存一次;存檔指名預配置的草稿 id
    if (draft.contentHashWith(target.identity) !== target.contentHash) {
      await this.hooks.reached("save-draft");
      await adapter.saveDraft(facts, seed, draftId, draft.draftRevision);
      draft = await this.requireVersion(run, prepared, draftId);
      if (draft.contentHashWith(target.identity) !== target.contentHash) {
        throw new SeedConflictError(
          "CONTENT_MISMATCH",
          `${id}:存進草稿的內容與宣告不同`,
        );
      }
    }
    return this.checkpoint(run, installation, "saved");
  }

  /** 明示退役:照本地版號退役;已退役且沒有目前版本就不再呼叫(不重複退役、不重複稽核)。 */
  private async ensureRetired(
    run: SeedRun,
    prepared: Prepared<DefinitionSeedSet>,
    version: VersionSnapshot,
  ): Promise<VersionSnapshot> {
    const { adapter, seed } = prepared;
    const { facts } = run;
    const id = definitionSeedId(seed);
    if (version.version === null) {
      throw new Error(`${id}:要退役的版本沒有版號`);
    }
    const definition = await adapter.findDefinition(facts, seed.key);
    const isCurrent = definition?.currentVersion === version.version;
    const isDone =
      version.status === "retired" && definition?.currentVersion === null;
    if (isDone) {
      return version;
    }
    // 只有「還是目前發布版」才退役(退役是一個交易,不會做到一半);其餘是現場另外發布 / 退役過
    if (!isCurrent || version.status !== "published") {
      throw new SeedConflictError(
        "CURRENT_VERSION_DRIFT",
        `${id}:版本 ${String(version.version)} 不是目前版本(目前 ${String(definition?.currentVersion ?? null)}),不退役別的版本`,
      );
    }
    // 自己的版本已發布,這時的草稿一定是別人的:退役也不略過它
    await this.assertNoForeignDraft(run, prepared, null);
    await this.hooks.reached("retire");
    await adapter.retire(facts, seed.key, version.version);
    return this.requireVersion(run, prepared, version.id);
  }

  private async requireVersion(
    run: SeedRun,
    { adapter, seed }: Prepared<DefinitionSeedSet>,
    versionId: Types.ObjectId,
  ): Promise<VersionSnapshot> {
    const version = await adapter.findVersionById(
      run.facts,
      seed.key,
      versionId,
    );
    if (version === null) {
      throw new Error(`${definitionSeedId(seed)}:讀不到這次安裝的版本`);
    }
    return version;
  }

  /** 記檢查點:只往前推;已經記到這一步(續跑)且沒有新欄位要寫就不重寫。 */
  private async checkpoint(
    run: SeedRun,
    installation: InstallationRecord,
    step: SeedInstallationStep,
    fields: {
      status?: "installed";
      localVersion?: number;
      installedAt?: Date;
    } = {},
  ): Promise<InstallationRecord> {
    const isAhead = stepIndex(installation.step) >= stepIndex(step);
    const isUnchanged =
      fields.status === undefined &&
      (fields.localVersion === undefined ||
        fields.localVersion === installation.localVersion);
    if (isAhead && isUnchanged) {
      return installation;
    }
    const updated = await this.installations.findOneAndUpdate(
      run.facts.operator,
      { _id: installation._id, status: "in-progress" },
      {
        $set: { ...fields, ...(isAhead ? {} : { step }) },
        $push: { checkpoints: { step, runId: run.runId, at: new Date() } },
      },
    );
    if (updated === null) {
      throw new Error(
        `安裝紀錄 ${String(installation._id)} 已不是進行中,無法記錄 ${step}`,
      );
    }
    return updated;
  }

  // ---- 結果 ----

  /** `inspect` 另附的目前狀態:`currentVersion` 與目前發布內容的 hash。 */
  private async currentOf(
    run: SeedRun,
    { adapter, seed }: Prepared<DefinitionSeedSet>,
    definition: DefinitionSnapshot | null,
  ): Promise<{
    currentVersion: number | null;
    currentContentHash: string | null;
  }> {
    // 租戶的同 key 定義不是受管對象,不回它的版本
    if (
      definition === null ||
      !definition.isShared ||
      definition.currentVersion === null
    ) {
      return { currentVersion: null, currentContentHash: null };
    }
    const { currentVersion } = definition;
    const current = await adapter.findVersionByNumber(
      run.facts,
      seed.key,
      currentVersion,
    );
    if (current === null) {
      return { currentVersion, currentContentHash: null };
    }
    const storedContentHash = current.contentHashWith(definition.metadata);
    // 目前版本是某次安裝留下的:回那份宣告的 hash(呼叫端拿來與宣告的 hash 比)
    const installed = await this.installations.findOne(run.facts.operator, {
      kind: seed.kind,
      key: seed.key,
      status: "installed",
      definitionId: definition.id,
      localVersion: currentVersion,
      storedContentHash,
    });
    return {
      currentVersion,
      currentContentHash: installed?.contentHash ?? storedContentHash,
    };
  }

  private doneResult(
    { seed, hashes }: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord,
    outcome: "created" | "updated" | "adopted" | "unchanged",
  ): DefinitionSeedItemResult {
    return {
      kind: seed.kind,
      key: seed.key,
      revision: seed.revision,
      ...hashes,
      definitionId: String(installation.definitionId),
      localVersion: installation.localVersion,
      outcome,
      conflict: null,
    };
  }

  /** 衝突 → 結果裡的 `conflict`(映射有就帶);不是衝突的錯照原樣丟出。 */
  private conflictResult(
    { seed, hashes }: Prepared<DefinitionSeedSet>,
    installation: InstallationRecord | null,
    error: unknown,
  ): DefinitionSeedItemResult {
    if (!(error instanceof SeedConflictError)) {
      throw error;
    }
    return {
      kind: seed.kind,
      key: seed.key,
      revision: seed.revision,
      ...hashes,
      definitionId:
        installation === null ? null : String(installation.definitionId),
      localVersion: installation?.localVersion ?? null,
      outcome: null,
      conflict: { code: error.code, message: error.message },
    };
  }
}
