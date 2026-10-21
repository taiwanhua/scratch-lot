import { GraphQLError } from "graphql";

/**
 * 店面管理的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export const STORE_REASONS = {
  /** 這個收銀點已經有開著的班(兩人同時開班時後到的那一個) */
  shiftAlreadyOpen: "SHIFT_ALREADY_OPEN",
  /** 操作者在別家店還有開著的班(一個人只能同時開同一家店的班) */
  shiftInOtherStore: "SHIFT_IN_OTHER_STORE",
  /** 這一班已送出交班結帳(班已結束) */
  shiftClosed: "SHIFT_CLOSED",
  /** 收銀點已停用 */
  cashPointDisabled: "CASH_POINT_DISABLED",
  /** 選的排班不是這個人當天在這家店的排班 */
  entryNotAvailable: "ENTRY_NOT_AVAILABLE",
  /** 不是第一班、或沒有出庫權限,不能「從小金庫領零用金」 */
  openingFloatNotAllowed: "OPENING_FLOAT_NOT_ALLOWED",
  /** 投庫金額超過抽屜目前的應有現金 */
  amountExceedsDrawer: "AMOUNT_EXCEEDS_DRAWER",
  /** 出庫(含開班從小金庫領零用金)超過小金庫目前的應有現金 */
  amountExceedsVault: "AMOUNT_EXCEEDS_VAULT",
} as const;

export type StoreReason = (typeof STORE_REASONS)[keyof typeof STORE_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位,`reason` 選填。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: StoreReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}
