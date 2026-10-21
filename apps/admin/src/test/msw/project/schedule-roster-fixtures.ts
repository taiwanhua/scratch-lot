import type {
  ScheduleDemandFieldsFragment,
  ScheduleEntryFieldsFragment,
  ScheduleRosterQuery,
} from "@repo/graphql";

export { SCHEDULE_BRANCH as ROSTER_ORG } from "./schedule-settings-fixtures";

/**
 * 排班表(班表檢視)的夾具:元件測試與 mock 模式共用。依查的月份產生(那個月的 1–7 日),
 * mock 模式打開「這個月」也看得到資料。時間一律台北時區(+08:00)。
 */

type Roster = ScheduleRosterQuery["scheduleRoster"];
type Person = Roster["people"][number];

export interface TestRosterEntry extends Omit<
  ScheduleEntryFieldsFragment,
  "assignments"
> {
  assignments: {
    demandId: string;
    taskId: string;
    source: string;
    reason?: string | null;
  }[];
}

export type TestRosterDemand = Omit<ScheduleDemandFieldsFragment, "tasks"> & {
  tasks: { taskId: string; role: string; taskKey: string }[];
};

/** 夾具人力需求的建立時間(同一時間開始時,時間軸依崗位 → 範本 → 建立時間 → id 排)。 */
const CREATED_AT = "2026-10-01T00:00:00.000Z";

const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

export const ROSTER_TEMPLATES: Roster["templates"] = [
  {
    id: "tpl-early",
    name: "早班",
    shortName: "早",
    startTime: "08:30",
    endTime: "14:30",
    positionKey: "in-store-counter",
    paletteKey: "yellow",
    tasks: [
      { taskId: "t1", role: "leader", taskKey: "store-and-accounts-lead" },
      { taskId: "t2", role: "helper", taskKey: "store-duties" },
    ],
  },
  {
    id: "tpl-restock",
    name: "補貨",
    shortName: "補",
    startTime: "13:00",
    endTime: "17:00",
    positionKey: "restock",
    paletteKey: "green",
    tasks: [{ taskId: "t1", role: "helper", taskKey: "store-duties" }],
  },
  {
    id: "tpl-late",
    name: "晚班",
    shortName: "晚",
    startTime: "14:30",
    endTime: "22:00",
    positionKey: "in-store-counter",
    paletteKey: "blue",
    tasks: [
      { taskId: "t1", role: "leader", taskKey: "store-and-accounts-lead" },
      { taskId: "t2", role: "helper", taskKey: "store-duties" },
    ],
  },
];

const stats = (overrides: Partial<Person["stats"]> = {}): Person["stats"] => ({
  shiftCount: 0,
  leadShiftCount: 0,
  workMinutes: 0,
  dayOffDays: 0,
  fullDayOffDays: 0,
  timeRangeDays: [],
  longestStreak: 0,
  ...overrides,
});

export const ROSTER_PEOPLE: Person[] = [
  {
    userId: "u-wang",
    name: "王小明",
    employmentType: "full-time",
    canLead: true,
    isPrimary: true,
    isCandidate: true,
    stats: stats({
      shiftCount: 20,
      leadShiftCount: 12,
      workMinutes: 7740,
      dayOffDays: 2,
      fullDayOffDays: 1,
      timeRangeDays: [
        {
          date: "2026-11-05",
          slots: [{ startTime: "09:00", endTime: "13:00" }],
        },
      ],
      longestStreak: 5,
    }),
  },
  {
    userId: "u-li",
    name: "李小華",
    employmentType: "full-time",
    canLead: true,
    isPrimary: true,
    isCandidate: true,
    stats: stats({ shiftCount: 19, leadShiftCount: 4, workMinutes: 7200 }),
  },
  {
    userId: "u-chen",
    name: "陳大文",
    employmentType: "full-time",
    canLead: true,
    isPrimary: true,
    isCandidate: true,
    stats: stats({ shiftCount: 19, leadShiftCount: 10, workMinutes: 9150 }),
  },
  {
    userId: "u-lin",
    name: "林美麗",
    employmentType: "full-time",
    canLead: false,
    isPrimary: true,
    isCandidate: true,
    stats: stats({
      shiftCount: 17,
      leadShiftCount: 0,
      workMinutes: 6630,
      dayOffDays: 9,
      fullDayOffDays: 9,
    }),
  },
  {
    userId: "u-chang",
    name: "張小芳",
    employmentType: "part-time",
    canLead: false,
    isPrimary: true,
    isCandidate: true,
    stats: stats({ shiftCount: 11, workMinutes: 2880 }),
  },
];

/** 某月 1–7 日的人力需求(早班、晚班每天;補貨 1、2、5 日;4 日一筆臨時)與排班。 */
export const sampleRoster = (
  month: string,
): { demands: TestRosterDemand[]; entries: TestRosterEntry[] } => {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  const demands: TestRosterDemand[] = [];
  const entries: TestRosterEntry[] = [];
  const addDemand = (
    id: string,
    date: string,
    templateId: string | null,
    start: string,
    end: string,
    tasks: { role: string; taskKey: string }[],
    positionKey = "in-store-counter",
  ) => {
    demands.push({
      id,
      date,
      startAt: at(date, start),
      endAt: at(date, end),
      positionKey,
      positionNote: null,
      templateId,
      source: templateId === null ? "manual" : "template",
      createdAt: CREATED_AT,
      tasks: tasks.map((task, index) => ({
        taskId: `${id}-t${String(index + 1)}`,
        ...task,
      })),
    });
  };
  const lead = { role: "leader", taskKey: "store-and-accounts-lead" };
  const help = { role: "helper", taskKey: "store-duties" };
  for (const n of [1, 2, 4, 5, 6, 7]) {
    addDemand(`d-early-${String(n)}`, day(n), "tpl-early", "08:30", "14:30", [
      lead,
      help,
    ]);
    addDemand(`d-late-${String(n)}`, day(n), "tpl-late", "14:30", "22:00", [
      lead,
      help,
    ]);
  }
  for (const n of [1, 2, 5]) {
    addDemand(
      `d-restock-${String(n)}`,
      day(n),
      "tpl-restock",
      "13:00",
      "17:00",
      [help],
      "restock",
    );
  }
  addDemand("d-temp-4", day(4), null, "13:00", "17:00", [help]);
  // 7 日:補貨 + 臨時加開(缺負責),張小芳一筆排班 13:00–18:00 同時填進兩筆(×2、延伸出補貨)
  addDemand(
    "d-restock-7",
    day(7),
    "tpl-restock",
    "13:00",
    "17:00",
    [help],
    "restock",
  );
  addDemand("d-temp-7", day(7), null, "15:00", "18:00", [lead, help]);

  const addEntry = (
    userId: string,
    n: number,
    start: string,
    end: string,
    breakMinutes: number,
    assignments: {
      demandId: string;
      taskId: string;
      source?: string;
      reason?: string;
    }[],
  ) => {
    entries.push({
      id: `e-${userId}-${String(n)}-${start}`,
      userId,
      date: day(n),
      startAt: at(day(n), start),
      endAt: at(day(n), end),
      breakMinutes,
      deletable: true,
      assignments: assignments.map((item) => ({
        source: "manual",
        ...item,
      })),
    });
  };
  for (const n of [1, 2, 4, 6, 7]) {
    addEntry("u-wang", n, "08:30", "14:30", 30, [
      { demandId: `d-early-${String(n)}`, taskId: `d-early-${String(n)}-t1` },
    ]);
    addEntry("u-li", n, "14:30", "22:00", 30, [
      { demandId: `d-late-${String(n)}`, taskId: `d-late-${String(n)}-t1` },
    ]);
  }
  addEntry("u-chen", 5, "14:30", "22:00", 30, [
    {
      demandId: "d-late-5",
      taskId: "d-late-5-t1",
      source: "auto",
      reason: "負責人次數較多",
    },
  ]);
  addEntry("u-lin", 2, "08:30", "14:30", 30, [
    { demandId: "d-early-2", taskId: "d-early-2-t2" },
  ]);
  addEntry("u-chang", 1, "13:00", "17:00", 0, [
    { demandId: "d-restock-1", taskId: "d-restock-1-t1" },
  ]);
  addEntry("u-chang", 4, "13:00", "17:00", 0, [
    { demandId: "d-temp-4", taskId: "d-temp-4-t1" },
  ]);
  addEntry("u-chang", 7, "13:00", "18:00", 30, [
    { demandId: "d-restock-7", taskId: "d-restock-7-t1" },
    { demandId: "d-temp-7", taskId: "d-temp-7-t2" },
  ]);
  return { demands, entries };
};

/** 某月的不可排、別家店的班、行事曆(3 日店休)。 */
export const sampleRosterExtras = (
  month: string,
): Pick<Roster, "unavailability" | "otherStoreEntries" | "calendarDays"> => {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  return {
    unavailability: [
      { userId: "u-wang", date: day(5), fullDay: true, slots: [] },
      {
        userId: "u-chang",
        date: day(6),
        fullDay: false,
        slots: [{ startTime: "09:00", endTime: "13:00" }],
      },
    ],
    otherStoreEntries: [
      {
        userId: "u-chen",
        date: day(2),
        startAt: at(day(2), "14:00"),
        endAt: at(day(2), "22:00"),
        orgName: null,
      },
    ],
    calendarDays: [
      { date: day(3), type: "closed", name: null, paletteKey: null },
    ],
  };
};

export const ROSTER_SETTINGS: Roster["settings"] = {
  breakTiers: [
    { minMinutes: 240, breakMinutes: 30 },
    { minMinutes: 480, breakMinutes: 60 },
  ],
  defaultLeaderTaskKey: "store-and-accounts-lead",
  defaultHelperTaskKey: "store-duties",
  maxMonthlyDayOffs: 8,
  minMonthlyDayOffs: 4,
  entryMatchToleranceMinutes: 60,
};

const unmatchedPunch = (
  id: string,
  userId: string,
  date: string,
  time: string,
  type: "in" | "out",
) => ({ id, userId, date, type, at: at(date, time) });

/**
 * 某月未對應排班的打卡(SC-04d / SC-04e ①):王小明 4 日有班(08:30–14:30)、打了 3 張未對應的卡
 * (08:31 是重複打卡);林美麗 1 日沒有班、打了上下班兩張(臨時代班)。
 */
export const sampleUnmatchedPunches = (
  month: string,
): Roster["unmatchedPunches"] => {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  return [
    unmatchedPunch("p-wang-1", "u-wang", day(4), "08:27", "in"),
    unmatchedPunch("p-wang-2", "u-wang", day(4), "08:31", "in"),
    unmatchedPunch("p-wang-3", "u-wang", day(4), "14:36", "out"),
    unmatchedPunch("p-lin-1", "u-lin", day(1), "09:02", "in"),
    unmatchedPunch("p-lin-2", "u-lin", day(1), "15:10", "out"),
  ];
};
