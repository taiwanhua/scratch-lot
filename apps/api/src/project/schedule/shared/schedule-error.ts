import { GraphQLError } from "graphql";

/**
 * 排班的業務錯誤(GQL-04):只用通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`,不新增 code。
 * message 給開發者看(英文);使用者文案由前端依 code(與 `reason`)對應。
 */

/** 查的資料在操作者看得到的範圍內不存在(列表與單筆同一個答案)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法;`extensions.fields` 讓前端把錯誤標回表單欄位。 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/**
 * `FORBIDDEN` 的細分原因(`extensions.reason`):
 * - `NOT_OWNER`:看得到、但不是這一層建立的(範本 / 週範本 / 行事曆只有建立它的那一層能改)
 * - `MISSING_PERMISSION`:這個組織要的權限沒有(規則:最上層組織要 `edit-default-rules`、其他要 `edit-org-rules`)
 * - `OUTSIDE_DAY_OFF_WINDOW`:本人在畫休開放期間外登記 / 刪除(要調整請代改)
 */
export type ScheduleForbiddenReason =
  "NOT_OWNER" | "MISSING_PERMISSION" | "OUTSIDE_DAY_OFF_WINDOW";

export function forbiddenError(
  message: string,
  reason: ScheduleForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}

/**
 * 畫休違反限制(規格 14.6「違反限制 → 不存,提示原因」):`VALIDATION_FAILED`(欄位 `date`),
 * `extensions.violations` 列出擋下的違反(`key`、`level`、`message`、`dates`、`actual`、`limit`、`from`、`to`)。
 */
export function dayOffRuleError(violations: readonly object[]): GraphQLError {
  return new GraphQLError("day off violates schedule rules", {
    extensions: { code: "VALIDATION_FAILED", fields: ["date"], violations },
  });
}

/** MongoDB 唯一索引衝突(兩個請求同時寫同一個唯一鍵)。 */
const DUPLICATE_KEY_ERROR = 11_000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * 寫入撞到唯一索引時,回與事前檢查同一個 `VALIDATION_FAILED`(欄位 `fields`)。
 * 只包在交易外層(交易內不吞錯誤,TX-04):撞到時整個交易已回復,這裡只換成使用者看得懂的錯誤。
 */
export async function savingUnique<T>(
  write: () => Promise<T>,
  message: string,
  fields: string[],
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    throw validationError(message, fields);
  }
}
