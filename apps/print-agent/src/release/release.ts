import {
  PRINT_AGENT_PLATFORMS,
  type PrintAgentManifest,
  type PrintAgentPlatform,
  type PrintAgentRelease,
  type PrintAgentReleaseFile,
  isAgentVersionOutdated,
  parseAgentVersion,
  parsePrintAgentManifest,
  printAgentReleaseObjectPath,
} from "@repo/domain/printing";

/**
 * 發布:四個平台的壓縮檔名、執行平台對照,
 * 以及 `manifest.json` 的更新規則(格式正本:`@repo/domain/printing` 的 `PrintAgentManifest`)。
 * 由 `scripts/package-sea.ts`(打包)與 `scripts/update-manifest.ts`(發布 workflow)使用。
 */

/** 保留最近幾個版本(更舊的從 bucket 刪掉)。 */
export const PRINT_AGENT_RELEASES_KEPT = 3;

/** 壓縮檔名:Windows 是 zip,其他是 tar.gz。 */
export function archiveName(platform: PrintAgentPlatform): string {
  return platform === "windows-x64"
    ? `print-agent-${platform}.zip`
    : `print-agent-${platform}.tar.gz`;
}

/** 執行檔名。 */
export function executableName(platform: PrintAgentPlatform): string {
  return platform === "windows-x64" ? "print-agent.exe" : "print-agent";
}

/** 安裝檔所在的資料夾(`packaging/<os>/`)。 */
export function packagingDir(platform: PrintAgentPlatform): string {
  if (platform === "windows-x64") {
    return "windows";
  }
  return platform === "macos-arm64" ? "macos" : "linux";
}

/**
 * 目前這台機器對應的平台(SEA 用執行中的 Node 執行檔打包,只能打包本機平台);不支援的回 null
 * (例:Intel Mac、Windows arm64)。
 */
export function hostPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PrintAgentPlatform | null {
  const key = `${platform}-${arch}`;
  const map: Record<string, PrintAgentPlatform> = {
    "win32-x64": "windows-x64",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "darwin-arm64": "macos-arm64",
  };
  return map[key] ?? null;
}

export class ReleaseError extends Error {
  override readonly name = "ReleaseError";
}

export interface ReleaseUpdate {
  manifest: PrintAgentManifest;
  /** 超過保留數量、要從 bucket 刪掉的物件路徑(`print-agent/<版本>/<檔名>`)。 */
  removedObjects: string[];
}

/**
 * 把新版本加進 manifest:新版本放最前面、成為 `latest`;只留最近 `PRINT_AGENT_RELEASES_KEPT` 個。
 *
 * - 新版本必須是 `x.y.z`、四個平台各一個檔
 * - 已發布過的版本不能覆蓋;新版本必須大於目前的最新版本(要退版就發一個更大的版本號)
 * - 目前的 manifest 讀不懂時不更新(不覆蓋成只剩一版),由人處理
 */
export function addRelease(
  current: unknown,
  release: PrintAgentRelease,
  kept = PRINT_AGENT_RELEASES_KEPT,
): ReleaseUpdate {
  if (parseAgentVersion(release.version) === null) {
    throw new ReleaseError(`版本必須是 x.y.z:${release.version}`);
  }
  const platforms = release.files.map((file) => file.platform);
  for (const platform of PRINT_AGENT_PLATFORMS) {
    if (platforms.filter((value) => value === platform).length !== 1) {
      throw new ReleaseError(`缺少或重複的平台:${platform}`);
    }
  }
  let previous: PrintAgentRelease[] = [];
  if (current !== null && current !== undefined) {
    const parsed = parsePrintAgentManifest(current);
    if (parsed === null) {
      throw new ReleaseError("目前的 manifest.json 格式不正確,不更新");
    }
    if (parsed.releases.some((entry) => entry.version === release.version)) {
      throw new ReleaseError(`版本 ${release.version} 已發布過,請用新的版本號`);
    }
    if (!isAgentVersionOutdated(parsed.latest, release.version)) {
      throw new ReleaseError(
        `新版本 ${release.version} 必須大於目前的最新版本 ${parsed.latest}`,
      );
    }
    previous = parsed.releases;
  }
  const releases = [release, ...previous];
  const manifest: PrintAgentManifest = {
    latest: release.version,
    releases: releases.slice(0, kept),
  };
  if (parsePrintAgentManifest(manifest) === null) {
    throw new ReleaseError("產生的 manifest.json 格式不正確");
  }
  const removedObjects = releases
    .slice(kept)
    .flatMap((entry) =>
      entry.files.map((file) =>
        printAgentReleaseObjectPath(entry.version, file.name),
      ),
    );
  return { manifest, removedObjects };
}

const BUCKET_NAME = /^[a-z\d][\w.-]{1,220}[a-z\d]$/;

/**
 * 發布目標 bucket = 該環境 `deploy/env/<環境>.yaml` 的 `GCS_BUCKET_PRIVATE`(與 api 讀 manifest 的是同一個;
 * 不另設變數)。沒寫、被註解掉或不像 bucket 名稱都回 null(workflow 會停下來)。
 */
export function privateBucketOf(envYaml: string): string | null {
  const prefix = "GCS_BUCKET_PRIVATE:";
  const line = envYaml
    .split("\n")
    .map((entry) => entry.trimEnd())
    .find((entry) => entry.startsWith(prefix));
  if (line === undefined) {
    return null;
  }
  // 值後面可能有行尾註解;bucket 名稱不會有 #、引號或空白
  const value = (line.slice(prefix.length).split("#", 1)[0] ?? "")
    .trim()
    .replaceAll(/["']/g, "");
  return BUCKET_NAME.test(value) ? value : null;
}

/** 依平台順序排好的檔案清單(manifest 內的順序 = 下載按鈕的順序)。 */
export function sortFiles(
  files: readonly PrintAgentReleaseFile[],
): PrintAgentReleaseFile[] {
  return files.toSorted(
    (a, b) =>
      PRINT_AGENT_PLATFORMS.indexOf(a.platform) -
      PRINT_AGENT_PLATFORMS.indexOf(b.platform),
  );
}
