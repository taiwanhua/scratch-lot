/**
 * 表單 key、欄位 key、租戶短碼、欄位類別 key 的格式。
 *
 * **本檔不 import 任何外部套件**:admin 的租戶開通表單只要 `isValidOrgSlug`,
 * 不該因此把 JSONLogic / decimal / ReDoS 檢查器一起打包進來。
 *
 * 為什麼表單 key 與欄位 key 不准 `-` 和 `.`:欄位級權限的動作段是 `show-<formKey>-<fieldKey>`,
 * 禁掉之後 `-` 只會是分隔字元,權限 key 一定能唯一拆回 formKey 與 fieldKey。
 */

/** 表單 key:小寫開頭,只允許小寫、數字、底線,最長 40。 */
export const FORM_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** 欄位 key:格式同表單 key,另有保留字(`RESERVED_FIELD_KEYS`)。 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** 租戶短碼(`orgs.slug`):小寫開頭,2–20 字。客製表單 key 的預設後綴。 */
export const ORG_SLUG_PATTERN = /^[a-z][a-z0-9_]{1,19}$/;

/**
 * 欄位類別 key(`field_categories.key`,如 `gender`、`demo-category`):與種子 key 同一套 kebab-case
 * (小寫英數、以單一 `-` 分隔、不含 `.`),最長 40。表單定義以它引用類別(`options.kind = "fieldCategory"`),
 * 種子選項的 key 是 `<類別 key>.<value>`,所以類別 key 不准有 `.`。建立後不可改。
 */
export const FIELD_CATEGORY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FIELD_CATEGORY_KEY_MAX_LENGTH = 40;

/**
 * 欄位 key 保留字:表達式上下文(`ctx`、明細列內公式的 `row`)與提交的系統欄位,當欄位 key 會與它們混淆。
 * 大小寫照原樣比對(駝峰的幾個本來就過不了格式檢查,列出來是讓錯誤訊息講得出「保留字」)。
 */
export const RESERVED_FIELD_KEYS = [
  "ctx",
  "row",
  "id",
  "status",
  "summary",
  "revision",
  "createdBy",
  "orgId",
  "tenantId",
  "moduleKey",
  "formKey",
  "version",
] as const;

/** 欄位 key 檢查結果:`format` = 格式不符、`reserved` = 保留字。 */
export type FieldKeyCheck =
  { valid: true } | { valid: false; reason: "format" | "reserved" };

export function isValidFormKey(key: string): boolean {
  return FORM_KEY_PATTERN.test(key);
}

/** 保留字優先判:`createdBy` 同時不合格式,但使用者該看到的是「保留字」。 */
export function checkFieldKey(key: string): FieldKeyCheck {
  if ((RESERVED_FIELD_KEYS as readonly string[]).includes(key)) {
    return { valid: false, reason: "reserved" };
  }
  if (!FIELD_KEY_PATTERN.test(key)) {
    return { valid: false, reason: "format" };
  }
  return { valid: true };
}

export function isValidFieldCategoryKey(key: string): boolean {
  return (
    key.length <= FIELD_CATEGORY_KEY_MAX_LENGTH &&
    FIELD_CATEGORY_KEY_PATTERN.test(key)
  );
}

export function isValidFieldKey(key: string): boolean {
  return checkFieldKey(key).valid;
}

export function isValidOrgSlug(slug: string): boolean {
  return ORG_SLUG_PATTERN.test(slug);
}
