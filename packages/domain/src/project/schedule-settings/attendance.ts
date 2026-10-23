/**
 * 出勤紀錄與補打卡申請的共用規則(規格 14.7、14.8;正本 `docs/modules/project/schedule.md`「出勤紀錄與補打卡」)。
 * 純函式與常數:api(出勤紀錄、補打卡的掛接點)、admin(補打卡新增頁、出勤紀錄 Excel)、受管表單的 seed 共用。
 */

const MS_PER_MINUTE = 60_000;

/** 遲到 / 早退寬限(規則 `graceMinutes`,店;預設各 5 分鐘)。 */
export interface AttendanceGrace {
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
}

export const DEFAULT_ATTENDANCE_GRACE: AttendanceGrace = {
  lateGraceMinutes: 5,
  earlyLeaveGraceMinutes: 5,
};

/**
 * 超過寬限才算:差距 **大於** 寬限(剛好 5:00 不算、5:01 算);算了以後的分鐘數無條件進位
 * (晚 5 分 1 秒 = 6 分),所以算了就至少 1 分。沒打卡 → 0(另外算未到 / 缺卡)。
 */
function minutesBeyond(diffMs: number, graceMinutes: number): number {
  if (diffMs <= graceMinutes * MS_PER_MINUTE) {
    return 0;
  }
  return Math.ceil(diffMs / MS_PER_MINUTE);
}

/** 遲到幾分(上班卡晚於上班時間超過寬限);0 = 沒遲到。 */
export function lateMinutesOf(
  startAt: Date,
  clockIn: Date | null,
  graceMinutes: number,
): number {
  return clockIn === null
    ? 0
    : minutesBeyond(clockIn.getTime() - startAt.getTime(), graceMinutes);
}

/** 早退幾分(下班卡早於下班時間超過寬限);0 = 沒早退。 */
export function earlyLeaveMinutesOf(
  endAt: Date,
  clockOut: Date | null,
  graceMinutes: number,
): number {
  return clockOut === null
    ? 0
    : minutesBeyond(endAt.getTime() - clockOut.getTime(), graceMinutes);
}

/** 出勤狀態:已到(有上班卡)/ 未到(班已開始、沒有上班卡)/ 未開始。 */
export const ATTENDANCE_STATUSES = ["arrived", "absent", "upcoming"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceEntryLike {
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}

export interface Attendance {
  status: AttendanceStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** 實際工時(分)= 下班 − 上班 − 休息;上下班卡缺一張 = null */
  workedMinutes: number | null;
  /** 排班工時(分)= 排班下班 − 上班 − 休息 */
  scheduledMinutes: number;
}

/**
 * 一筆排班的出勤(上下班卡 = 生效的那兩張,`punch-rules` 的「上班取最早、下班取最晚」)。
 * 不做薪資計算(規格 14.7)。
 */
export function attendanceOf(
  entry: AttendanceEntryLike,
  clockIn: Date | null,
  clockOut: Date | null,
  grace: AttendanceGrace,
  now: Date,
): Attendance {
  let status: AttendanceStatus = "arrived";
  if (clockIn === null) {
    status = now.getTime() >= entry.startAt.getTime() ? "absent" : "upcoming";
  }
  return {
    status,
    lateMinutes: lateMinutesOf(entry.startAt, clockIn, grace.lateGraceMinutes),
    earlyLeaveMinutes: earlyLeaveMinutesOf(
      entry.endAt,
      clockOut,
      grace.earlyLeaveGraceMinutes,
    ),
    workedMinutes:
      clockIn === null || clockOut === null
        ? null
        : Math.max(
            0,
            Math.round(
              (clockOut.getTime() - clockIn.getTime()) / MS_PER_MINUTE,
            ) - entry.breakMinutes,
          ),
    scheduledMinutes:
      Math.round(
        (entry.endAt.getTime() - entry.startAt.getTime()) / MS_PER_MINUTE,
      ) - entry.breakMinutes,
  };
}

// ---- 補打卡申請(受管表單 `seeds/project/revisions/makeup_punch.*.seed.ts`) ----

/** 補打卡申請的表單代號(底線;規格 2.1 寫的 `makeup-punch`)。 */
export const MAKEUP_PUNCH_FORM_KEY = "makeup_punch";

/** 綁定的模組。 */
export const MAKEUP_PUNCH_MODULE_KEY = "schedule.attendance";

/** 補打卡申請的欄位 key(seed、掛接點、新增頁讀同一份)。 */
export const MAKEUP_PUNCH_FIELD_KEYS = {
  /** 補打卡的時間(datetime;時點) */
  punchAt: "punch_at",
  /** 分店(reference org) */
  branch: "branch",
  /** 對應排班(text):排班 id,或 `MAKEUP_PUNCH_NO_ENTRY`「沒有排班(臨時代班)」 */
  entry: "entry",
  /** 對應排班的顯示文字(text;送出當下的快照,例「早 08:30–14:30」) */
  entryLabel: "entry_label",
  /** 類型(select static):`in` 上班 / `out` 下班 */
  punchType: "punch_type",
  /** 原因(select fieldCategory 補打卡原因) */
  reason: "reason",
  /** 說明(text;原因選「其他」必填) */
  note: "note",
} as const;

/** 「對應排班」選「沒有排班(臨時代班)」的存值。 */
export const MAKEUP_PUNCH_NO_ENTRY = "none";

/**
 * 「對應排班」的存值 → 排班 id:`none` = null(未對應排班);沒選 / 不是文字 = undefined(擋下「請選擇對應排班」)。
 */
export function makeupPunchEntryIdOf(
  value: unknown,
): string | null | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value === MAKEUP_PUNCH_NO_ENTRY ? null : value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 引用欄位的存值(`{ id, label }` 或 id 字串)→ id;沒有 = null。 */
function referenceIdOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (isRecord(value) && typeof value.id === "string" && value.id !== "") {
    return value.id;
  }
  return null;
}

/** 選項欄的存值(靜態選項存值字串、類別選項存 `{ value, label }`)→ 值;沒有 = null。 */
function optionValueOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (
    isRecord(value) &&
    typeof value.value === "string" &&
    value.value !== ""
  ) {
    return value.value;
  }
  return null;
}

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** 補打卡申請的欄位值(解析後;格式不對的欄位是 null)。 */
export interface MakeupPunchValues {
  /** 補打卡的時點;沒有 / 不是時點 = null */
  punchAt: Date | null;
  branchId: string | null;
  /** 排班 id;null = 沒有排班(臨時代班);undefined = 沒選 */
  entryId: string | null | undefined;
  /** `in` / `out`;其他 = null */
  punchType: "in" | "out" | null;
  reasonKey: string | null;
  note: string | null;
}

/** 表單存值 → 補打卡申請的欄位(掛接點與新增頁共用)。 */
export function makeupPunchValuesOf(
  values: Readonly<Record<string, unknown>>,
): MakeupPunchValues {
  const keys = MAKEUP_PUNCH_FIELD_KEYS;
  const rawAt = values[keys.punchAt];
  const at =
    typeof rawAt === "string" || rawAt instanceof Date ? new Date(rawAt) : null;
  const type = optionValueOf(values[keys.punchType]);
  return {
    punchAt: at === null || Number.isNaN(at.getTime()) ? null : at,
    branchId: referenceIdOf(values[keys.branch]),
    entryId: makeupPunchEntryIdOf(values[keys.entry]),
    punchType: type === "in" || type === "out" ? type : null,
    reasonKey: optionValueOf(values[keys.reason]),
    note: textOf(values[keys.note]),
  };
}
