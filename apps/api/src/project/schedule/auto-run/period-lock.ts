import { GraphQLError } from "graphql";

import { SCHEDULE_AUTO_RUN_LOCK_MS } from "@repo/domain/project/schedule-settings";

/**
 * 自動排班執行期間鎖定這個月(規格 14.1 `schedule_periods`:條件更新標記 `lockedAt` / `lockedBy`,
 * 10 分鐘逾時自動解除;14.5「執行期間鎖定這個月(其他人看到「自動排班執行中」)」)。
 *
 * 鎖住時:另一個人按 [自動排班]、套用範本、清除自動排入的人,以及排班表的人力需求 / 排班寫入都被擋下,
 * 回 `VALIDATION_FAILED`(欄位 `month`)+ `extensions.reason = AUTO_RUN_IN_PROGRESS`。
 */

/** 鎖定中(標記時點在 10 分鐘內)。 */
export function isAutoRunLocked(
  period: { lockedAt?: Date | null },
  now: Date,
): boolean {
  return (
    period.lockedAt !== null &&
    period.lockedAt !== undefined &&
    now.getTime() - period.lockedAt.getTime() < SCHEDULE_AUTO_RUN_LOCK_MS
  );
}

/** 鎖定逾時的界線:標記時點早於它的視為已解除。 */
export function lockExpiredBefore(now: Date): Date {
  return new Date(now.getTime() - SCHEDULE_AUTO_RUN_LOCK_MS);
}

export type AutoRunBlockedReason = "AUTO_RUN_IN_PROGRESS" | "ALREADY_PUBLISHED";

/** 自動排班 / 套用範本 / 清除被擋:`VALIDATION_FAILED`(欄位 `month`)+ `extensions.reason`。 */
export function autoRunBlockedError(
  reason: AutoRunBlockedReason,
): GraphQLError {
  return new GraphQLError(`schedule month is not writable: ${reason}`, {
    extensions: { code: "VALIDATION_FAILED", fields: ["month"], reason },
  });
}

export function autoRunInProgressError(): GraphQLError {
  return autoRunBlockedError("AUTO_RUN_IN_PROGRESS");
}
