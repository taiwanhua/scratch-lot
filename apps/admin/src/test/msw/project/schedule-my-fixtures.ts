import type {
  MyScheduleEntryFieldsFragment,
  MyScheduleQuery,
} from "@repo/graphql";

import { SCHEDULE_BRANCH } from "./schedule-settings-fixtures";

/**
 * 我的班表 → 班表分頁的夾具(SC-01 的示範資料):今天 2026-11-05(四)、當前組織 A-2 台北分店;
 * 11/2 缺下班卡、11/4 晚班還沒打下班卡(昨天的卡片 + 打卡不完整)、11/5 今天早班負責;
 * 11/3 店休、11/11 特殊日、11/6 / 11/22 整天畫休;11/8、11/12 有異動;11/10 在 B 分店支援。
 */
export const MY_TODAY = "2026-11-05";
export const MY_MONTH = "2026-11";
export const MY_SUPPORT_ORG = { id: "org-content", name: "B 分店" };

const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const MORNING = ["08:30", "14:30"] as const;
const EVENING = ["14:30", "22:00"] as const;

interface EntrySeed {
  date: string;
  span: readonly [string, string];
  lead?: boolean;
  shortName?: string | null;
  clock?: readonly [string | null, string | null];
  missing?: string[];
  org?: { id: string; name: string };
}

const entryOf = (seed: EntrySeed): MyScheduleEntryFieldsFragment => {
  const lead = seed.lead ?? false;
  const org = seed.org ?? SCHEDULE_BRANCH;
  const [start, end] = seed.span;
  const defaultShort = start === MORNING[0] ? "早" : "晚";
  return {
    id: `my-entry-${seed.date}`,
    orgId: org.id,
    orgName: org.name,
    date: seed.date,
    startAt: at(seed.date, start),
    endAt: at(seed.date, end),
    breakMinutes: 30,
    shortName: seed.shortName === undefined ? defaultShort : seed.shortName,
    isLead: lead,
    positionKey: "in-store-counter",
    tasks: [
      {
        role: lead ? "leader" : "helper",
        taskKey: lead ? "store-and-accounts-lead" : "store-duties",
        positionKey: "in-store-counter",
      },
    ],
    clockIn:
      seed.clock?.[0] === null || seed.clock === undefined
        ? null
        : at(seed.date, seed.clock[0]),
    clockOut:
      seed.clock?.[1] === null || seed.clock === undefined
        ? null
        : at(seed.date, seed.clock[1]),
    missing: seed.missing ?? [],
  };
};

export const myEntries = (): MyScheduleEntryFieldsFragment[] =>
  [
    {
      date: "2026-11-01",
      span: MORNING,
      lead: true,
      clock: ["08:24", "14:36"],
    },
    {
      date: "2026-11-02",
      span: ["08:00", "14:30"],
      lead: true,
      shortName: "早",
      clock: ["07:56", null],
      missing: ["out"],
    },
    {
      date: "2026-11-04",
      span: EVENING,
      lead: true,
      clock: ["14:24", null],
      missing: ["out"],
    },
    { date: "2026-11-05", span: MORNING, lead: true },
    { date: "2026-11-07", span: MORNING, lead: true },
    { date: "2026-11-08", span: MORNING, lead: true },
    { date: "2026-11-09", span: EVENING, lead: true },
    { date: "2026-11-10", span: MORNING, org: MY_SUPPORT_ORG },
    { date: "2026-11-11", span: MORNING, lead: true },
    { date: "2026-11-12", span: EVENING, lead: true, shortName: null },
    { date: "2026-11-13", span: EVENING },
    { date: "2026-11-14", span: EVENING },
    { date: "2026-11-16", span: MORNING, lead: true },
    { date: "2026-11-17", span: MORNING },
    { date: "2026-11-18", span: EVENING },
    { date: "2026-11-19", span: MORNING, lead: true },
    { date: "2026-11-21", span: EVENING },
    { date: "2026-11-24", span: EVENING },
    { date: "2026-11-26", span: MORNING },
    { date: "2026-11-30", span: MORNING, lead: true },
  ].map((seed) => entryOf(seed as EntrySeed));

export const myChanges = (): MyScheduleQuery["mySchedule"]["changes"] => [
  {
    id: "change-1108",
    date: "2026-11-08",
    action: "entry.edit",
    orgName: SCHEDULE_BRANCH.name,
    beforeStartAt: at("2026-11-08", EVENING[0]),
    beforeEndAt: at("2026-11-08", EVENING[1]),
    afterStartAt: at("2026-11-08", MORNING[0]),
    afterEndAt: at("2026-11-08", MORNING[1]),
    reason: "換班",
    reasonNote: null,
    createdAt: at("2026-11-04", "18:00"),
  },
  {
    id: "change-1112",
    date: "2026-11-12",
    action: "entry.create",
    orgName: SCHEDULE_BRANCH.name,
    beforeStartAt: null,
    beforeEndAt: null,
    afterStartAt: at("2026-11-12", EVENING[0]),
    afterEndAt: at("2026-11-12", EVENING[1]),
    reason: "其他",
    reasonNote: "臨時請假 · 補人",
    createdAt: at("2026-11-03", "10:00"),
  },
];

export const myCalendarDays =
  (): MyScheduleQuery["mySchedule"]["calendarDays"] => [
    { date: "2026-11-03", type: "closed", name: null, paletteKey: null },
    { date: "2026-11-11", type: "special", name: "店慶", paletteKey: "cyan" },
  ];

export const MY_DAY_OFF_DATES = ["2026-11-06", "2026-11-22"];
