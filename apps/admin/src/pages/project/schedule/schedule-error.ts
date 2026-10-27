import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 班表管理會收到的錯誤碼(GQL-04;api 正本 `apps/api/src/project/schedule/shared/schedule-error.ts`)。
 * `FORBIDDEN` 依 `reason` 細分:`NOT_OWNER`(上層建立的,只有建立的那一層能改)、
 * `MISSING_PERMISSION`(沒有這個組織要的權限)、`OUTSIDE_DAY_OFF_WINDOW`(本人在畫休開放期間外修改);
 * `VALIDATION_FAILED` 的 `reason: AUTO_RUN_IN_PROGRESS` 細分成 `AUTO_RUN_IN_PROGRESS`(自動排班執行中鎖定這個月)。
 * 文案在 `admin.schedule.errors.*`。
 */
export const SCHEDULE_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "NOT_OWNER",
  "MISSING_PERMISSION",
  "OUTSIDE_DAY_OFF_WINDOW",
  "AUTO_RUN_IN_PROGRESS",
] as const;

export type ScheduleErrorCode =
  (typeof SCHEDULE_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * `VALIDATION_FAILED` 的細分原因(api 正本 `SCHEDULE_REASONS`):衝突、重複、狀態不合;文案在
 * `admin.schedule.errors.reasons.<reason>`,寫在指到的欄位下(REACT-18)。沒有原因 = 格式錯 / 必填。
 */
export const SCHEDULE_REASONS = [
  "CALENDAR_DAY_DUPLICATE",
  "DAY_OFF_DUPLICATE",
  "TIME_RANGES_OVERLAP",
  "DAY_OFF_WHOLE_DAY",
  "NO_PRIMARY_STORE",
  "DEMAND_HAS_ASSIGNMENTS",
  "NOT_CANDIDATE",
  "STORE_CLOSED",
  "ENTRY_OVERLAP",
  "DAY_OFF_CONFLICT",
  "PUNCH_UNAVAILABLE",
  "TASK_NOT_ON_DAY",
  "CANNOT_LEAD",
  "TASK_TAKEN",
  "DEMAND_REPEATED",
  "TASK_ROLE_LOCKED",
  "ALREADY_JOINED",
  "ORG_REPEATED",
  "PRIMARY_ORG_REQUIRED",
  "OPTION_DISABLED",
  "RULE_NOT_TOGGLEABLE",
  "PUNCH_NOT_ALLOWED",
  "CONCURRENT_EDIT",
  "REFERENCE_NOT_FOUND",
] as const;

export type ScheduleReason = (typeof SCHEDULE_REASONS)[number];

export type ScheduleError = AdminError<ScheduleErrorCode, ScheduleReason>;

const REFINED = new Set([
  "NOT_OWNER",
  "MISSING_PERMISSION",
  "OUTSIDE_DAY_OFF_WINDOW",
]);

export const scheduleErrorOf = (error: unknown): ScheduleError =>
  parseAdminError(error, {
    codes: SCHEDULE_ERROR_CODES,
    reasons: SCHEDULE_REASONS,
    refine: (code, reason) => {
      if (
        code === "FORBIDDEN" &&
        typeof reason === "string" &&
        REFINED.has(reason)
      ) {
        return reason as ScheduleErrorCode;
      }
      // 自動排班執行中鎖定這個月:排班表的寫入都被擋(規格 14.1 `schedule_periods`)
      return code === "VALIDATION_FAILED" && reason === "AUTO_RUN_IN_PROGRESS"
        ? "AUTO_RUN_IN_PROGRESS"
        : undefined;
    },
  });

/** 畫休違反限制被擋下時 api 帶回的違反(`extensions.violations`;api 正本 `dayOffRuleError`)。 */
export interface ScheduleDayOffViolationError {
  key: string;
  level: string;
  message: string;
  dates: string[];
  actual: number | null;
  limit: number | null;
  from: string | null;
  to: string | null;
}

const isViolation = (value: unknown): value is ScheduleDayOffViolationError =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { key?: unknown }).key === "string" &&
  Array.isArray((value as { dates?: unknown }).dates);

/** 讀出畫休存檔被擋下的違反;不是這種錯誤回空陣列。 */
export const dayOffViolationsOf = (
  error: unknown,
): ScheduleDayOffViolationError[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as {
    errors?: { extensions?: { violations?: unknown } }[];
  };
  const violations = errors?.[0]?.extensions?.violations;
  return Array.isArray(violations) ? violations.filter(isViolation) : [];
};

/**
 * 提示(Snackbar / Alert)的文案 key(`admin.schedule.errors` 底下):`VALIDATION_FAILED` 帶了原因就用原因
 * (`reasons.<reason>`),否則用碼。對話框有欄位可以標時改用 `scheduleErrorTextsOf`(REACT-18:原因寫在欄位下)。
 */
export const scheduleErrorKey = (error: unknown): string => {
  const parsed = scheduleErrorOf(error);
  return parsed.reason === undefined ? parsed.code : `reasons.${parsed.reason}`;
};
