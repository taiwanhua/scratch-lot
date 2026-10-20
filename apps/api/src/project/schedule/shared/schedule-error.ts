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
 */
export type ScheduleForbiddenReason = "NOT_OWNER" | "MISSING_PERMISSION";

export function forbiddenError(
  message: string,
  reason: ScheduleForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}
