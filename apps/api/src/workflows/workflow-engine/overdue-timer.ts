import type {
  OverdueReminderDef,
  StepDef,
  TaskStatus,
} from "@repo/domain/workflow";
import { isReviewStep } from "@repo/domain/workflow";

const HOUR_MS = 3_600_000;

/** 任務的逾時提醒計時欄位(`workflow_tasks` 的 `assignedAt` / `overdueLevel` / `overdueDueAt`)。 */
export interface OverdueTimer {
  assignedAt: Date;
  overdueLevel: number;
  overdueDueAt: Date | null;
}

/** 這一關的逾時提醒設定(匯合節點、沒開 → null)。 */
export function overdueOf(
  step: StepDef | undefined,
): OverdueReminderDef | null {
  return step !== undefined && isReviewStep(step)
    ? (step.overdue ?? null)
    : null;
}

/**
 * 已通知到 `level` 級之後,下一級的到期時點(日曆小時,從 `assignedAt` 起算):
 * 0 → N 小時、1 → M 小時、2 → 沒有下一級。
 */
export function nextOverdueDueAt(
  overdue: OverdueReminderDef | null,
  assignedAt: Date,
  level: number,
): Date | null {
  if (overdue === null || level >= 2) {
    return null;
  }
  const hours =
    level === 0 ? overdue.reviewerAfterHours : overdue.audienceAfterHours;
  return new Date(assignedAt.getTime() + hours * HOUR_MS);
}

/**
 * 派給一位承辦人時的計時(建任務、改派):重新計時、從 0 級開始。不是待處理(自動通過建出的已核准任務)
 * → 不排到期時點。
 */
export function overdueTimerOf(
  step: StepDef | undefined,
  status: TaskStatus,
  assignedAt: Date,
): OverdueTimer {
  return {
    assignedAt,
    overdueLevel: 0,
    overdueDueAt:
      status === "pending"
        ? nextOverdueDueAt(overdueOf(step), assignedAt, 0)
        : null,
  };
}
