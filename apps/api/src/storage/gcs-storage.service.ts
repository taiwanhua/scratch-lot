import { Storage, type StorageOptions } from "@google-cloud/storage";

import type { StorageConfig } from "./storage.config";
import { type SignUploadRequest, StorageService } from "./storage.service";

/** 簽名網址的參數(只取 `@google-cloud/storage` 用到的那幾個欄位)。 */
export interface GcsSignedUrlOptions {
  version: "v4";
  action: "read" | "write";
  expires: Date;
  contentType?: string;
}

/** 刪除物件的參數(只取 `@google-cloud/storage` 用到的那一個欄位)。 */
export interface GcsDeleteOptions {
  /** 物件已經不在時不算錯(重複刪、手動清過都當成功)。 */
  ignoreNotFound?: boolean;
}

/** 只取 SDK 用到的那一角,單元測試以假 bucket 取代(不打真網路)。 */
export interface GcsBucket {
  file(name: string): {
    getSignedUrl(options: GcsSignedUrlOptions): Promise<[string]>;
    delete(options?: GcsDeleteOptions): Promise<unknown>;
    /** 複製到同一顆 bucket 的另一個物件名稱。 */
    copy(destination: string): Promise<unknown>;
    /** 讀整個物件(發布檔,如代理程式的 `manifest.json`);不存在時 SDK 拋 code 404。 */
    download(): Promise<[Buffer]>;
  };
}

/** 公開 bucket 的穩定讀取網址前綴(ADR-0010:公開檔案不簽名、直接放 `<img src>`)。 */
const PUBLIC_URL_BASE = "https://storage.googleapis.com";

/**
 * `new Storage()` 的參數。**雲端環境一律回 `undefined`**(= 原本的 `new Storage()`,走 ADC);
 * 只有設了 `GCS_API_ENDPOINT`(劇本 E2E 的 fake GCS)才帶端點與測試用假憑證 ——
 * 本機 / CI 沒有 ADC,V4 簽名要一把私鑰才算得出來;fake GCS 不驗簽章。
 * 有自訂端點時 SDK 的 JSON API 呼叫(刪物件)本來就不帶 OAuth token,不會去打 Google 換票。
 */
export function gcsClientOptions(
  config: StorageConfig,
): StorageOptions | undefined {
  const override = config.endpointOverride;
  if (override === undefined) {
    return undefined;
  }
  return {
    apiEndpoint: override.apiEndpoint,
    credentials: {
      client_email: override.clientEmail,
      private_key: override.privateKey,
    },
  };
}

/** 依設定建 SDK client:沒有端點覆寫時就是 `new Storage()`,一個參數都不給。 */
export function createGcsClient(config: StorageConfig): Storage {
  const options = gcsClientOptions(config);
  return options === undefined ? new Storage() : new Storage(options);
}

/**
 * GCS adapter(ADR-0010):V4 簽名的上傳 / 讀取網址。
 *
 * **兩顆 bucket**:`GCS_BUCKET_PRIVATE` 放私有檔案(商標、示範附件,讀取現簽短效網址),
 * `GCS_BUCKET_PUBLIC` 放公開檔案(示範封面,回穩定 URL)。要落在哪一顆由 `purpose` 衍生
 * (`UPLOAD_VISIBILITIES`),呼叫端不選 bucket。公開 bucket 未設定時退回私有 bucket 並記一筆警告 —
 * 缺設定不讓 api 啟動失敗(與 StorageModule 選 adapter 同一原則)。
 *
 * **簽名不用金鑰檔**:`new Storage()` 走 ADC —— 在 Cloud Run 上即執行身分的中繼資料 token,
 * SDK 沒有私鑰可簽時自動改呼叫 IAM Credentials 的 `signBlob`(所以該 SA 要對自己持
 * `roles/iam.serviceAccountTokenCreator`、專案要開 `iamcredentials.googleapis.com`;
 * 建立步驟見 docs/deployment.md)。本機沒有憑證,連 adapter 都不會被選中(改用記錄用 adapter)。
 * 例外是劇本 E2E:設了 `GCS_API_ENDPOINT` 就指向 fake GCS、以假憑證簽名(`gcsClientOptions`)。
 */
export class GcsStorageService extends StorageService {
  private readonly bucket: GcsBucket;
  private readonly publicBucket: GcsBucket;

  constructor(
    config: StorageConfig,
    bucket?: GcsBucket,
    publicBucket?: GcsBucket,
  ) {
    super(config);
    this.bucket =
      bucket ?? createGcsClient(config).bucket(requireBucket(config));
    this.publicBucket =
      publicBucket ??
      (config.publicBucket === undefined
        ? this.bucket
        : createGcsClient(config).bucket(config.publicBucket));
    if (config.publicBucket === undefined && publicBucket === undefined) {
      this.logger.warn(
        "GCS_BUCKET_PUBLIC 未設定,公開檔案改放私有 bucket:穩定 URL 會取不到物件",
      );
    }
  }

  protected override async signUploadUrl({
    objectPath,
    contentType,
    expiresAt,
    visibility,
  }: SignUploadRequest): Promise<string> {
    const target = visibility === "public" ? this.publicBucket : this.bucket;
    const [url] = await target.file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresAt,
      // 綁死 content type:拿到網址也只能上傳這個型別的檔案
      contentType,
    });
    return url;
  }

  protected override async signReadUrl(
    objectPath: string,
    expiresAt: Date,
  ): Promise<string> {
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt,
    });
    return url;
  }

  protected override publicUrl(objectPath: string): string {
    const bucketName = this.config.publicBucket ?? this.config.privateBucket;
    // 端點覆寫時(fake GCS)公開檔案也從同一個端點讀,與簽名網址同一個主機
    const base = this.config.endpointOverride?.apiEndpoint ?? PUBLIC_URL_BASE;
    return `${base}/${bucketName ?? ""}/${objectPath}`;
  }

  /** 刪除只對**私有** bucket(換商標後的清理);公開檔案目前沒有清理需求。 */
  protected override async removeObject(objectPath: string): Promise<void> {
    // ignoreNotFound:換圖的舊物件可能早就被清掉(重試、手動刪),不算失敗
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }

  protected override async downloadObject(
    objectPath: string,
  ): Promise<Buffer | null> {
    try {
      const [content] = await this.bucket.file(objectPath).download();
      return content;
    } catch (error) {
      if ((error as { code?: unknown }).code === 404) {
        return null;
      }
      throw error;
    }
  }

  protected override async duplicateObject(
    from: string,
    to: string,
  ): Promise<void> {
    await this.bucket.file(from).copy(to);
  }
}

function requireBucket(config: StorageConfig): string {
  if (config.privateBucket === undefined) {
    throw new Error("GCS_BUCKET_PRIVATE 未設定,無法建立 GcsStorageService");
  }
  return config.privateBucket;
}
