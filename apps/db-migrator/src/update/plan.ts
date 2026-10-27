/**
 * update 的純計畫(不碰資料庫、不讀檔):驗來源、依賴與歷史身分,排出這次要處理的 migration 與目前的種子。
 * 規則:`docs/concepts/data-layer-and-isolation.md`「Migration 與設定順序」。
 *
 * 輸入由收集器備好(`migration-sources.ts`、`seed-snapshots.ts`、changelog);任何一項不合就丟
 * `UpdatePlanError`(列出全部問題),此時還沒有任何寫入。
 */
import {
  type DefinitionSeedHashes,
  type DefinitionSeedSet,
  type PortableLookupProvider,
  type SeedRegistry,
  type SeedSet,
  definitionSeedFileName,
  definitionSeedId,
  isDefinitionSeedSet,
} from "@repo/domain/seed";

import { isValidMigrationFilename } from "../migration-filename";
import {
  SeedCompositionError,
  type SeedCompositionOptions,
  planSeedRegistry,
} from "../seed/seed-composition";
import {
  contentHashOf,
  definitionHashesOf,
  stableStringify,
} from "./content-hash";

/** migration 的來源:根目錄的九支歷史檔(`legacy`),或之後新增的 `base/`、`project/`。 */
export const MIGRATION_ORIGINS = ["legacy", "base", "project"] as const;

export type MigrationOrigin = (typeof MIGRATION_ORIGINS)[number];

/** migration 檔可以 export 的函式(檔案本身就是 metadata 正本)。 */
export interface MigrationExports {
  up: boolean;
  down: boolean;
  appliesTo: boolean;
  assertSeedInstallable: boolean;
  verify: boolean;
}

/** 一支 migration 檔(已讀出它 export 的 metadata)。 */
export interface MigrationSource {
  /** basename;就是 `changelog.fileName`,不帶 base / project 前綴。 */
  fileName: string;
  origin: MigrationOrigin;
  filePath: string;
  /** 檔案內容的 hash(續跑時核對來源沒被換過)。 */
  sourceHash: string;
  /** `seedDependencies`:相對 `seeds/` 的快照路徑。 */
  seedDependencies: readonly string[];
  exports: MigrationExports;
}

/** 一份不可變的 `.seed.ts` 快照(已載入並驗過 export)。 */
export interface SeedSnapshot {
  /** 相對 `seeds/` 的路徑(`base/revisions/…` 或 `project/revisions/…`)。 */
  path: string;
  fileHash: string;
  seed: SeedSet;
  /** `requiresSeeds`:這份快照的前置快照。 */
  requiresSeeds: readonly string[];
}

/** changelog 裡的一筆(migrate-mongo 寫的;這裡只讀)。 */
export interface AppliedMigration {
  fileName: string;
  appliedAt: Date;
}

/** 排進計畫的一份快照;定義另附兩個 hash。 */
export interface PlannedSnapshot {
  path: string;
  fileHash: string;
  seed: SeedSet;
  hashes: DefinitionSeedHashes | null;
}

/** 一支待處理的 migration 與它的依賴閉包(前置在前)。 */
export interface PlannedMigration {
  source: MigrationSource;
  dependencies: PlannedSnapshot[];
}

export interface UpdatePlan {
  /** 這次計畫的識別:來源檔、快照與目前種子的 hash(記進 `seed_update_runs`)。 */
  planHash: string;
  /** 全部來源,依完整 filename 排序。 */
  sources: MigrationSource[];
  /** 全部來源與各自的依賴閉包(已記在 changelog 的也在;核對未完成的紀錄時要對照)。 */
  migrations: PlannedMigration[];
  /** 尚未成功的 migration(依 filename),含各自的依賴閉包。 */
  pending: PlannedMigration[];
  /** changelog 裡有、來源也還在的。 */
  applied: AppliedMigration[];
  /** changelog 裡有、來源已不存在的(不重跑、不刪除,只列出)。 */
  orphaned: AppliedMigration[];
  /** 目前的 registry(migration 都完成後才套用)。 */
  registry: SeedRegistry;
  /** 專案宣告的可攜 lookup 來源(套用 registry 前的預檢再用一次)。 */
  lookupProviders: Readonly<Record<string, PortableLookupProvider>>;
  /** 目前有效的定義,依引用排好。 */
  definitions: DefinitionSeedSet[];
}

export interface UpdatePlanInput {
  current: SeedRegistry;
  /** 專案宣告的可攜 lookup 來源;目前 registry 與 migration 快照的預檢都用它。 */
  lookupProviders?: Readonly<Record<string, PortableLookupProvider>>;
  snapshots: readonly SeedSnapshot[];
  migrations: readonly MigrationSource[];
  applied: readonly AppliedMigration[];
}

/** 計畫檢查沒過;`problems` 逐項列出。此時還沒有任何寫入。 */
export class UpdatePlanError extends Error {
  override name = "UpdatePlanError";

  constructor(readonly problems: readonly string[]) {
    super(
      `update 計畫檢查未通過(尚未寫入任何資料):\n- ${problems.join("\n- ")}`,
    );
  }
}

/** 快照只能放在兩個來源的 `revisions/` 底下、檔名以 `.seed.ts` 結尾。 */
export const SEED_SNAPSHOT_PATH_PATTERN =
  /^(?:base|project)\/revisions\/[A-Za-z0-9][A-Za-z0-9._-]*\.seed\.ts$/;

export function isValidSeedSnapshotPath(snapshotPath: string): boolean {
  return (
    SEED_SNAPSHOT_PATH_PATTERN.test(snapshotPath) &&
    !snapshotPath.includes("..")
  );
}

function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

const SNAPSHOT_PATH_RULE =
  "只能是 base/revisions/ 或 project/revisions/ 底下的 .seed.ts";

/** 一份路徑清單(seedDependencies / requiresSeeds)的格式問題:重複與不合法的路徑。 */
function pathListProblems(owner: string, paths: readonly string[]): string[] {
  return [
    ...duplicatesOf(paths).map((path) => `${owner} 重複列了 ${path}`),
    ...paths
      .filter((path) => !isValidSeedSnapshotPath(path))
      .map((path) => `${owner}「${path}」不合法:${SNAPSHOT_PATH_RULE}`),
  ];
}

/** 一支 migration 自己的檢查:命名與必要的 export。 */
function migrationSourceProblems(migration: MigrationSource): string[] {
  const { fileName, origin, exports, seedDependencies } = migration;
  const label = `${origin}:${fileName}`;
  const problems = pathListProblems(
    `${label} 的 seedDependencies`,
    seedDependencies,
  );
  if (!isValidMigrationFilename(fileName)) {
    problems.push(
      `${label} 不符合命名規約 <時間戳>_<schema|data|cleanup>_<kebab-case>.js`,
    );
  }
  if (!exports.up) {
    problems.push(`${label} 沒有 export up`);
  }
  const missing = (
    ["appliesTo", "assertSeedInstallable", "verify"] as const
  ).filter((name) => !exports[name]);
  if (seedDependencies.length > 0 && missing.length > 0) {
    problems.push(
      `${label} 有 seedDependencies,必須同時 export ${missing.join("、")}`,
    );
  }
  return problems;
}

/** 來源檢查:命名、全域唯一的 basename、必要的 export。 */
function migrationProblems(migrations: readonly MigrationSource[]): string[] {
  const problems = migrations.flatMap((migration) =>
    migrationSourceProblems(migration),
  );
  const byName = new Map<string, MigrationSource>();
  for (const migration of migrations) {
    const existing = byName.get(migration.fileName);
    if (existing === undefined) {
      byName.set(migration.fileName, migration);
    } else {
      problems.push(
        `migration 檔名重複:${existing.filePath} 與 ${migration.filePath};所有來源的 basename 必須全域唯一(changelog 以它識別)`,
      );
    }
  }
  return problems;
}

/** 一份快照自己的檢查:路徑、種類、前置是否存在、定義的檔名。 */
function snapshotOwnProblems(
  { path, seed, requiresSeeds }: SeedSnapshot,
  byPath: ReadonlyMap<string, PlannedSnapshot>,
): string[] {
  const problems = pathListProblems(
    `快照 ${path} 的 requiresSeeds`,
    requiresSeeds,
  );
  if (!isValidSeedSnapshotPath(path)) {
    problems.push(`快照路徑「${path}」不合法:${SNAPSHOT_PATH_RULE}`);
  }
  if (seed.kind === "root-admin") {
    problems.push(
      `快照 ${path} 是 root 初始帳號;快照只收 documents / relations 與版本化定義`,
    );
  }
  problems.push(
    ...requiresSeeds
      .filter(
        (required) =>
          isValidSeedSnapshotPath(required) && !byPath.has(required),
      )
      .map((required) => `快照 ${path} 的前置 ${required} 不存在`),
  );
  if (
    isDefinitionSeedSet(seed) &&
    !path.endsWith(`/${definitionSeedFileName(seed)}`)
  ) {
    problems.push(
      `快照 ${path} 的內容是 ${definitionSeedId(seed)},檔名必須是 ${definitionSeedFileName(seed)}`,
    );
  }
  return problems;
}

/** 快照的檢查:各自的格式,加上同一個 revision 不可有兩份。 */
function snapshotProblems(
  snapshots: readonly SeedSnapshot[],
  byPath: ReadonlyMap<string, PlannedSnapshot>,
): string[] {
  const problems = [
    ...duplicatesOf(snapshots.map(({ path }) => path)).map(
      (path) => `快照 ${path} 被載入了兩次`,
    ),
    ...snapshots.flatMap((snapshot) => snapshotOwnProblems(snapshot, byPath)),
  ];
  const definitionOwners = new Map<string, string>();
  for (const { path, seed } of snapshots) {
    if (!isDefinitionSeedSet(seed)) {
      continue;
    }
    const id = definitionSeedId(seed);
    const owner = definitionOwners.get(id);
    if (owner === undefined) {
      definitionOwners.set(id, path);
    } else {
      problems.push(
        `${id} 有兩份快照(${owner} 與 ${path});同一個 revision 只能有一份,不能分放 base 與 project`,
      );
    }
  }
  return problems;
}

/** 以前置在前的順序展開一組快照路徑的閉包;缺檔與循環列成問題。 */
function closureOf(
  entries: readonly string[],
  usedBy: string,
  byPath: ReadonlyMap<
    string,
    PlannedSnapshot & { requiresSeeds: readonly string[] }
  >,
  problems: string[],
): PlannedSnapshot[] {
  const ordered: PlannedSnapshot[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (snapshotPath: string, trail: readonly string[]): void => {
    const current = state.get(snapshotPath);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(snapshotPath)), snapshotPath];
      problems.push(`快照依賴循環:${cycle.join(" → ")}`);
      return;
    }
    const snapshot = byPath.get(snapshotPath);
    if (snapshot === undefined) {
      if (trail.length === 0) {
        problems.push(`${usedBy} 依賴的快照 ${snapshotPath} 不存在`);
      }
      return;
    }
    state.set(snapshotPath, "visiting");
    for (const required of snapshot.requiresSeeds) {
      visit(required, [...trail, snapshotPath]);
    }
    state.set(snapshotPath, "done");
    const { path, fileHash, seed, hashes } = snapshot;
    ordered.push({ path, fileHash, seed, hashes });
  };
  for (const entry of entries) {
    visit(entry, []);
  }
  return ordered;
}

/**
 * 安裝順序照閉包的順序(requiresSeeds 排出來的),不自動重排:定義引用的另一份定義排在它後面就是問題。
 * `sorted` 是組裝檢查依引用排出的順序(沒有引用關係的維持原順序),兩者相對位置相反的那一對就是引用方與被引用方。
 */
function definitionOrderProblems(
  declared: readonly DefinitionSeedSet[],
  sorted: readonly DefinitionSeedSet[],
): string[] {
  for (const [index, user] of declared.entries()) {
    const referenced = declared
      .slice(index + 1)
      .find((later) => sorted.indexOf(later) < sorted.indexOf(user));
    if (referenced !== undefined) {
      return [
        `${definitionSeedId(user)} 引用的 ${definitionSeedId(referenced)} 排在它後面;請在快照的 requiresSeeds 列出前置(安裝順序照 requiresSeeds,不自動重排)`,
      ];
    }
  }
  return [];
}

/**
 * 一支 migration 的依賴閉包要**自成一份可驗的來源**,在任何寫入之前驗完:與目前 registry 同一套組裝檢查
 * (`planSeedRegistry`:普通種子的引用、定義的形狀與可攜性、定義引用的模組 / 欄位類別 / 表單、循環),
 * 只看閉包裡的快照 —— 歷史定義缺的前置不拿目前 registry 的宣告來補。
 */
function closureProblems(
  label: string,
  dependencies: readonly PlannedSnapshot[],
  options: SeedCompositionOptions,
): string[] {
  const seeds = dependencies
    .map(({ seed }) => seed)
    .filter((seed) => seed.kind !== "root-admin");
  if (seeds.length === 0) {
    return [];
  }
  let problems: readonly string[];
  try {
    const sorted = planSeedRegistry([{ origin: label, seeds }], options);
    problems = definitionOrderProblems(
      seeds.filter((seed) => isDefinitionSeedSet(seed)),
      sorted.filter((seed) => isDefinitionSeedSet(seed)),
    );
  } catch (error) {
    if (!(error instanceof SeedCompositionError)) {
      throw error;
    }
    ({ problems } = error);
  }
  return problems.map((problem) => `${label} 的依賴閉包:${problem}`);
}

/** 目前 registry 的定義與快照裡同一個 revision 的內容必須相同(同 revision 不可變)。 */
function currentDefinitionProblems(
  definitions: readonly DefinitionSeedSet[],
  snapshots: Iterable<PlannedSnapshot>,
): string[] {
  const snapshotHashes = new Map<string, PlannedSnapshot>();
  for (const snapshot of snapshots) {
    if (isDefinitionSeedSet(snapshot.seed)) {
      snapshotHashes.set(definitionSeedId(snapshot.seed), snapshot);
    }
  }
  return definitions.flatMap((definition) => {
    const snapshot = snapshotHashes.get(definitionSeedId(definition));
    return snapshot?.hashes != null &&
      snapshot.hashes.snapshotHash !==
        definitionHashesOf(definition).snapshotHash
      ? [
          `${definitionSeedId(definition)} 在目前 registry 的內容與快照 ${snapshot.path} 不同;同一個 revision 不可改內容`,
        ]
      : [];
  });
}

function planHashOf(
  sources: readonly MigrationSource[],
  snapshots: readonly SeedSnapshot[],
  registry: SeedRegistry,
): string {
  return contentHashOf(
    stableStringify({
      migrations: sources.map(({ fileName, sourceHash }) => ({
        fileName,
        sourceHash,
      })),
      snapshots: snapshots
        .map(({ path, fileHash }) => ({ path, fileHash }))
        .toSorted((left, right) => compareNames(left.path, right.path)),
      registry,
    }),
  );
}

/**
 * 驗來源、依賴與歷史身分並排出計畫。已在 changelog 的檔名一律不再執行(不比對內容、不重寫紀錄);
 * 尚未成功的依完整 filename 排序。
 */
export function buildUpdatePlan({
  current,
  lookupProviders = {},
  snapshots,
  migrations,
  applied,
}: UpdatePlanInput): UpdatePlan {
  const problems = migrationProblems(migrations);
  const byPath = new Map(
    snapshots.map((snapshot) => [
      snapshot.path,
      {
        ...snapshot,
        hashes: isDefinitionSeedSet(snapshot.seed)
          ? definitionHashesOf(snapshot.seed)
          : null,
      },
    ]),
  );
  problems.push(...snapshotProblems(snapshots, byPath));

  let registry: SeedRegistry = [];
  try {
    registry = planSeedRegistry([{ origin: "registry", seeds: current }], {
      lookupProviders,
    });
  } catch (error) {
    if (!(error instanceof SeedCompositionError)) {
      throw error;
    }
    problems.push(...error.problems);
  }
  const definitions = registry.filter((set) => isDefinitionSeedSet(set));
  problems.push(...currentDefinitionProblems(definitions, byPath.values()));

  const sources = migrations.toSorted((left, right) =>
    compareNames(left.fileName, right.fileName),
  );
  const sourceNames = new Set(sources.map(({ fileName }) => fileName));
  const appliedNames = new Set(applied.map(({ fileName }) => fileName));
  const planned: PlannedMigration[] = [];
  for (const source of sources) {
    const label = `${source.origin}:${source.fileName}`;
    const dependencies = closureOf(
      source.seedDependencies.filter((dependency) =>
        isValidSeedSnapshotPath(dependency),
      ),
      label,
      byPath,
      problems,
    );
    problems.push(...closureProblems(label, dependencies, { lookupProviders }));
    planned.push({ source, dependencies });
  }
  if (problems.length > 0) {
    throw new UpdatePlanError([...new Set(problems)]);
  }
  return {
    planHash: planHashOf(sources, snapshots, current),
    sources,
    migrations: planned,
    pending: planned.filter(({ source }) => !appliedNames.has(source.fileName)),
    applied: applied.filter(({ fileName }) => sourceNames.has(fileName)),
    orphaned: applied.filter(({ fileName }) => !sourceNames.has(fileName)),
    registry: current,
    lookupProviders,
    definitions,
  };
}
