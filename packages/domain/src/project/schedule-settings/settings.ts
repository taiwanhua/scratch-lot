/**
 * 排班設定的程式固定值(規格第 13 章「班表管理用到的選項」的程式固定欄、14.1、14.4)。
 * 值是英文代碼(存進資料庫);畫面文字在 admin 的 i18n。
 */

/** 職責:負責人 / 協同。 */
export const SCHEDULE_TASK_ROLES = ["leader", "helper"] as const;
export type ScheduleTaskRole = (typeof SCHEDULE_TASK_ROLES)[number];

/** 一筆人力需求(與範本)最多幾筆負責人 / 協同執行任務。 */
export const MAX_LEADER_TASKS = 1;
export const MAX_HELPER_TASKS = 10;

/** 人力需求範本的簡稱長度(1–2 字,以字元計)。 */
export const TEMPLATE_SHORT_NAME_MAX = 2;

/** 僱用類型:正職 / 兼職。 */
export const SCHEDULE_EMPLOYMENT_TYPES = ["full-time", "part-time"] as const;
export type ScheduleEmploymentType = (typeof SCHEDULE_EMPLOYMENT_TYPES)[number];

/** 行事曆類型:店休 / 特殊日。 */
export const SCHEDULE_CALENDAR_DAY_TYPES = ["closed", "special"] as const;
export type ScheduleCalendarDayType =
  (typeof SCHEDULE_CALENDAR_DAY_TYPES)[number];

/** 人力需求週範本的星期:0 = 星期日 … 6 = 星期六(同 `Date#getDay`)。 */
export const WEEK_DAY_COUNT = 7;

export interface ScheduleTemplateTaskLike {
  role: string;
}

/** 依職責數筆數;超過上限的職責名(`leader` / `helper`)。 */
export function exceededTaskRoles(
  tasks: readonly ScheduleTemplateTaskLike[],
): ScheduleTaskRole[] {
  const leaders = tasks.filter((task) => task.role === "leader").length;
  const helpers = tasks.filter((task) => task.role === "helper").length;
  const exceeded: ScheduleTaskRole[] = [];
  if (leaders > MAX_LEADER_TASKS) {
    exceeded.push("leader");
  }
  if (helpers > MAX_HELPER_TASKS) {
    exceeded.push("helper");
  }
  return exceeded;
}

/** 簡稱:去掉頭尾空白後 1–2 個字(以字素計,中文一字算一個)。 */
export function isTemplateShortName(value: string): boolean {
  const segmenter = new Intl.Segmenter("zh-TW", { granularity: "grapheme" });
  const length = [...segmenter.segment(value.trim())].length;
  return length >= 1 && length <= TEMPLATE_SHORT_NAME_MAX;
}

/** 畫休種類:整天畫休 / 時段不可排(規格 14.1 `schedule_day_offs`、第 13 章「畫休種類」程式固定)。 */
export const SCHEDULE_DAY_OFF_KINDS = ["full-day", "time-range"] as const;
export type ScheduleDayOffKind = (typeof SCHEDULE_DAY_OFF_KINDS)[number];
