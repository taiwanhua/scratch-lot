import type { ScheduleCheckQuery } from "@repo/graphql";

/**
 * 排班檢核的夾具(SC-18 / SC-15c / SC-15d;元件測試與 mock 模式共用):依查的月份產生,
 * 和排班表夾具(`schedule-roster-fixtures.ts`)同一批人與人力需求。時間一律台北時區(+08:00)。
 *
 * - `limits`:1 項限制(本月畫休超過上限)+ 提醒(Figma SC-18 的樣子)
 * - `reminders`:只有提醒
 * - `clear`:全部符合
 */
export type CheckScenario = "limits" | "reminders" | "clear";

type CheckItem = ScheduleCheckQuery["scheduleCheck"]["items"][number];

const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const item = (overrides: Partial<CheckItem> & Pick<CheckItem, "key">) =>
  ({
    level: "reminder",
    message: "",
    userId: null,
    userName: null,
    date: "",
    entryIds: [],
    actual: null,
    limit: null,
    from: null,
    to: null,
    startAt: null,
    endAt: null,
    isOtherStore: false,
    orgName: null,
    understaffed: null,
    ...overrides,
  }) satisfies CheckItem;

const reminderItems = (month: string): CheckItem[] => {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  return [
    item({
      key: "understaffed",
      date: at(day(1), "00:00"),
      startAt: at(day(1), "14:30"),
      endAt: at(day(1), "22:00"),
      understaffed: {
        demandId: "d-late-1",
        role: "helper",
        missing: 1,
        available: 1,
        dayOff: 1,
        timeRange: 0,
        occupied: 3,
        cannotLead: 0,
      },
    }),
    item({
      key: "understaffed",
      date: at(day(4), "00:00"),
      startAt: at(day(4), "08:30"),
      endAt: at(day(4), "14:30"),
      understaffed: {
        demandId: "d-early-4",
        role: "helper",
        missing: 1,
        available: 0,
        dayOff: 2,
        timeRange: 1,
        occupied: 2,
        cannotLead: 0,
      },
    }),
    item({
      key: "maxConsecutiveWorkDays",
      userId: "u-chen",
      userName: "陳大文",
      date: at(day(6), "00:00"),
      actual: 7,
      limit: 6,
      from: at(day(6), "00:00"),
      to: at(day(12), "00:00"),
    }),
    item({
      key: "minRestBetweenShifts",
      userId: "u-li",
      userName: "李小華",
      date: at(day(4), "00:00"),
      actual: 10.5,
      limit: 11,
      from: at(day(4), "00:00"),
      to: at(day(5), "00:00"),
      startAt: at(day(4), "22:00"),
      endAt: at(day(5), "08:30"),
    }),
    item({
      key: "maxDailyWorkHours",
      userId: "u-chang",
      userName: "張小芳",
      date: at(day(7), "00:00"),
      actual: 10.5,
      limit: 8,
      from: at(day(7), "00:00"),
      to: at(day(7), "00:00"),
    }),
    item({
      key: "dayOffEntryConflict",
      userId: "u-chen",
      userName: "陳大文",
      date: at(day(6), "00:00"),
      startAt: at(day(6), "14:00"),
      endAt: at(day(6), "22:00"),
      isOtherStore: true,
      orgName: null,
    }),
  ];
};

export const sampleCheck = (
  month: string,
  scenario: CheckScenario,
): ScheduleCheckQuery["scheduleCheck"] => {
  const limits =
    scenario === "limits"
      ? [
          item({
            key: "maxMonthlyDayOffs",
            level: "limit",
            userId: "u-lin",
            userName: "林美麗",
            date: at(`${month}-01`, "00:00"),
            actual: 5,
            limit: 4,
          }),
        ]
      : [];
  const reminders = scenario === "clear" ? [] : reminderItems(month);
  return {
    orgId: "",
    month,
    limitCount: limits.length,
    reminderCount: reminders.length,
    items: [...limits, ...reminders],
  };
};
