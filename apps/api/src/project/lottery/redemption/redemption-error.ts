import { GraphQLError } from "graphql";

/**
 * 兌獎的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN`,
 * 細分原因放 `extensions.reason`(正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export const REDEMPTION_REASONS = {
  /** 不是四種編號格式之一 */
  codeInvalid: "REDEMPTION_CODE_INVALID",
  /** 正面編號 / 條碼對不到唯一的遊戲(不是本店的刮刮樂、或本號對到兩款)→ 請刷背面編號 */
  codeNeedsBack: "REDEMPTION_CODE_NEEDS_BACK",
  /** 單張超過 5,000 元(請客人到銀行兌獎) */
  overLimit: "REDEMPTION_OVER_LIMIT",
  /** 超過抽屜目前的應有現金(同投庫的 reason) */
  amountExceedsDrawer: "AMOUNT_EXCEEDS_DRAWER",
  /** 這張已兌過獎(未撤銷的);`extensions` 帶 `redeemedAt`、`cashPointName` */
  duplicate: "REDEMPTION_DUPLICATE",
  /** 這一班已送出交班結帳(兌獎要開著的班) */
  shiftClosed: "SHIFT_CLOSED",
  /** 已送兌:要先撤回或退回那張進貨單 */
  sent: "REDEMPTION_SENT",
  /** 已撤銷(兩人同時撤銷時後到的那一個) */
  alreadyRevoked: "REDEMPTION_ALREADY_REVOKED",
  /**
   * 進貨單送出時勾選的兌獎紀錄被搶先撤銷 / 勾走(送出前檢查之後才發生;同進貨單的
   * `PURCHASE_REASONS.redemptionInvalid`,交易回復)
   */
  purchaseRedemptionInvalid: "PURCHASE_REDEMPTION_INVALID",
} as const;

export type RedemptionReason =
  (typeof REDEMPTION_REASONS)[keyof typeof REDEMPTION_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位;`extra` 放畫面要用的資料(例:已兌過的時間與收銀點)。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: RedemptionReason,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
      ...extra,
    },
  });
}
