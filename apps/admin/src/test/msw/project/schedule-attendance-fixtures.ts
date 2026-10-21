import type {
  ScheduleAttendancePunchFieldsFragment,
  ScheduleAttendanceRowFieldsFragment,
} from "@repo/graphql";

import { SCHEDULE_BRANCH } from "./schedule-settings-fixtures";

/**
 * 出勤紀錄(規格 14.7、14.8)的夾具:依分店(日)照 Figma SC-12(王小明已到、李小華遲到 11 分、
 * 林美麗已到、陳大文未到;張小芳兩張未對應排班的卡)、依人員(月)照 SC-11(王小明 11 月)。
 * 補打卡申請的夾具在 `schedule-makeup-punch-fixtures.ts`。時間一律台北時區。
 */
export const ATTENDANCE_ORG = SCHEDULE_BRANCH;
export const MAKEUP_PUNCH_FORM_KEY = "makeup_punch";
export const ATTENDANCE_MODULE_KEY = "schedule.attendance";

const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const minutesBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

export const attendancePunch = (
  overrides: Partial<ScheduleAttendancePunchFieldsFragment> & {
    id: string;
    at: string;
  },
): ScheduleAttendancePunchFieldsFragment => ({
  userId: "u-wang",
  userName: "王小明",
  orgId: ATTENDANCE_ORG.id,
  orgName: ATTENDANCE_ORG.name,
  type: "in",
  entryId: null,
  source: "button",
  duplicate: false,
  ...overrides,
});

interface RowInput {
  entryId: string;
  userId: string;
  userName: string;
  date: string;
  shortName: string | null;
  start: string;
  end: string;
  clockIn?: string;
  clockOut?: string;
  status: "arrived" | "absent" | "upcoming";
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  missing?: string[];
  specialDayName?: string;
  hasMakeup?: boolean;
}

export const attendanceRow = (
  input: RowInput,
): ScheduleAttendanceRowFieldsFragment => {
  const startAt = at(input.date, input.start);
  const endAt = at(input.date, input.end);
  const clockIn =
    input.clockIn === undefined ? null : at(input.date, input.clockIn);
  const clockOut =
    input.clockOut === undefined ? null : at(input.date, input.clockOut);
  const breakMinutes = 30;
  return {
    entryId: input.entryId,
    userId: input.userId,
    userName: input.userName,
    orgId: ATTENDANCE_ORG.id,
    orgName: ATTENDANCE_ORG.name,
    date: input.date,
    startAt,
    endAt,
    breakMinutes,
    shortName: input.shortName,
    clockIn,
    clockOut,
    status: input.status,
    lateMinutes: input.lateMinutes ?? 0,
    earlyLeaveMinutes: input.earlyLeaveMinutes ?? 0,
    workedMinutes:
      clockIn === null || clockOut === null
        ? null
        : minutesBetween(clockIn, clockOut) - breakMinutes,
    scheduledMinutes: minutesBetween(startAt, endAt) - breakMinutes,
    missing: input.missing ?? [],
    specialDayName: input.specialDayName ?? null,
    specialDayCategory: null,
    hasMakeup: input.hasMakeup ?? false,
    punches: [
      ...(clockIn === null
        ? []
        : [
            attendancePunch({
              id: `${input.entryId}-in`,
              userId: input.userId,
              userName: input.userName,
              at: clockIn,
              type: "in",
              entryId: input.entryId,
            }),
          ]),
      ...(clockOut === null
        ? []
        : [
            attendancePunch({
              id: `${input.entryId}-out`,
              userId: input.userId,
              userName: input.userName,
              at: clockOut,
              type: "out",
              entryId: input.entryId,
            }),
          ]),
    ],
  };
};

/** 依分店(日)那一天的班(SC-12)。 */
export const storeDayRows = (
  date: string,
): ScheduleAttendanceRowFieldsFragment[] => [
  attendanceRow({
    entryId: `e-wang-${date}`,
    userId: "u-wang",
    userName: "王小明",
    date,
    shortName: "晚",
    start: "14:30",
    end: "22:00",
    clockIn: "14:22",
    status: "arrived",
  }),
  attendanceRow({
    entryId: `e-li-${date}`,
    userId: "u-li",
    userName: "李小華",
    date,
    shortName: "早",
    start: "08:30",
    end: "14:30",
    clockIn: "08:41",
    clockOut: "14:33",
    status: "arrived",
    lateMinutes: 11,
  }),
  attendanceRow({
    entryId: `e-lin-${date}`,
    userId: "u-lin",
    userName: "林美麗",
    date,
    shortName: "早",
    start: "08:30",
    end: "14:30",
    clockIn: "08:27",
    clockOut: "14:31",
    status: "arrived",
  }),
  attendanceRow({
    entryId: `e-chen-${date}`,
    userId: "u-chen",
    userName: "陳大文",
    date,
    shortName: "晚",
    start: "14:30",
    end: "22:00",
    status: "absent",
    missing: ["in", "out"],
  }),
];

/** 依分店(日)那一天未對應排班的卡:張小芳 09:02 上班、15:10 下班。 */
export const storeDayUnmatched = (
  date: string,
): ScheduleAttendancePunchFieldsFragment[] => [
  attendancePunch({
    id: `p-chang-in-${date}`,
    userId: "u-chang",
    userName: "張小芳",
    at: at(date, "09:02"),
    type: "in",
  }),
  attendancePunch({
    id: `p-chang-out-${date}`,
    userId: "u-chang",
    userName: "張小芳",
    at: at(date, "15:10"),
    type: "out",
  }),
];

/** 依人員(月):王小明那個月的班(SC-11)。 */
export const personMonthRows = (
  month: string,
): ScheduleAttendanceRowFieldsFragment[] => {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  return [
    attendanceRow({
      entryId: `e-wang-${day(2)}`,
      userId: "u-wang",
      userName: "王小明",
      date: day(2),
      shortName: "早",
      start: "08:30",
      end: "14:30",
      clockIn: "08:25",
      status: "arrived",
      missing: ["out"],
    }),
    attendanceRow({
      entryId: `e-wang-${day(3)}`,
      userId: "u-wang",
      userName: "王小明",
      date: day(3),
      shortName: "早",
      start: "08:30",
      end: "14:30",
      clockIn: "08:28",
      clockOut: "14:35",
      status: "arrived",
    }),
    attendanceRow({
      entryId: `e-wang-${day(5)}`,
      userId: "u-wang",
      userName: "王小明",
      date: day(5),
      shortName: "早",
      start: "08:30",
      end: "14:30",
      clockIn: "08:41",
      clockOut: "14:32",
      status: "arrived",
      lateMinutes: 11,
    }),
    attendanceRow({
      entryId: `e-wang-${day(11)}`,
      userId: "u-wang",
      userName: "王小明",
      date: day(11),
      shortName: "早",
      start: "08:30",
      end: "14:30",
      clockIn: "08:30",
      clockOut: "14:30",
      status: "arrived",
      specialDayName: "店慶",
      hasMakeup: true,
    }),
  ];
};

export const ATTENDANCE_PEOPLE = [
  { userId: "u-wang", name: "王小明" },
  { userId: "u-li", name: "李小華" },
  { userId: "u-lin", name: "林美麗" },
  { userId: "u-chen", name: "陳大文" },
  { userId: "u-chang", name: "張小芳" },
];
