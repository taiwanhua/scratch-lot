/**
 * migration 來源收集器:根目錄的歷史檔與之後新增的 `base/`、`project/`
 * (`docs/concepts/data-layer-and-isolation.md`「Migration 與設定順序」)。
 *
 * migrate-mongo 只掃一層平面目錄;這裡把三個來源收齊,交給 `plan.ts` 驗全域唯一的 basename 並排序。
 * 檔案本身是 metadata 正本:`seedDependencies` 與幾個檢查函式直接從模組的 export 讀,不另維護清單。
 */
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sourceFileHashOf } from "./content-hash";
import type { MigrationOrigin, MigrationSource } from "./plan";

/** 新 migration 的兩個子目錄(根目錄只留已發布的歷史檔)。 */
const SUBDIRECTORY_ORIGINS: Readonly<Record<string, MigrationOrigin>> = {
  base: "base",
  project: "project",
};

const MIGRATION_EXTENSION = ".js";

/** 來源目錄的內容不合規(不認得的項目、symlink、export 形狀不對)。此時還沒有任何寫入。 */
export class MigrationSourceError extends Error {
  override name = "MigrationSourceError";
}

/** migration 模組的 export(這裡只知道它們是函式,簽章由各 migration 自己定義)。 */
export interface MigrationModule {
  up?: unknown;
  down?: unknown;
  appliesTo?: unknown;
  assertSeedInstallable?: unknown;
  verify?: unknown;
  seedDependencies?: unknown;
}

/** 以絕對 file URL 載入原檔(它自己的相對 import 照原位置解析)。 */
export async function loadMigrationModule(
  filePath: string,
): Promise<MigrationModule> {
  return (await import(pathToFileURL(filePath).href)) as MigrationModule;
}

function seedDependenciesOf(
  module: MigrationModule,
  filePath: string,
): string[] {
  const { seedDependencies } = module;
  if (seedDependencies === undefined) {
    return [];
  }
  if (
    !Array.isArray(seedDependencies) ||
    !seedDependencies.every((item) => typeof item === "string")
  ) {
    throw new MigrationSourceError(
      `${filePath} 的 seedDependencies 必須是字串陣列(相對 seeds/ 的快照路徑)`,
    );
  }
  return seedDependencies;
}

function isFunction(value: unknown): boolean {
  return typeof value === "function";
}

async function sourceOf(
  filePath: string,
  origin: MigrationOrigin,
): Promise<MigrationSource> {
  const module = await loadMigrationModule(filePath);
  return {
    fileName: path.basename(filePath),
    origin,
    filePath,
    sourceHash: sourceFileHashOf(await readFile(filePath)),
    seedDependencies: seedDependenciesOf(module, filePath),
    exports: {
      up: isFunction(module.up),
      down: isFunction(module.down),
      appliesTo: isFunction(module.appliesTo),
      assertSeedInstallable: isFunction(module.assertSeedInstallable),
      verify: isFunction(module.verify),
    },
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 一層目錄裡的 migration 檔;symlink 與不認得的項目一律拒絕(不會被靜默略過)。 */
async function filesIn(
  directory: string,
  allowedSubdirectories: readonly string[],
): Promise<{ files: string[]; subdirectories: string[] }> {
  const files: string[] = [];
  const subdirectories: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new MigrationSourceError(
        `${target} 是 symlink;migration 來源不收 symlink`,
      );
    }
    if (entry.isDirectory() && allowedSubdirectories.includes(entry.name)) {
      subdirectories.push(entry.name);
    } else if (entry.isFile() && entry.name.endsWith(MIGRATION_EXTENSION)) {
      files.push(target);
    } else if (!entry.name.startsWith(".")) {
      throw new MigrationSourceError(
        `${target} 不是 migration 檔(只收 ${MIGRATION_EXTENSION};子目錄只有 base/ 與 project/)`,
      );
    }
  }
  return { files, subdirectories };
}

/**
 * 收齊三個來源的 migration(未排序、未驗唯一;那是 `buildUpdatePlan` 的事)。
 * `base/`、`project/` 不存在視為沒有新 migration。
 */
export async function collectMigrationSources(
  migrationsRoot: string,
): Promise<MigrationSource[]> {
  if (!(await exists(migrationsRoot))) {
    throw new MigrationSourceError(`migration 目錄不存在:${migrationsRoot}`);
  }
  const root = await filesIn(migrationsRoot, Object.keys(SUBDIRECTORY_ORIGINS));
  const sources: MigrationSource[] = [];
  for (const filePath of root.files) {
    sources.push(await sourceOf(filePath, "legacy"));
  }
  for (const name of root.subdirectories) {
    const origin = SUBDIRECTORY_ORIGINS[name];
    if (origin === undefined) {
      continue;
    }
    const { files } = await filesIn(path.join(migrationsRoot, name), []);
    for (const filePath of files) {
      sources.push(await sourceOf(filePath, origin));
    }
  }
  return sources;
}
