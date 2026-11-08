import { GraphQLError } from "graphql";

/**
 * 刮刮樂設定的業務錯誤(GQL-04):只用通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`,不新增 code;
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/lottery-settings.md`「錯誤碼」)。
 * 組織找不到、站在根組織沿用排班設定的組織解析(`resolveScheduleOrg`)的錯誤。
 */
export const LOTTERY_SETTINGS_REASONS = {
  /** 改盤點制度被擋:有分店檯面上還有待標註的本,或有進行中的盤點 / 全店重刷 / 補點編號(9.1) */
  countModeChangeBlocked: "COUNT_MODE_CHANGE_BLOCKED",
  /** [取消轉換] 只有轉換中的店可以按(9.2) */
  notConverting: "NOT_CONVERTING",
  /** [取消轉換]、[變更紀錄] 只對分店(沒有下層組織的組織) */
  notStore: "NOT_STORE",
  /** 別人同時改了同一條(重新整理後再試) */
  concurrentEdit: "CONCURRENT_EDIT",
} as const;

export type LotterySettingsReason =
  (typeof LOTTERY_SETTINGS_REASONS)[keyof typeof LOTTERY_SETTINGS_REASONS];

/** 輸入不合法;`fields` 讓前端標回欄位,`reason` 選填;`details` 放擋下的明細(給畫面列出)。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: LotterySettingsReason,
  details?: Record<string, unknown>,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
      ...details,
    },
  });
}

/** 這個組織要的權限沒有(最上層組織要 `edit-default`、其他要 `edit-org`)。 */
export function missingPermissionError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason: "MISSING_PERMISSION" },
  });
}
