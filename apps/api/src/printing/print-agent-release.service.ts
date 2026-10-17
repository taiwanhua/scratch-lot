import { Injectable, Logger } from "@nestjs/common";

import {
  PRINT_AGENT_DOWNLOAD_URL_TTL_MS,
  PRINT_AGENT_MANIFEST_PATH,
  type PrintAgentManifest,
  type PrintAgentPlatform,
  type PrintAgentRelease,
  isAgentVersionOutdated,
  parsePrintAgentManifest,
  printAgentReleaseObjectPath,
} from "@repo/domain/printing";

import { StorageService } from "../storage/storage.service";
import { notFoundError } from "./printing-error";

/** 讀到的 manifest 在記憶體留多久(代理程式清單每次都要比版本,不必每次打 GCS)。 */
export const MANIFEST_CACHE_MS = 60 * 1000;

/** 某平台安裝檔的下載網址。 */
export interface PrintAgentDownload {
  url: string;
  version: string;
  file: PrintAgentRelease["files"][number];
  expiresAt: Date;
}

/**
 * 代理程式安裝檔(底座規格第 6 章「下載與安裝」):讀私有 bucket 的 `print-agent/manifest.json`
 * (發布 workflow 寫的),用既有檔案服務簽 1 小時的下載網址。權限(`system.printers.create`)由 resolver 守。
 *
 * manifest 讀不到(還沒發布、格式壞掉、GCS 失敗)時回 null,不讓代理程式清單整頁失敗;
 * 只有「按下載」時才報 `NOT_FOUND`。
 */
@Injectable()
export class PrintAgentReleaseService {
  private readonly logger = new Logger(PrintAgentReleaseService.name);
  private cached: { at: number; manifest: PrintAgentManifest | null } | null =
    null;

  constructor(private readonly storage: StorageService) {}

  /** 目前的 manifest(快取 `MANIFEST_CACHE_MS`);讀不到回 null。 */
  async manifest(now = Date.now()): Promise<PrintAgentManifest | null> {
    if (this.cached !== null && now - this.cached.at < MANIFEST_CACHE_MS) {
      return this.cached.manifest;
    }
    const manifest = await this.load();
    this.cached = { at: now, manifest };
    return manifest;
  }

  /** 下次讀取時重讀 manifest(剛發布完、測試換 manifest 時用)。 */
  invalidate(): void {
    this.cached = null;
  }

  /** 「請更新」的判斷函式(以目前的最新版本比對)。 */
  async outdatedChecker(): Promise<(version: string | null) => boolean> {
    const manifest = await this.manifest();
    const latest = manifest?.latest ?? null;
    return (version) => isAgentVersionOutdated(version, latest);
  }

  /** 最新版本與它的檔案;還沒發布過回 null。 */
  async latest(): Promise<PrintAgentRelease | null> {
    const manifest = await this.manifest();
    return (
      manifest?.releases.find(
        (release) => release.version === manifest.latest,
      ) ?? null
    );
  }

  /** 最新版本某平台的下載網址(1 小時)。 */
  async downloadUrl(platform: PrintAgentPlatform): Promise<PrintAgentDownload> {
    // 按下載是低頻操作:直接重讀,不吃快取(剛發布完就能下載到新版)
    this.invalidate();
    const release = await this.latest();
    const file = release?.files.find((entry) => entry.platform === platform);
    if (release === null || file === undefined) {
      throw notFoundError(`No print agent release for ${platform}`);
    }
    const url = await this.storage.releaseDownloadUrlOf(
      printAgentReleaseObjectPath(release.version, file.name),
      PRINT_AGENT_DOWNLOAD_URL_TTL_MS,
    );
    if (url === null) {
      throw notFoundError(`Invalid print agent file name: ${file.name}`);
    }
    return {
      url,
      version: release.version,
      file,
      expiresAt: new Date(Date.now() + PRINT_AGENT_DOWNLOAD_URL_TTL_MS),
    };
  }

  private async load(): Promise<PrintAgentManifest | null> {
    try {
      const content = await this.storage.readReleaseObject(
        PRINT_AGENT_MANIFEST_PATH,
      );
      if (content === null) {
        return null;
      }
      const manifest = parsePrintAgentManifest(
        JSON.parse(content.toString("utf8")) as unknown,
      );
      if (manifest === null) {
        this.logger.warn(`${PRINT_AGENT_MANIFEST_PATH} 格式不對,當作沒有發布`);
      }
      return manifest;
    } catch (error) {
      this.logger.warn(
        `讀不到 ${PRINT_AGENT_MANIFEST_PATH}:${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
