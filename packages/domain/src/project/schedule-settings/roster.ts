/**
 * 排班表(規格 14.5「排班表」)前後端共用的純函式:預設休息、自動填第一個空的執行任務、
 * 負責人上下班時間涵蓋檢查、統計欄的欄位與總工時寫法。
 */

/** 規則「預設休息」的一級:排班長度滿 `minMinutes` 分鐘 → 休息 `breakMinutes` 分鐘。 */
export interface ScheduleBreakTier {
  minMinutes: number;
  breakMinutes: number;
}

/**
 * 新增排班時帶入的休息分鐘數(規則「預設休息」):取長度已達門檻的級距中門檻最高的那一級;
 * 一級都沒達到 → 0。
 */
export function defaultBreakMinutes(
  tiers: readonly ScheduleBreakTier[],
  durationMinutes: number,
): number {
  let picked: ScheduleBreakTier | null = null;
  for (const tier of tiers) {
    if (
      tier.minMinutes <= durationMinutes &&
      (picked === null || tier.minMinutes > picked.minMinutes)
    ) {
      picked = tier;
    }
  }
  return picked?.breakMinutes ?? 0;
}

/** 一筆執行任務在「加入這天的人力需求」裡的狀態。 */
export interface ScheduleOpenTaskLike {
  taskId: string;
  /** `leader` 負責人 / `helper` 協同 */
  role: string;
  /** 已被別筆排班填了 */
  filled: boolean;
}

/**
 * 選了一筆人力需求時自動填的執行任務(規格 14.5 排班對話框):這筆還缺負責、而且這個人可以擔任負責人 →
 * 那筆負責;否則第一個空的協同;都沒有 → null(只能自己選)。
 */
export function pickOpenTask(
  tasks: readonly ScheduleOpenTaskLike[],
  canLead: boolean,
): string | null {
  if (canLead) {
    const leader = tasks.find((task) => task.role === "leader" && !task.filled);
    if (leader !== undefined) {
      return leader.taskId;
    }
  }
  const helper = tasks.find((task) => task.role === "helper" && !task.filled);
  return helper?.taskId ?? null;
}

/** 時間區間(毫秒時點)。 */
export interface ScheduleTimeRange {
  startAt: number;
  endAt: number;
}

/**
 * 負責人上下班時間沒涵蓋那筆人力需求時要提示的兩端(規格 14.5「時間涵蓋提示」):
 * `extendStartTo` = 要往前延長到的時點(上班比需求晚)、`extendEndTo` = 要往後延長到的時點(下班比需求早);
 * 涵蓋了回兩個 null。協同可以只上一段,不呼叫本函式。
 */
export function leaderCoverageGaps(
  entry: ScheduleTimeRange,
  demand: ScheduleTimeRange,
): { extendStartTo: number | null; extendEndTo: number | null } {
  return {
    extendStartTo: entry.startAt > demand.startAt ? demand.startAt : null,
    extendEndTo: entry.endAt < demand.endAt ? demand.endAt : null,
  };
}

/**
 * 班表檢視統計欄([⚙ 顯示欄位] 可以勾選的欄;存個人偏好 `scheduleRosterColumns`,逗號分隔):
 * 班數、負責班數、總工時、畫休天數、最長連續上班。
 */
export const SCHEDULE_ROSTER_STAT_COLUMNS = [
  "shiftCount",
  "leadShiftCount",
  "workMinutes",
  "dayOffDays",
  "longestStreak",
] as const;
export type ScheduleRosterStatColumn =
  (typeof SCHEDULE_ROSTER_STAT_COLUMNS)[number];

/** 沒設定過時顯示的欄(最長連續上班預設不勾)。 */
export const DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS: readonly ScheduleRosterStatColumn[] =
  ["shiftCount", "leadShiftCount", "workMinutes", "dayOffDays"];

/** 個人偏好 key(api 登記在 `apps/api/src/project/user-preferences.ts`)。 */
export const SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY = "scheduleRosterColumns";

/** 偏好值的格式:統計欄 key 以逗號分隔(可以是空字串 = 都不顯示)。 */
export const SCHEDULE_ROSTER_COLUMNS_PATTERN = new RegExp(
  `^(?:(?:${SCHEDULE_ROSTER_STAT_COLUMNS.join("|")})(?:,(?:${SCHEDULE_ROSTER_STAT_COLUMNS.join("|")}))*)?$`,
  "u",
);

/** 偏好值 → 要顯示的欄(依固定順序;不是字串 → 預設)。 */
export function rosterStatColumnsOf(
  value: unknown,
): ScheduleRosterStatColumn[] {
  if (
    typeof value !== "string" ||
    !SCHEDULE_ROSTER_COLUMNS_PATTERN.test(value)
  ) {
    return [...DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS];
  }
  const picked = new Set(value.split(","));
  return SCHEDULE_ROSTER_STAT_COLUMNS.filter((column) => picked.has(column));
}

/** 要顯示的欄 → 偏好值。 */
export function rosterStatColumnsValue(
  columns: readonly ScheduleRosterStatColumn[],
): string {
  const picked = new Set(columns);
  return SCHEDULE_ROSTER_STAT_COLUMNS.filter((column) =>
    picked.has(column),
  ).join(",");
}

/** 總工時寫法:到分鐘,`時:分`(例 9150 分 → `152:30`)。 */
export function formatWorkMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(hours)}:${String(rest).padStart(2, "0")}`;
}

/** 人力需求的來源(規格 14.1 `schedule_demands.source`):範本 / 週範本 / 手動 / 自動排班補上。 */
export const SCHEDULE_DEMAND_SOURCES = [
  "template",
  "week-template",
  "manual",
  "auto",
] as const;
export type ScheduleDemandSource = (typeof SCHEDULE_DEMAND_SOURCES)[number];

/** 排班填進執行任務的來源(規格 14.1 `schedule_task_assignments.source`):手動 / 自動。 */
export const SCHEDULE_ASSIGNMENT_SOURCES = ["manual", "auto"] as const;
export type ScheduleAssignmentSource =
  (typeof SCHEDULE_ASSIGNMENT_SOURCES)[number];

/** 月份的發布狀態(規格 14.1 `schedule_periods`):未發布 / 已發布(只會從未發布變成已發布)。 */
export const SCHEDULE_PERIOD_STATUSES = ["unpublished", "published"] as const;
export type SchedulePeriodStatus = (typeof SCHEDULE_PERIOD_STATUSES)[number];

/**
 * 自動排班的方式(規格 14.5「自動排班」):只填空位 / 重排自動排入的人 / 全部重排(連手動排的一起清掉)。
 */
export const SCHEDULE_AUTO_RUN_MODES = [
  "fill-empty",
  "redo-auto",
  "redo-all",
] as const;
export type ScheduleAutoRunMode = (typeof SCHEDULE_AUTO_RUN_MODES)[number];

/**
 * 自動排班的排序條件(規格 14.5「排序條件的定義」):依勾選順序組成字典序比較候選人,前一個平手才比下一個;
 * 全部平手或都不勾 → 隨機。另一個條件「允許同一人同時段填進多筆人力需求」(`allowOverlappingDemands`)不是排序條件。
 */
export const SCHEDULE_AUTO_RUN_SORT_CONDITIONS = [
  "continuePreviousEntry",
  "leaderCountFirst",
  "monthlyShiftBalance",
] as const;
export type ScheduleAutoRunSortCondition =
  (typeof SCHEDULE_AUTO_RUN_SORT_CONDITIONS)[number];

/** 自動排班條件「允許同一人同時段填進多筆人力需求」(兼多個崗位,預設不勾)。 */
export const SCHEDULE_AUTO_RUN_OVERLAP_CONDITION = "allowOverlappingDemands";

/** 自動排班執行中的鎖定多久後自動解除(規格 14.1 `schedule_periods`:10 分鐘逾時)。 */
export const SCHEDULE_AUTO_RUN_LOCK_MS = 10 * 60 * 1000;
