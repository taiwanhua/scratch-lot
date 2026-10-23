import { formatTemporal } from "@repo/domain/form";

import type { SheetColumn, SheetData } from "./reports/excel";
import { localPartsOf } from "./schedule-roster";

/**
 * 出勤紀錄(規格 14.7)與排班對話框的未對應打卡區塊(規格 14.5)的純函式。
 * 遲到 / 早退、工時、缺卡由 api 算好;這裡只組畫面與 Excel 要的值。
 */

const MS_PER_MINUTE = 60_000;

/** 分鐘 → 小時(一位小數,例 322 → "5.4");null → null。 */
export const hoursOf = (minutes: number | null | undefined): string | null =>
  minutes === null || minutes === undefined
    ? null
    : (Math.round((minutes / 60) * 10) / 10).toFixed(1);

/** 一筆出勤列(Excel 用到的欄位;api 的 `ScheduleAttendanceRow`)。 */
export interface AttendanceSheetRow {
  /** 那天(租戶時區 00:00 的時點) */
  date: string;
  userName: string;
  orgName: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  shortName?: string | null;
  clockIn?: string | null;
  clockOut?: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes?: number | null;
  scheduledMinutes: number;
  specialDayCategory?: string | null;
  specialDayName?: string | null;
  hasMakeup: boolean;
}

/** Excel 的欄位(規格 14.7 的順序,前面多日期與人員);表頭文字由呼叫端翻譯好。 */
export const ATTENDANCE_SHEET_COLUMNS = [
  "date",
  "person",
  "entry",
  "clockIn",
  "clockOut",
  "onDutyHours",
  "breakMinutes",
  "workedHours",
  "scheduledHours",
  "lateMinutes",
  "earlyLeaveMinutes",
  "specialDayCategory",
  "makeupNote",
] as const;

export type AttendanceSheetColumn = (typeof ATTENDANCE_SHEET_COLUMNS)[number];

export interface AttendanceSheetText {
  /** 表頭(依 `ATTENDANCE_SHEET_COLUMNS`) */
  headers: Readonly<Record<AttendanceSheetColumn, string>>;
  /** 排班欄:「早 08:30–14:30」;沒有範本簡稱用「臨」 */
  temporary: string;
  /** 補卡註記欄的文字(有補打卡寫入的卡) */
  makeup: string;
  /** 工作表上方的說明列(例「2026 年 11 月」) */
  note: string;
}

const WIDTHS: Partial<Record<AttendanceSheetColumn, number>> = {
  date: 12,
  person: 12,
  entry: 20,
  specialDayCategory: 14,
};

const NUMERIC: ReadonlySet<AttendanceSheetColumn> = new Set([
  "onDutyHours",
  "breakMinutes",
  "workedHours",
  "scheduledHours",
  "lateMinutes",
  "earlyLeaveMinutes",
]);

const timeOf = (value: string | null | undefined, timezone: string) =>
  value === null || value === undefined
    ? null
    : localPartsOf(value, timezone).time;

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

/**
 * 出勤紀錄的 Excel:**一家分店一個工作表**(工作表名稱 = 分店名稱;`buildWorkbook` 整理重名與禁用字元)。
 * 在班時數 = 下班 − 上班;實際工時 = 下班 − 上班 − 休息;遲到 / 早退沒有就空白。不做薪資計算。
 */
export const attendanceSheetsOf = (
  sheets: readonly { orgName: string; rows: readonly AttendanceSheetRow[] }[],
  text: AttendanceSheetText,
  timezone: string,
): SheetData[] => {
  const columns: SheetColumn[] = ATTENDANCE_SHEET_COLUMNS.map((key) => ({
    key,
    header: text.headers[key],
    ...(WIDTHS[key] === undefined ? {} : { width: WIDTHS[key] }),
    ...(NUMERIC.has(key) ? { align: "right" as const } : {}),
  }));
  return sheets.map((sheet) => ({
    name: sheet.orgName,
    notes: [text.note],
    columns,
    rows: sheet.rows.map((row) => {
      const clockIn = row.clockIn ?? null;
      const clockOut = row.clockOut ?? null;
      const onDuty =
        clockIn === null || clockOut === null
          ? null
          : Math.round(
              (new Date(clockOut).getTime() - new Date(clockIn).getTime()) /
                MS_PER_MINUTE,
            );
      return {
        date: formatTemporal(row.date, { type: "date", timezone }),
        person: row.userName,
        entry: `${row.shortName ?? text.temporary} ${timeOf(row.startAt, timezone) ?? ""}–${timeOf(row.endAt, timezone) ?? ""}`,
        clockIn: timeOf(clockIn, timezone),
        clockOut: timeOf(clockOut, timezone),
        onDutyHours: numberOrNull(hoursOf(onDuty)),
        breakMinutes: row.breakMinutes,
        workedHours: numberOrNull(hoursOf(row.workedMinutes)),
        scheduledHours: numberOrNull(hoursOf(row.scheduledMinutes)),
        lateMinutes: row.lateMinutes > 0 ? row.lateMinutes : null,
        earlyLeaveMinutes:
          row.earlyLeaveMinutes > 0 ? row.earlyLeaveMinutes : null,
        specialDayCategory:
          row.specialDayCategory ?? row.specialDayName ?? null,
        makeupNote: row.hasMakeup ? text.makeup : null,
      };
    }),
  }));
};

// ---- 排班對話框:未對應排班的打卡區塊(規格 14.5) ----

export interface DayPunch {
  id: string;
  type: string;
  at: string;
}

/**
 * 同一天未對應排班的卡裡的「重複打卡」:上班取最早、下班取最晚,其餘標重複(同 api 的打卡規則)。
 */
export const duplicatePunchIdsOfDay = (
  punches: readonly DayPunch[],
): Set<string> => {
  const duplicates = new Set<string>();
  for (const type of ["in", "out"] as const) {
    const same = punches.filter((punch) => punch.type === type);
    const kept = same.reduce<DayPunch | null>((best, punch) => {
      if (best === null) {
        return punch;
      }
      const time = new Date(punch.at).getTime();
      const bestTime = new Date(best.at).getTime();
      const isBetter = type === "in" ? time < bestTime : time > bestTime;
      return isBetter ? punch : best;
    }, null);
    for (const punch of same) {
      if (punch !== kept) {
        duplicates.add(punch.id);
      }
    }
  }
  return duplicates;
};

/**
 * 預設勾選:排班時間前後 `toleranceMinutes` 內的卡,重複打卡不勾。
 * 排班時間還沒填好(新增時)= 不預設勾。
 */
export const defaultCheckedPunchIds = (
  punches: readonly DayPunch[],
  span: { startAt: string; endAt: string } | null,
  toleranceMinutes: number,
): Set<string> => {
  if (span === null) {
    return new Set();
  }
  const margin = toleranceMinutes * MS_PER_MINUTE;
  const from = new Date(span.startAt).getTime() - margin;
  const to = new Date(span.endAt).getTime() + margin;
  const duplicates = duplicatePunchIdsOfDay(punches);
  return new Set(
    punches
      .filter((punch) => {
        const time = new Date(punch.at).getTime();
        return !duplicates.has(punch.id) && time >= from && time <= to;
      })
      .map((punch) => punch.id),
  );
};

/** 勾了「上下班時間改用打卡時間」:勾選的上班卡中最早的、下班卡中最晚的(沒有那一種 = null)。 */
export const punchSpanOf = (
  punches: readonly DayPunch[],
  checked: ReadonlySet<string>,
): { startAt: string | null; endAt: string | null } => {
  const chosen = punches.filter((punch) => checked.has(punch.id));
  const pick = (type: string, earliest: boolean): string | null => {
    const times = chosen
      .filter((punch) => punch.type === type)
      .map((punch) => new Date(punch.at).getTime());
    if (times.length === 0) {
      return null;
    }
    return new Date(
      earliest ? Math.min(...times) : Math.max(...times),
    ).toISOString();
  };
  return { startAt: pick("in", true), endAt: pick("out", false) };
};

/** 某家店每一天未對應排班的卡張數(月檢視的 ⏲)。 */
export const unmatchedCountsByDate = (
  punches: readonly { date: string }[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const punch of punches) {
    counts.set(punch.date, (counts.get(punch.date) ?? 0) + 1);
  }
  return counts;
};

/** 某人某天未對應排班的卡(依時間)。 */
export const unmatchedOfPersonDay = <
  Punch extends DayPunch & { userId: string; date: string },
>(
  punches: readonly Punch[],
  userId: string,
  date: string,
): Punch[] =>
  punches
    .filter((punch) => punch.userId === userId && punch.date === date)
    .toSorted(
      (left, right) =>
        new Date(left.at).getTime() - new Date(right.at).getTime(),
    );
