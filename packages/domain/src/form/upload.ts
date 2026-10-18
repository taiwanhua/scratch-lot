import type { FieldDef } from "./types";
import type { ValueIssue } from "./values";

/**
 * 上傳欄的檔型 / 大小上限(設定放在 `rules.accept` / `rules.maxSizeMb`)。
 *
 * 平台上限是 api `storage/upload-rules.ts` 的 `FORM_ATTACHMENT`(api 有測試釘住兩邊一致);
 * 欄位只能**收窄**:檔型必須是平台允許的子集、大小不能超過平台上限。
 */

/** 平台允許的表單附件檔型(= api `UPLOAD_RULES.FORM_ATTACHMENT` 的 content type)。 */
export const FORM_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
] as const;

/** 平台的單檔上限(MB;= api `MAX_ATTACHMENT_UPLOAD_BYTES`)。 */
export const FORM_UPLOAD_MAX_SIZE_MB = 20;

const BYTES_PER_MB = 1024 * 1024;

export interface UploadLimits {
  /** 允許的檔型(小寫 MIME)。 */
  accept: readonly string[];
  /** 單檔上限(bytes)。 */
  maxBytes: number;
}

/** 欄位設定的 `accept`(去掉不在平台清單的、轉小寫);沒設或設了空陣列 = 平台全部。 */
function acceptOf(field: FieldDef): readonly string[] {
  const raw = field.rules?.accept;
  if (!Array.isArray(raw) || raw.length === 0) {
    return FORM_UPLOAD_CONTENT_TYPES;
  }
  const allowed = new Set<string>(FORM_UPLOAD_CONTENT_TYPES);
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase())
    .filter((item) => allowed.has(item));
}

/** 欄位實際生效的上限(欄位設定與平台上限取嚴者)。 */
export function uploadLimitsOf(field: FieldDef): UploadLimits {
  const maxSizeMb = field.rules?.maxSizeMb;
  const mb =
    typeof maxSizeMb === "number" && Number.isFinite(maxSizeMb) && maxSizeMb > 0
      ? Math.min(maxSizeMb, FORM_UPLOAD_MAX_SIZE_MB)
      : FORM_UPLOAD_MAX_SIZE_MB;
  return { accept: acceptOf(field), maxBytes: Math.floor(mb * BYTES_PER_MB) };
}

/**
 * 上傳值是否符合欄位的檔型 / 大小上限;不符回 `UPLOAD_INVALID`(前端選檔時與 api 寫入時同一條)。
 * 形狀不對的值由 `normalizeFieldValue` 處理,這裡不管。
 */
export function uploadLimitIssue(
  field: FieldDef,
  value: { contentType?: unknown; size?: unknown } | null | undefined,
): ValueIssue | null {
  if (field.type !== "upload" || !value) {
    return null;
  }
  const limits = uploadLimitsOf(field);
  const contentType =
    typeof value.contentType === "string"
      ? value.contentType.toLowerCase()
      : "";
  if (!limits.accept.includes(contentType)) {
    return {
      fieldKey: field.key,
      code: "UPLOAD_INVALID",
      message: `「${field.label}」不接受這種檔案類型`,
    };
  }
  if (typeof value.size === "number" && value.size > limits.maxBytes) {
    return {
      fieldKey: field.key,
      code: "UPLOAD_INVALID",
      message: `「${field.label}」的檔案超過 ${String(limits.maxBytes / BYTES_PER_MB)} MB`,
    };
  }
  return null;
}
