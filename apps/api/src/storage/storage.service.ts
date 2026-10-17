import { randomUUID } from "node:crypto";

import { Logger } from "@nestjs/common";

import { assertOutsideTransaction } from "../database/transaction";
import { storageError } from "./storage-error";
import type { StorageConfig } from "./storage.config";
import {
  UPLOAD_PATH_PREFIXES,
  UPLOAD_RULES,
  UPLOAD_URL_TTL_MS,
  UPLOAD_VISIBILITIES,
  type UploadPurpose,
  type UploadVisibility,
  isOwnedUploadPath,
} from "./upload-rules";

/**
 * **發布檔**的路徑前綴:由 CI 發布 workflow 直接寫進私有 bucket(不是使用者上傳的),
 * API 只讀、只簽下載網址。目前只有列印代理程式的安裝檔(`@repo/domain/printing` 的
 * `PRINT_AGENT_RELEASE_PREFIX`;docs/modules/printers.md「下載」)。
 */
export const RELEASE_OBJECT_PREFIXES: readonly string[] = ["print-agent/"];

const RELEASE_OBJECT_PATH = /^[\w-]+(?:\/[\w.-]+)+$/;

/** 是不是發布檔的路徑(前綴在清單上、每一段只有英數 / 底線 / 連字號 / 點,不含 `..`)。 */
export function isReleaseObjectPath(path: string): boolean {
  return (
    RELEASE_OBJECT_PATH.test(path) &&
    !path.split("/").some((segment) => segment === ".." || segment === ".") &&
    RELEASE_OBJECT_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/** `createUploadUrl` 的輸入(GraphQL 形狀見 models/upload-url.model.ts)。 */
export interface CreateUploadInput {
  purpose: UploadPurpose;
  contentType: string;
  /** 檔案大小(bytes),由前端申報 — 真正的上限由簽名網址的 content-type 與 bucket 端把關。 */
  size: number;
}

/** 一張上傳票:瀏覽器拿 `uploadUrl` 直接 PUT 上去,成功後把 `objectPath` 交回 API 存進資料欄位。 */
export interface UploadTicket {
  uploadUrl: string;
  objectPath: string;
  expiresAt: Date;
}

export interface SignUploadRequest {
  objectPath: string;
  contentType: string;
  expiresAt: Date;
  /** 檔案要落在哪一顆 bucket(由 `purpose` 衍生,ADR-0010)。 */
  visibility: UploadVisibility;
}

/**
 * 檔案儲存介面(ADR-0010):呼叫端只認 `createUploadUrl`(要一張上傳票)與 `readUrlOf`(把存起來的
 * 物件路徑換成短效讀取網址);檔案不經過 API server,DB 存路徑不存 URL。
 * 驗證(檔型 / 大小)、路徑長相、TTL 都在這層決定,供應商只是 `signUploadUrl` / `signReadUrl` 的
 * adapter(GCS 是第一個;本地與測試用記錄用 adapter)。
 * 亦為 Nest 的注入 token(StorageModule 依 GCS_BUCKET_PRIVATE 有無決定實作)。
 */
export abstract class StorageService {
  /** 以實際 adapter 的類別名為 log 前綴(GcsStorageService / RecordingStorageService)。 */
  protected readonly logger: Logger;

  constructor(protected readonly config: StorageConfig) {
    this.logger = new Logger(new.target.name);
  }

  /**
   * 簽一張上傳票:先依 `purpose` 的規則(`UPLOAD_RULES`:允許的檔型與大小上限,#344 起兩者都依用途)
   * 驗檔型與大小(不合即 `UPLOAD_REJECTED`),再產 `<前綴>/<uuid>.<副檔名>`。
   * 路徑帶 uuid 而非組織 id — 簽票時資料可能還不存在(開通租戶的商標在租戶建立之前就上傳),
   * 歸屬改由 `isOwnedUploadPath` + 寫入端的權限把關。
   */
  async createUploadUrl(input: CreateUploadInput): Promise<UploadTicket> {
    const rule = UPLOAD_RULES[input.purpose];
    const contentType = input.contentType.trim().toLowerCase();
    const extension = rule.extensions[contentType];
    if (extension === undefined) {
      throw storageError(
        "UPLOAD_REJECTED",
        `Unsupported content type for ${input.purpose}: ${input.contentType}`,
      );
    }
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw storageError(
        "UPLOAD_REJECTED",
        `Invalid file size: ${String(input.size)}`,
      );
    }
    if (input.size > rule.maxBytes) {
      throw storageError(
        "UPLOAD_REJECTED",
        `File too large for ${input.purpose}: ${String(input.size)} bytes (max ${String(rule.maxBytes)})`,
      );
    }
    const objectPath = `${UPLOAD_PATH_PREFIXES[input.purpose]}/${randomUUID()}.${extension}`;
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);
    const uploadUrl = await this.signUploadUrl({
      objectPath,
      contentType,
      expiresAt,
      visibility: UPLOAD_VISIBILITIES[input.purpose],
    });
    return { uploadUrl, objectPath, expiresAt };
  }

  /**
   * 把存在資料欄位裡的物件路徑換成短效讀取網址(TTL `GCS_SIGNED_URL_TTL`);
   * 沒有路徑、或路徑不是本 API 簽出來的(舊資料 / 被塞進來的值)一律回 null,不外洩任意物件。
   * **呼叫端負責先驗「這個人看得到這筆資料嗎」**(ADR-0010:私有檔案的可取範圍 = 該筆資料的可查範圍)。
   */
  async readUrlOf(
    objectPath: string | null | undefined,
  ): Promise<string | null> {
    const path = nonEmptyPath(objectPath);
    if (path === undefined) {
      return null;
    }
    if (!isOwnedUploadPath(path)) {
      this.logger.warn(`物件路徑 ${path} 不是本 API 簽出來的,不簽讀取網址`);
      return null;
    }
    return this.signReadUrl(
      path,
      new Date(Date.now() + this.config.signedUrlTtlMs),
    );
  }

  /**
   * 公開檔案的**穩定** URL(ADR-0010「公開:穩定公開 URL,供 CDN 快取、SEO、og:image」):
   * 不簽名、不過期,所以可以直接放進 `<img src>`。與 `readUrlOf` 同樣先驗路徑是不是本 API
   * 簽出來的;**呼叫端仍要先驗「這個人看得到這筆資料嗎」** —— 公開 bucket 的物件本來就人人可讀,
   * 所以只有「公開用途」(`UPLOAD_VISIBILITIES` 為 `public`)的欄位才該走這裡。
   */
  publicUrlOf(objectPath: string | null | undefined): string | null {
    const path = nonEmptyPath(objectPath);
    if (path === undefined) {
      return null;
    }
    if (!isOwnedUploadPath(path)) {
      this.logger.warn(`物件路徑 ${path} 不是本 API 簽出來的,不回公開網址`);
      return null;
    }
    return this.publicUrl(path);
  }

  /**
   * 刪掉一個存在資料欄位裡的物件(#161:換商標後清掉舊物件)。
   * 與 `readUrlOf` 同一道把關:沒有路徑、或路徑不是本 API 簽出來的一律**不刪**並回 false,
   * 不讓呼叫端刪到任意 bucket 物件;真的交給 adapter 刪才回 true。
   * **供應商端的失敗原樣往外拋** — 要不要因此擋住主流程由呼叫端決定
   * (`updateOrg` 只記 warn:清不掉只是留一個孤兒物件,不該讓使用者的編輯失敗)。
   */
  async deleteObject(objectPath: string | null | undefined): Promise<boolean> {
    assertOutsideTransaction("刪除 GCS 物件");
    const path = nonEmptyPath(objectPath);
    if (path === undefined) {
      return false;
    }
    if (!isOwnedUploadPath(path)) {
      this.logger.warn(`物件路徑 ${path} 不是本 API 簽出來的,不刪`);
      return false;
    }
    await this.removeObject(path);
    return true;
  }

  /**
   * 複製一個**私有**物件時的新路徑(`<前綴>/<新 uuid>.<副檔名>`),只算路徑、不碰 bucket。
   * 路徑不是本 API 簽出來的回 null(與 `readUrlOf` 同一道把關)。
   * 用途:交易內先把新路徑寫進資料,交易成功後再以 `copyPrivateObject(from, to)` 真的複製(TX-03)。
   */
  privateCopyPathOf(objectPath: string | null | undefined): string | null {
    const path = nonEmptyPath(objectPath);
    if (path === undefined || !isOwnedUploadPath(path)) {
      return null;
    }
    const slash = path.indexOf("/");
    const dot = path.lastIndexOf(".");
    const prefix = path.slice(0, slash);
    const extension = dot > slash ? path.slice(dot + 1) : "";
    return `${prefix}/${randomUUID()}.${extension}`;
  }

  /**
   * 複製一個**私有**物件到同前綴的新路徑,回新路徑(Spec 6b §6「複製為新單」:附件複製一份歸新單)。
   * `to` 給了就複製到那裡(須是 `privateCopyPathOf` 算出來的同前綴路徑),沒給就現算一個。
   * 與 `readUrlOf` 同一道把關:路徑不是本 API 簽出來的一律不複製、回 null。
   * **呼叫端負責先驗「這個人看得到這筆資料嗎」**。供應商端的失敗原樣往外拋。
   */
  async copyPrivateObject(
    objectPath: string | null | undefined,
    to?: string,
  ): Promise<string | null> {
    assertOutsideTransaction("複製 GCS 物件");
    const path = nonEmptyPath(objectPath);
    if (path === undefined || !isOwnedUploadPath(path)) {
      return null;
    }
    const copied = to ?? this.privateCopyPathOf(path);
    if (
      copied === null ||
      !isOwnedUploadPath(copied) ||
      copied.slice(0, copied.indexOf("/")) !== path.slice(0, path.indexOf("/"))
    ) {
      return null;
    }
    await this.duplicateObject(path, copied);
    return copied;
  }

  /**
   * 讀一個**發布檔**的內容(如 `print-agent/manifest.json`);物件不存在回 null。
   * 路徑不是發布檔前綴一律拒絕(回 null 並記 warn),不讓呼叫端讀到任意物件。只讀、無副作用。
   */
  async readReleaseObject(objectPath: string): Promise<Buffer | null> {
    if (!isReleaseObjectPath(objectPath)) {
      this.logger.warn(`物件路徑 ${objectPath} 不是發布檔,不讀`);
      return null;
    }
    return this.downloadObject(objectPath);
  }

  /**
   * 簽一個**發布檔**的下載網址(效期由呼叫端給:代理程式安裝檔是 1 小時)。
   * 與 `readReleaseObject` 同一道把關;**呼叫端負責先驗權限**。
   */
  async releaseDownloadUrlOf(
    objectPath: string,
    ttlMs: number,
  ): Promise<string | null> {
    if (!isReleaseObjectPath(objectPath)) {
      this.logger.warn(`物件路徑 ${objectPath} 不是發布檔,不簽下載網址`);
      return null;
    }
    return this.signReadUrl(objectPath, new Date(Date.now() + ttlMs));
  }

  /** 簽一個只能以該 content type PUT 一次的上傳網址。 */
  protected abstract signUploadUrl(request: SignUploadRequest): Promise<string>;

  /** 簽一個短效讀取網址。 */
  protected abstract signReadUrl(
    objectPath: string,
    expiresAt: Date,
  ): Promise<string>;

  /** 公開 bucket 上該物件的穩定 URL(不簽名)。 */
  protected abstract publicUrl(objectPath: string): string;

  /** 在私有 bucket 內把物件複製到新路徑(來源已由 `copyPrivateObject` 驗過歸屬)。 */
  protected abstract duplicateObject(from: string, to: string): Promise<void>;

  /** 把物件從 bucket 刪掉(路徑已由 `deleteObject` 驗過歸屬)。 */
  protected abstract removeObject(objectPath: string): Promise<void>;

  /** 讀私有 bucket 上一個物件的內容;不存在回 null(路徑已由呼叫端驗過)。 */
  protected abstract downloadObject(objectPath: string): Promise<Buffer | null>;
}

/** 空字串 / 未設定視同沒有檔案(去空白後判斷)。 */
function nonEmptyPath(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/** 供寫入端(#134 的 `updateOrg` / `provisionTenant`)驗 `logoPath` 歸屬。 */
export { isOwnedUploadPath } from "./upload-rules";
