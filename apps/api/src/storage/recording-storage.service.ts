import { type SignUploadRequest, StorageService } from "./storage.service";
import type { UploadVisibility } from "./upload-rules";

export interface RecordedSignature {
  action: "read" | "write";
  objectPath: string;
  contentType?: string;
  expiresAt: Date;
  url: string;
  /** 只有上傳票有:這張票要把檔案放進哪一顆 bucket(ADR-0010)。 */
  visibility?: UploadVisibility;
}

/**
 * 記錄用 adapter(ADR-0010 沒有憑證時的替身):不打 GCS,回一個**一眼看得出是假的**網址
 * (`https://recording.storage.invalid/...`,`.invalid` 是保證不存在的 TLD),
 * 並把每次簽名記在 `signed` 供測試斷言。
 * 本地開發沒有 `GCS_BUCKET_PRIVATE`(也沒有 GCP 憑證)時也用它:上傳一定會失敗,但整條流程跑得到底。
 */
export class RecordingStorageService extends StorageService {
  readonly signed: RecordedSignature[] = [];
  /** 被刪掉的物件路徑(換圖清理;沒有真的 bucket,只記下來供測試斷言)。 */
  readonly deleted: string[] = [];
  /** 被複製的物件(`複製為新單` 的附件;只記下來供測試斷言)。 */
  readonly copied: { from: string; to: string }[] = [];
  /**
   * 「bucket 上已經有」的物件(發布檔,如代理程式的 `manifest.json`):沒有真的 bucket,
   * 測試以 `putObject` 放進來,`readReleaseObject` 從這裡讀。
   */
  private readonly objects = new Map<string, Buffer>();

  /** 測試用:放一個物件到假的 bucket(`null` = 拿掉)。 */
  putObject(objectPath: string, content: Buffer | string | null): void {
    if (content === null) {
      this.objects.delete(objectPath);
      return;
    }
    this.objects.set(
      objectPath,
      typeof content === "string" ? Buffer.from(content, "utf8") : content,
    );
  }

  protected override signUploadUrl({
    objectPath,
    contentType,
    expiresAt,
    visibility,
  }: SignUploadRequest): Promise<string> {
    return Promise.resolve(
      this.record({
        action: "write",
        objectPath,
        contentType,
        expiresAt,
        visibility,
      }),
    );
  }

  protected override signReadUrl(
    objectPath: string,
    expiresAt: Date,
  ): Promise<string> {
    return Promise.resolve(
      this.record({ action: "read", objectPath, expiresAt }),
    );
  }

  /** 公開檔案的穩定網址;一樣一眼看得出是假的,但形狀與 GCS adapter 相同(不帶簽名參數)。 */
  protected override publicUrl(objectPath: string): string {
    return `https://recording.storage.invalid/public/${objectPath}`;
  }

  protected override removeObject(objectPath: string): Promise<void> {
    this.deleted.push(objectPath);
    this.logger.log(`[記錄用 adapter,未真的刪除] delete ${objectPath}`);
    return Promise.resolve();
  }

  protected override downloadObject(
    objectPath: string,
  ): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(objectPath) ?? null);
  }

  protected override duplicateObject(from: string, to: string): Promise<void> {
    this.copied.push({ from, to });
    this.logger.log(`[記錄用 adapter,未真的複製] copy ${from} → ${to}`);
    return Promise.resolve();
  }

  private record(signature: Omit<RecordedSignature, "url">): string {
    const url = `https://recording.storage.invalid/${signature.objectPath}?action=${signature.action}&expires=${signature.expiresAt.toISOString()}`;
    this.signed.push({ ...signature, url });
    this.logger.log(
      `[記錄用 adapter,未真的簽名] ${signature.action} ${signature.objectPath}(至 ${signature.expiresAt.toISOString()})`,
    );
    return url;
  }
}
