import { GraphQLError } from "graphql";

/**
 * 欄位管理的業務錯誤碼(GQL-04:`extensions.code` 列舉值;清單正本 docs/standards/api/graphql-schema.md)。
 * message 給開發者看(英文);使用者文案由前端依 code 對應。
 * 沿用的通用碼(`FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`)不重複宣告於此。
 */
export const FIELD_ERROR_CODES = [
  /** 同一類別下 value 重複(同組織已有,或與該類別的全域選項相同);field-manager.md「待辦」 */
  "FIELD_VALUE_DUPLICATE",
  /** root 新增類別時 `key` 已被用過(含停用的類別);`extensions.fields = ["key"]` */
  "FIELD_CATEGORY_KEY_DUPLICATE",
] as const;

export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

/** `extensions.fields` 讓前端把錯誤標回表單的「值」欄位(與 VALIDATION_FAILED 同慣例)。 */
export function fieldValueDuplicateError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FIELD_VALUE_DUPLICATE", fields: ["value"] },
  });
}

/** 類別 key 已存在(唯一;含停用的類別);前端把錯誤標回彈窗的「key」欄位。 */
export function fieldCategoryKeyDuplicateError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FIELD_CATEGORY_KEY_DUPLICATE", fields: ["key"] },
  });
}

/** 查的類別 / 選項在操作者可見範圍內不存在(GQL-04 `NOT_FOUND`)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/**
 * `FORBIDDEN` 的細分原因(`extensions.reason`;先例 `RULE_INVALID` 的 reason)。
 * 三種擋法對使用者的說法完全不同,只回 `FORBIDDEN` 的話前端只講得出最常見的那一種。
 */
export const FIELD_FORBIDDEN_REASONS = [
  /** 種子選項的 label / order / description 唯讀(只能 `setFieldEnabled`)。 */
  "SEED_READ_ONLY",
  /** 種子選項的 `enabled` 是全域開關,限根組織操作者。 */
  "SEED_GLOBAL_SWITCH",
  /** 看得到、但不是自己這一層加的自訂選項(上層或下層組織加的)。 */
  "NOT_OWNER",
  /** 改名 / 停用 seed 宣告的系統類別(由 seed 維護,畫面唯讀;啟用可以)。 */
  "SYSTEM_CATEGORY",
  /** 類別作業(新增 / 改名 / 停用類別)只能站在根組織做;權限可能經角色被帶到別的組織。 */
  "ROOT_ONLY",
] as const;

export type FieldForbiddenReason = (typeof FIELD_FORBIDDEN_REASONS)[number];

/**
 * 有登入但做了不被允許的事(GQL-04 `FORBIDDEN`):改種子選項、碰別的組織的自訂選項、
 * 改名或停用系統類別、不在根組織做類別作業。
 */
export function forbiddenError(
  message: string,
  reason: FieldForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}

/** 輸入不合法(GQL-04 `VALIDATION_FAILED`):`extensions.fields` 列出有問題的欄位。 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}
