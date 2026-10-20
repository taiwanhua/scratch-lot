import { ClientError } from "@repo/graphql";

/** 存排班違反限制被擋下時 api 帶回的違反(`extensions.violations`;api 正本 `rosterRuleError`)。 */
export interface RosterRuleViolationError {
  key: string;
  level: string;
  /** api 的說明(例「2/4 排 10 小時,最多 8 小時」) */
  message: string;
}

const extensionsOf = (error: unknown): Record<string, unknown> | undefined => {
  if (!(error instanceof ClientError)) {
    return undefined;
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  return errors?.[0]?.extensions;
};

const isViolation = (value: unknown): value is RosterRuleViolationError =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { key?: unknown }).key === "string" &&
  typeof (value as { message?: unknown }).message === "string";

/** 讀出存排班被擋下的規則違反;不是這種錯誤回空陣列。 */
export const rosterRuleViolationsOf = (
  error: unknown,
): RosterRuleViolationError[] => {
  const violations = extensionsOf(error)?.violations;
  return Array.isArray(violations) ? violations.filter(isViolation) : [];
};

/** 發布被擋的原因(`extensions.reason`;api 正本 `publishBlockedError`)。 */
export type PublishBlockedReason =
  "HAS_LIMIT_VIOLATIONS" | "ALREADY_PUBLISHED" | "CHANGED_DURING_PUBLISH";

const PUBLISH_REASONS: ReadonlySet<string> = new Set([
  "HAS_LIMIT_VIOLATIONS",
  "ALREADY_PUBLISHED",
  "CHANGED_DURING_PUBLISH",
]);

export const publishBlockedReasonOf = (
  error: unknown,
): PublishBlockedReason | null => {
  const reason = extensionsOf(error)?.reason;
  return typeof reason === "string" && PUBLISH_REASONS.has(reason)
    ? (reason as PublishBlockedReason)
    : null;
};
