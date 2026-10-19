import { ConfigService } from "@nestjs/config";

import { parseDurationMs } from "../auth/duration";

/** 注入 token(檔案儲存的設定值,自環境變數讀取;登記:docs/env-registry.md)。 */
export const STORAGE_CONFIG = Symbol("STORAGE_CONFIG");

export interface StorageConfig {
  /**
   * 私有 bucket 名稱(`GCS_BUCKET_PRIVATE`,如 `<專案>-assets-dev`;ADR-0010)。
   * 未設 → 自動改用記錄用 adapter(簽名網址是假的、檔案不會真的上傳),api 不因缺設定而啟動失敗。
   */
  privateBucket: string | undefined;
  /**
   * 公開 bucket 名稱(`GCS_BUCKET_PUBLIC`,如 `<專案>-public-dev`;ADR-0010)。
   * 第 3 段沒有公開檔案,先登記、先讀進來;第 5 段示範模組的封面才會用到。
   */
  publicBucket: string | undefined;
  /** 簽名**讀取**網址效期(`GCS_SIGNED_URL_TTL`,預設 1h;ADR-0010 商標類)。 */
  signedUrlTtlMs: number;
  /**
   * **只在測試用**的端點覆寫(`GCS_API_ENDPOINT`):劇本 E2E 把 api 指到 fake GCS 容器。
   * 未設(所有雲端環境)= 沒有這個欄位,GCS adapter 照原本 `new Storage()` 走 ADC。
   */
  endpointOverride?: GcsEndpointOverride;
}

/**
 * 測試用的 GCS 端點 + 假憑證。本機 / CI 沒有 ADC,V4 簽名要一把私鑰才算得出來;
 * fake GCS 不驗簽章,所以這把金鑰**沒有任何真實權限**,只為了讓簽名網址長得跟正式環境一樣。
 */
export interface GcsEndpointOverride {
  /** `GCS_API_ENDPOINT`,如 `http://127.0.0.1:4443`(去掉結尾的 `/`)。 */
  apiEndpoint: string;
  /** `GCS_FAKE_CLIENT_EMAIL`:簽名網址 `X-Goog-Credential` 上的帳號名,隨便一個 email 形狀即可。 */
  clientEmail: string;
  /** `GCS_FAKE_PRIVATE_KEY`:PEM;放在 `.env` 單行時以字面的反斜線 n 換行,讀進來還原。 */
  privateKey: string;
}

/** ADR-0010:商標類的讀取網址 TTL 1 小時(前端可快取)。 */
export const DEFAULT_SIGNED_URL_TTL = "1h";

/** 每個變數都有內建預設值,不設也能跑。 */
export function loadStorageConfig(config: ConfigService): StorageConfig {
  const endpointOverride = loadEndpointOverride(config);
  return {
    privateBucket: nonEmpty(config.get<string>("GCS_BUCKET_PRIVATE")),
    publicBucket: nonEmpty(config.get<string>("GCS_BUCKET_PUBLIC")),
    signedUrlTtlMs: parseDurationMs(
      config.get<string>("GCS_SIGNED_URL_TTL") ?? DEFAULT_SIGNED_URL_TTL,
      "GCS_SIGNED_URL_TTL",
    ),
    ...(endpointOverride === undefined ? {} : { endpointOverride }),
  };
}

/**
 * `GCS_API_ENDPOINT` 有設才讀假憑證;有端點沒憑證就在啟動時拋錯 ——
 * 否則 SDK 會退回 ADC,在沒有 GCP 身分的機器上要到第一次簽名才失敗,錯誤訊息也看不出原因。
 */
function loadEndpointOverride(
  config: ConfigService,
): GcsEndpointOverride | undefined {
  const apiEndpoint = nonEmpty(config.get<string>("GCS_API_ENDPOINT"));
  if (apiEndpoint === undefined) {
    return undefined;
  }
  const clientEmail = nonEmpty(config.get<string>("GCS_FAKE_CLIENT_EMAIL"));
  const privateKey = nonEmpty(config.get<string>("GCS_FAKE_PRIVATE_KEY"));
  if (clientEmail === undefined || privateKey === undefined) {
    throw new Error(
      "GCS_API_ENDPOINT 有設時,GCS_FAKE_CLIENT_EMAIL 與 GCS_FAKE_PRIVATE_KEY 都要設(測試用假憑證,見 docs/env-registry.md)",
    );
  }
  return {
    apiEndpoint: withoutTrailingSlash(apiEndpoint.trim()),
    clientEmail: clientEmail.trim(),
    privateKey: privateKey.replaceAll(String.raw`\n`, "\n"),
  };
}

/** `http://host:4443/` → `http://host:4443`(簽名網址與公開 URL 都是「端點 + `/<bucket>/<物件>`」)。 */
function withoutTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

/** 空字串視同未設定(YAML 留空鍵時常見)。 */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

export const storageConfigProvider = {
  provide: STORAGE_CONFIG,
  inject: [ConfigService],
  useFactory: loadStorageConfig,
};
