import { GraphQLError } from "graphql";

/**
 * 個人偏好寫入被拒的原因(`VALIDATION_FAILED` 的 `extensions.reason`;GQL-04「同一個 code 有多種說法時加 reason」)。
 * `extensions.key` 指出是哪一個 key。
 */
export const USER_PREFERENCE_REJECT_REASONS = [
  /** key 沒有登記(底座與專案的登記都沒有) */
  "UNKNOWN_KEY",
  /** 值不符合該 key 登記的型別 / 格式 */
  "INVALID_VALUE",
] as const;

export type UserPreferenceRejectReason =
  (typeof USER_PREFERENCE_REJECT_REASONS)[number];

export function userPreferenceRejected(
  reason: UserPreferenceRejectReason,
  key: string,
): GraphQLError {
  return new GraphQLError(`User preference "${key}" rejected: ${reason}`, {
    extensions: { code: "VALIDATION_FAILED", reason, key },
  });
}
