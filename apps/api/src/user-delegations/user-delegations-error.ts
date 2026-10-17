import { GraphQLError } from "graphql";

/**
 * 代理設定被拒的原因(`VALIDATION_FAILED` 的 `extensions.reason`;GQL-04「同一個 code 有多種說法時加 reason」)。
 * 語意見 `docs/modules/workflows.md`「代理人」。
 */
export const USER_DELEGATION_REJECT_REASONS = [
  /** 與自己既有(未結束)的代理期間重疊 */
  "DELEGATION_OVERLAP",
  /** 代理人是自己 */
  "SELF_DELEGATION",
  /** 代理人停用、不存在或不在本租戶(操作者站在根組織也算:沒有可代理的租戶) */
  "DELEGATE_NOT_ELIGIBLE",
  /** 迄 <= 起,或新增時迄已過 */
  "INVALID_PERIOD",
  /** 已結束的代理唯讀(不能改、不能刪) */
  "DELEGATION_ENDED",
] as const;

export type UserDelegationRejectReason =
  (typeof USER_DELEGATION_REJECT_REASONS)[number];

export function userDelegationRejected(
  reason: UserDelegationRejectReason,
): GraphQLError {
  return new GraphQLError(`User delegation rejected: ${reason}`, {
    extensions: { code: "VALIDATION_FAILED", reason },
  });
}

/** 不存在、已刪除,或不是自己的(不透露差別)。 */
export function userDelegationNotFound(id: string): GraphQLError {
  return new GraphQLError(`User delegation "${id}" not found`, {
    extensions: { code: "NOT_FOUND" },
  });
}
