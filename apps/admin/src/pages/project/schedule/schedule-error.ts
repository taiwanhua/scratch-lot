import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 班表管理會收到的錯誤碼(GQL-04;api 正本 `apps/api/src/project/schedule/shared/schedule-error.ts`)。
 * `FORBIDDEN` 依 `reason` 細分:`NOT_OWNER`(上層建立的,只有建立的那一層能改)、
 * `MISSING_PERMISSION`(沒有這個組織要的權限)。文案在 `admin.schedule.errors.*`。
 */
export const SCHEDULE_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "NOT_OWNER",
  "MISSING_PERMISSION",
] as const;

export type ScheduleErrorCode =
  (typeof SCHEDULE_ERROR_CODES)[number] | "UNEXPECTED";

export type ScheduleError = AdminError<ScheduleErrorCode, never>;

const REFINED = new Set(["NOT_OWNER", "MISSING_PERMISSION"]);

export const scheduleErrorOf = (error: unknown): ScheduleError =>
  parseAdminError(error, {
    codes: SCHEDULE_ERROR_CODES,
    refine: (code, reason) =>
      code === "FORBIDDEN" && typeof reason === "string" && REFINED.has(reason)
        ? (reason as ScheduleErrorCode)
        : undefined,
  });
