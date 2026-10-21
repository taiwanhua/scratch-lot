/**
 * 指令共用的三件事:輸出、必要環境變數、registry 載入(正本:ADR-0002)。
 *
 * `seed` 與 `reset` 兩支入口都以 tsx 直跑、都讀 `MONGODB_URI`、都要把 registry 當成
 * 「哪些文件是 seed 管的」的唯一正本,所以抽在這裡共用 —— 入口檔本身有 top-level await
 * 的副作用,不能互相 import。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PortableLookupProvider } from "@repo/domain/seed";

import { portableLookupProvidersOf } from "./seed/portable-lookup-providers";
import type { SeedRegistry } from "./seed/seed-declaration";

/** 預設的 registry:`apps/db-migrator/seeds/registry.ts`。 */
export const DEFAULT_REGISTRY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "seeds",
  "registry.ts",
);

/** `apps/db-migrator` 的根目錄(子行程的 cwd、node_modules 的解析起點)。 */
export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// 指令介面本身就是 stdout/stderr,不經 @repo/logger(那是應用程式的 log 通道,STRUCT-06)
export const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少 ${name} 環境變數(需含資料庫名稱,例:mongodb://127.0.0.1:27017/wowgo-base)`,
    );
  }
  return value;
}

/**
 * registry 檔(選填)具名匯出的 `seedLookupProviders`:專案宣告的可攜 lookup 來源,預檢 registry 時明確傳入。
 * 沒有匯出 = 空(只有底座的三種來源);形狀不合 → 拋錯(`portableLookupProvidersOf`)。
 */
export async function loadLookupProviders(
  registryPath: string,
): Promise<Readonly<Record<string, PortableLookupProvider>>> {
  const loaded = (await import(pathToFileURL(registryPath).href)) as {
    seedLookupProviders?: unknown;
  };
  return portableLookupProvidersOf(loaded.seedLookupProviders, registryPath);
}

export async function loadRegistry(
  registryPath: string,
): Promise<SeedRegistry> {
  const loaded = (await import(pathToFileURL(registryPath).href)) as {
    seedRegistry?: unknown;
  };
  if (!Array.isArray(loaded.seedRegistry)) {
    throw new TypeError(
      `registry 檔須具名匯出 seedRegistry 陣列:${registryPath}`,
    );
  }
  return loaded.seedRegistry as SeedRegistry;
}
