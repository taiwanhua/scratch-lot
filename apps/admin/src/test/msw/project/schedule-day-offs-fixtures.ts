import type {
  ScheduleDayOffFieldsFragment,
  ScheduleDayOffViolationFieldsFragment,
} from "@repo/graphql";

/** 畫休夾具的目標月(開放期間 11/15–11/25 登記 12 月)。 */
export const DAY_OFF_MONTH = "2026-12";

/** 夾具的時區(租戶時區 = 預設的台北)。 */
export const DAY_OFF_TIMEZONE = "Asia/Taipei";

/** 台北那天某時刻的時點(api 收發的 ISO);日期 = 那天 00:00。 */
export const taipeiAt = (date: string, time = "00:00") =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

/** 當前使用者(登入者;主要分店 = A-2 台北分店)。 */
export const DAY_OFF_ME = {
  userId: "u-me",
  name: "何家華",
  isPrimary: true,
};

/** 可以排這家店的排班人員(林新人的主要分店是別家店:同日人數不算他)。 */
export const DAY_OFF_STAFF = [
  DAY_OFF_ME,
  { userId: "u-wang", name: "王小明", isPrimary: true },
  { userId: "u-li", name: "李小華", isPrimary: true },
  { userId: "u-chen", name: "陳大文", isPrimary: true },
  { userId: "u-lin", name: "林美麗", isPrimary: true },
  { userId: "u-zhang", name: "張小芳", isPrimary: true },
  { userId: "u-new", name: "林新人", isPrimary: false },
  // 支援人員、這個月還沒畫休:「尚未畫休」不算他
  { userId: "u-support", name: "趙支援", isPrimary: false },
];

/** 一筆畫休夾具(`range` = 時段不可排的 `HH:mm` 起迄;不給 = 整天畫休)。 */
export const dayOff = (
  id: string,
  person: { userId: string; name: string; isPrimary: boolean },
  date: string,
  range: [string, string] | null = null,
): ScheduleDayOffFieldsFragment => ({
  id,
  userId: person.userId,
  name: person.name,
  date: taipeiAt(date),
  kind: range === null ? "full-day" : "time-range",
  startAt: range === null ? null : taipeiAt(date, range[0]),
  endAt: range === null ? null : taipeiAt(date, range[1]),
  note: null,
  isPrimary: person.isPrimary,
  byName: null,
  reason: null,
  reasonNote: null,
});

const [me, wang, li, chen, lin, , newcomer] = DAY_OFF_STAFF as [
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
  (typeof DAY_OFF_STAFF)[number],
];

/** 與 Figma SC-02 / SC-06 同一組情境(12 月):我畫了 7、14、21 號與 10 號早上;24 號 2/2 已滿。 */
export const sampleDayOffs: ScheduleDayOffFieldsFragment[] = [
  dayOff("d-me-7", me, "2026-12-07"),
  dayOff("d-me-10", me, "2026-12-10", ["09:00", "13:00"]),
  dayOff("d-me-14", me, "2026-12-14"),
  dayOff("d-me-21", me, "2026-12-21"),
  dayOff("d-lin-21", lin, "2026-12-21"),
  dayOff("d-li-12", li, "2026-12-12"),
  dayOff("d-chen-12", chen, "2026-12-12"),
  dayOff("d-li-24", li, "2026-12-24"),
  dayOff("d-chen-24", chen, "2026-12-24"),
  dayOff("d-wang-24", wang, "2026-12-24", ["18:00", "22:00"]),
  dayOff("d-new-24", newcomer, "2026-12-24"),
];

export const sampleDayOffViolations: ScheduleDayOffViolationFieldsFragment[] = [
  {
    key: "maxDailyDayOffStaff",
    level: "limit",
    message: "12/24 畫休 3 人,同日最多 2 人",
    dates: [taipeiAt("2026-12-24")],
    actual: 3,
    limit: 2,
    // 期間是半開區間 `[起那天 00:00, 迄那天的隔天 00:00)`
    from: taipeiAt("2026-12-24"),
    to: taipeiAt("2026-12-25"),
  },
  {
    key: "maxConsecutiveDaysOff",
    level: "reminder",
    message: "12/13–12/16 連續休 4 天,最多 3 天",
    dates: ["2026-12-13", "2026-12-14", "2026-12-15", "2026-12-16"].map(
      (date) => taipeiAt(date),
    ),
    actual: 4,
    limit: 3,
    from: taipeiAt("2026-12-13"),
    to: taipeiAt("2026-12-17"),
  },
];
