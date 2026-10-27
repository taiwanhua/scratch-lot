import { GraphQLError } from "graphql";

/**
 * 檔案管理的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED`,
 * 不新增 code;需要細分原因時放 `extensions.reason`(正本 `docs/modules/project/master-data.md`「錯誤碼」)。
 */

/** `VALIDATION_FAILED` 的細分原因。 */
export const MASTER_DATA_REASONS = {
  /** 遊戲代號在租戶內重複 */
  gameCodeDuplicate: "GAME_CODE_DUPLICATE",
  /** 遊戲已有庫存:代號、面額、張數不能改,也不能刪除 */
  gameInUse: "GAME_IN_USE",
  /** 同一家分店已有這個崗位的收銀點 */
  positionDuplicate: "POSITION_DUPLICATE",
  /** 同一家分店已有同名的收銀點 */
  nameDuplicate: "NAME_DUPLICATE",
  /** 收銀點有開著的班或檯面上還有張數,不能停用 */
  cashPointInUse: "CASH_POINT_IN_USE",
} as const;

export type MasterDataReason =
  (typeof MASTER_DATA_REASONS)[keyof typeof MASTER_DATA_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位,`reason` 選填。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: MasterDataReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}
