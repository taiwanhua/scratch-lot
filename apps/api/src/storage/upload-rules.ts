/**
 * 上傳規則(ADR-0010):可上傳的檔型、大小上限、物件路徑的長相、用途 → bucket 可見性。
 * 純常數與純函式,不依賴 Nest / GCS — resolver 的 input model 與 StorageService 共用同一份,
 * 也讓 orgs 票驗 `logoPath` 時 import 得到 `isOwnedUploadPath`。
 */

/** 上傳用途:決定路徑前綴、bucket 可見性與所需權限。 */
export enum UploadPurpose {
  ORG_LOGO = "ORG_LOGO",
  /** 示範模組1 的封面圖:**公開** bucket,回穩定公開 URL。 */
  DEMO_COVER = "DEMO_COVER",
  /** 示範模組1 的附件:**私有** bucket,看時現簽。 */
  DEMO_ATTACHMENT = "DEMO_ATTACHMENT",
  /** 表單提交的上傳欄(`type: "upload"`):**私有** bucket,讀取走簽名網址與欄位權限。 */
  FORM_ATTACHMENT = "FORM_ATTACHMENT",
}

/**
 * 檔案放哪一顆 bucket(ADR-0010「visibility 是用途的衍生屬性,不另給參數」):
 * `private` = `GCS_BUCKET_PRIVATE`(預設,讀取現簽短效網址);
 * `public` = `GCS_BUCKET_PUBLIC`(公開讀,回穩定 URL,供 CDN / og:image)。
 */
export type UploadVisibility = "private" | "public";

export const UPLOAD_VISIBILITIES: Readonly<
  Record<UploadPurpose, UploadVisibility>
> = {
  [UploadPurpose.ORG_LOGO]: "private",
  [UploadPurpose.DEMO_COVER]: "public",
  [UploadPurpose.DEMO_ATTACHMENT]: "private",
  [UploadPurpose.FORM_ATTACHMENT]: "private",
};

/** 圖片類用途(商標、封面)的大小上限 2MB(ADR-0010)。 */
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

/** 附件類用途的大小上限 20MB(文件與壓縮檔本來就比圖片大)。 */
export const MAX_ATTACHMENT_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 上傳網址效期 10 分鐘(ADR-0010);讀取網址效期另由 `GCS_SIGNED_URL_TTL` 決定。 */
export const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;

/** 圖片檔型 → 副檔名(ADR-0010 的 PNG / JPG,加上 webp)。 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * 附件的文件檔型 → 副檔名(pdf / doc / docx / xls / xlsx / zip)。
 * `application/x-zip-compressed` 是 Windows 上的瀏覽器對 `.zip` 申報的 content type,
 * 與 `application/zip` 同一種檔,一起收(副檔名相同)。
 */
const DOCUMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
};

/** 一個用途的上傳規則:允許的檔型與大小上限(兩者都是**依用途**,不是全站一套)。 */
export interface UploadRule {
  /** 允許的 content type(小寫)→ 存檔用的副檔名。 */
  extensions: Readonly<Record<string, string>>;
  /** 大小上限(bytes)。 */
  maxBytes: number;
}

/**
 * 用途 → 上傳規則(依用途分開;在那之前全站共用一份圖片白名單 + 2MB)。
 * 圖片類(`ORG_LOGO` / `DEMO_COVER`)維持 png / jpg / webp 與 2MB;
 * `DEMO_ATTACHMENT` 是「附件」,除了圖片再收 pdf / doc / docx / xls / xlsx / zip,上限 20MB。
 */
export const UPLOAD_RULES: Readonly<Record<UploadPurpose, UploadRule>> = {
  [UploadPurpose.ORG_LOGO]: {
    extensions: IMAGE_EXTENSIONS,
    maxBytes: MAX_IMAGE_UPLOAD_BYTES,
  },
  [UploadPurpose.DEMO_COVER]: {
    extensions: IMAGE_EXTENSIONS,
    maxBytes: MAX_IMAGE_UPLOAD_BYTES,
  },
  [UploadPurpose.DEMO_ATTACHMENT]: {
    extensions: { ...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS },
    maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
  },
  // 表單的上傳欄與示範模組的附件同一套檔型與上限
  [UploadPurpose.FORM_ATTACHMENT]: {
    extensions: { ...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS },
    maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
  },
};

/**
 * 用途 → 物件路徑前綴(bucket 由 `UPLOAD_VISIBILITIES` 決定,路徑不含 bucket)。
 * 示範模組的封面與附件共用 `demo` 前綴:兩者落在不同的 bucket,
 * 把別種用途的路徑塞進另一個欄位只會指到不存在的物件(不會外洩)。
 */
export const UPLOAD_PATH_PREFIXES: Readonly<Record<UploadPurpose, string>> = {
  [UploadPurpose.ORG_LOGO]: "org-logos",
  [UploadPurpose.DEMO_COVER]: "demo",
  [UploadPurpose.DEMO_ATTACHMENT]: "demo",
  [UploadPurpose.FORM_ATTACHMENT]: "form",
};

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * 每個前綴各自的副檔名白名單(共用同一個前綴的用途取聯集,如 `demo` = 封面 + 附件)。
 * 不取全站聯集 —— 否則放寬附件的副檔名會連帶讓 `org-logos/<uuid>.zip` 通過歸屬驗證。
 */
function extensionsByPrefix(): Map<string, Set<string>> {
  const byPrefix = new Map<string, Set<string>>();
  for (const purpose of Object.values(UploadPurpose)) {
    const prefix = UPLOAD_PATH_PREFIXES[purpose];
    const extensions = byPrefix.get(prefix) ?? new Set<string>();
    for (const extension of Object.values(UPLOAD_RULES[purpose].extensions)) {
      extensions.add(extension);
    }
    byPrefix.set(prefix, extensions);
  }
  return byPrefix;
}

const OWNED_UPLOAD_PATH = new RegExp(
  [...extensionsByPrefix()]
    .map(
      ([prefix, extensions]) =>
        String.raw`^${prefix}/${UUID_PATTERN}\.(${[...extensions].join("|")})$`,
    )
    .join("|"),
);

/**
 * 這個物件路徑是不是本 API 自己簽出來的(前綴 + uuid + 該前綴允許的副檔名)。
 * 用途:寫入 `orgs.logoPath`、`demo_items_one.coverPath` / `attachmentPath` 這類
 * 「由前端回傳路徑」的欄位前先驗,不讓呼叫端把任意 bucket 物件塞進 DB
 * (updateOrg / provisionTenant、示範模組1)。
 */
export function isOwnedUploadPath(path: string): boolean {
  return OWNED_UPLOAD_PATH.test(path);
}
