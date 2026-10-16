/**
 * 代理程式安裝檔的發布位置與 `manifest.json` 格式(底座規格第 6 章「發布」「下載與安裝」):
 *
 * ```
 * <私有 bucket>/print-agent/
 *  ├ manifest.json          最新版本、各版本、各檔案的 SHA-256
 *  └ <版本>/                四個平台的壓縮檔
 * ```
 *
 * 發布 workflow 寫 manifest,API 讀它並簽 1 小時的下載網址。
 */

/** bucket 內的前綴(API 只對這個前綴下的物件簽下載網址)。 */
export const PRINT_AGENT_RELEASE_PREFIX = "print-agent";

/** manifest 的物件路徑。 */
export const PRINT_AGENT_MANIFEST_PATH = `${PRINT_AGENT_RELEASE_PREFIX}/manifest.json`;

/** 下載網址效期(1 小時)。 */
export const PRINT_AGENT_DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;

/** 四個平台(順序 = 下載按鈕的順序)。 */
export const PRINT_AGENT_PLATFORMS = [
  "windows-x64",
  "linux-x64",
  "linux-arm64",
  "macos-arm64",
] as const;
export type PrintAgentPlatform = (typeof PRINT_AGENT_PLATFORMS)[number];

/** 一個平台的壓縮檔。 */
export interface PrintAgentReleaseFile {
  platform: PrintAgentPlatform;
  /** 檔名(如 `print-agent-windows-x64.zip`);物件路徑 = `print-agent/<版本>/<檔名>`。 */
  name: string;
  /** 小寫十六進位 SHA-256。 */
  sha256: string;
  /** bytes。 */
  size: number;
}

/** 一個版本。 */
export interface PrintAgentRelease {
  /** semver(`x.y.z`)。 */
  version: string;
  /** 發布時間(ISO 8601)。 */
  publishedAt: string;
  files: PrintAgentReleaseFile[];
}

/** `manifest.json`。 */
export interface PrintAgentManifest {
  /** 最新版本(必在 `releases` 裡)。 */
  latest: string;
  /** 保留的版本(最近 3 個),新到舊。 */
  releases: PrintAgentRelease[];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const FILE_NAME = /^[\w.-]+$/;
const SHA256 = /^[\da-f]{64}$/;

/** `x.y.z` 才算版本;回三段數字,不是則 null。 */
export function parseAgentVersion(
  version: unknown,
): [number, number, number] | null {
  if (typeof version !== "string") {
    return null;
  }
  const match = SEMVER.exec(version.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * 代理程式版本是不是舊版(印表機管理頁標「請更新」):兩個都是合法版本且 `current < latest` 才算;
 * 任何一個不認得都回 false(不亂標)。
 */
export function isAgentVersionOutdated(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  const a = parseAgentVersion(current);
  const b = parseAgentVersion(latest);
  if (a === null || b === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left < right;
    }
  }
  return false;
}

function isPlatform(value: unknown): value is PrintAgentPlatform {
  return (
    typeof value === "string" &&
    (PRINT_AGENT_PLATFORMS as readonly string[]).includes(value)
  );
}

function parseFile(value: unknown): PrintAgentReleaseFile | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { platform, name, sha256, size } = value as Record<string, unknown>;
  if (
    !isPlatform(platform) ||
    typeof name !== "string" ||
    !FILE_NAME.test(name) ||
    typeof sha256 !== "string" ||
    !SHA256.test(sha256) ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 0
  ) {
    return null;
  }
  return { platform, name, sha256, size };
}

function parseRelease(value: unknown): PrintAgentRelease | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { version, publishedAt, files } = value as Record<string, unknown>;
  if (
    parseAgentVersion(version) === null ||
    typeof publishedAt !== "string" ||
    !Array.isArray(files)
  ) {
    return null;
  }
  const parsed = files.map((file) => parseFile(file));
  if (parsed.includes(null)) {
    return null;
  }
  return {
    version: (version as string).trim(),
    publishedAt,
    files: parsed as PrintAgentReleaseFile[],
  };
}

/** 驗證並讀出 manifest;形狀不對(含 `latest` 不在 `releases` 裡)回 null。 */
export function parsePrintAgentManifest(
  value: unknown,
): PrintAgentManifest | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { latest, releases } = value as Record<string, unknown>;
  if (typeof latest !== "string" || !Array.isArray(releases)) {
    return null;
  }
  const parsed = releases.map((release) => parseRelease(release));
  if (parsed.includes(null)) {
    return null;
  }
  const list = parsed as PrintAgentRelease[];
  if (!list.some((release) => release.version === latest.trim())) {
    return null;
  }
  return { latest: latest.trim(), releases: list };
}

/** 某版本某檔案的物件路徑。 */
export function printAgentReleaseObjectPath(
  version: string,
  fileName: string,
): string {
  return `${PRINT_AGENT_RELEASE_PREFIX}/${version}/${fileName}`;
}
