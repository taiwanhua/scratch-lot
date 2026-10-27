import { GraphQLError } from "graphql";

/**
 * 叫貨單的業務錯誤(GQL-04):只用通用碼,細分原因放 `extensions.reason`
 * (正本 `docs/modules/project/purchasing.md`「錯誤碼」)。掛接點擋下時的專案錯誤碼也列在這裡。
 */
export const REQUISITION_REASONS = {
  /** 明細有停售(或已刪除)的遊戲:送出擋下 */
  gameDiscontinued: "REQUISITION_GAME_DISCONTINUED",
  /** 明細沒有任何一列本數大於 0:送出擋下 */
  noLines: "REQUISITION_NO_LINES",
  /** 已被進貨單 / 調貨單引用:不能作廢、不能被第二張引用 */
  referenced: "REQUISITION_REFERENCED",
  /** 不是待購買(沒有完成、已作廢、找不到):不能被引用 */
  notPending: "REQUISITION_NOT_PENDING",
} as const;

export type RequisitionReason =
  (typeof REQUISITION_REASONS)[keyof typeof REQUISITION_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function validationError(
  message: string,
  fields: string[],
  reason?: RequisitionReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

export function conflictError(
  message: string,
  reason: RequisitionReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason },
  });
}
