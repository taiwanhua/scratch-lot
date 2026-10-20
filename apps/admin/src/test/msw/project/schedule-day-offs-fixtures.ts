import type {
  ScheduleDayOffFieldsFragment,
  ScheduleDayOffViolationFieldsFragment,
} from "@repo/graphql";

/** 畫休夾具的目標月(開放期間 11/15–11/25 登記 12 月)。 */
export const DAY_OFF_MONTH = "2026-12";

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
];

const dayOff = (
  id: string,
  person: { userId: string; name: string; isPrimary: boolean },
  date: string,
  range: [string, string] | null = null,
): ScheduleDayOffFieldsFragment => ({
  id,
  userId: person.userId,
  name: person.name,
  date,
  kind: range === null ? "full-day" : "time-range",
  startTime: range?.[0] ?? null,
  endTime: range?.[1] ?? null,
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
    dates: ["2026-12-24"],
    actual: 3,
    limit: 2,
    from: "2026-12-24",
    to: "2026-12-24",
  },
  {
    key: "maxConsecutiveDaysOff",
    level: "reminder",
    message: "12/13–12/16 連續休 4 天,最多 3 天",
    dates: ["2026-12-13", "2026-12-14", "2026-12-15", "2026-12-16"],
    actual: 4,
    limit: 3,
    from: "2026-12-13",
    to: "2026-12-16",
  },
];
