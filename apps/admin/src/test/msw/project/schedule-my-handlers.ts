import { HttpResponse } from "msw";

import type {
  MyScheduleEntryFieldsFragment,
  MySchedulePunchFieldsFragment,
  MyScheduleQuery,
  MyScheduleQueryVariables,
  PunchMyScheduleMutationVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  MY_DAY_OFF_DATES,
  MY_MONTH,
  MY_TODAY,
  myCalendarDays,
  myChanges,
  myEntries,
} from "./schedule-my-fixtures";
import { SCHEDULE_BRANCH } from "./schedule-settings-fixtures";

export interface ScheduleMyWorldOptions {
  /** 有 `schedule.my.punch`(預設有) */
  canPunch?: boolean;
  /** 這個月的班(預設 SC-01 的示範資料) */
  entries?: MyScheduleEntryFieldsFragment[];
  changes?: MyScheduleQuery["mySchedule"]["changes"];
  /** 這個月的店休 / 特殊日(預設 11/3 店休、11/11 店慶(青)) */
  calendarDays?: MyScheduleQuery["mySchedule"]["calendarDays"];
}

/** 台北某天 00:00 的時點(api 的日期)。 */
const dayAt = (date: string): string =>
  new Date(`${date}T00:00:00+08:00`).toISOString();

/** 時點 → 台北的月份鍵。 */
const taipeiMonth = (iso: string): string =>
  new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);

/**
 * 夾具以台北的日期鍵寫(好讀、測試好覆寫);回給畫面前換成 api 的形狀:日期 = 那天台北 00:00 的時點。
 */
const toApi = (
  page: MyScheduleQuery["mySchedule"],
): MyScheduleQuery["mySchedule"] => {
  const keyed = <T extends { date: string }>(item: T): T => ({
    ...item,
    date: dayAt(item.date),
  });
  return {
    ...page,
    today: dayAt(page.today),
    entries: page.entries.map((item) => keyed(item)),
    punchCards: page.punchCards.map((card) => ({
      ...card,
      entry: keyed(card.entry),
    })),
    incomplete: page.incomplete.map((item) => keyed(item)),
    changes: page.changes.map((item) => keyed(item)),
    calendarDays: page.calendarDays.map((item) => keyed(item)),
    dayOffDates: page.dayOffDates.map((item) => dayAt(item)),
  };
};

/** 假的打卡時間:今天 10:00(租戶時區)。 */
const PUNCH_AT = new Date(`${MY_TODAY}T10:00:00+08:00`).toISOString();
const YESTERDAY = "2026-11-04";

/**
 * 我的班表 → 班表分頁的假 api(有狀態):今天 2026-11-05,只有 2026-11 有班(其他月份 = 未發布 / 沒有班)。
 * 打卡寫回那一班的打卡紀錄(上班取最早、下班取最晚);沒有排班的卡記在當前組織。
 */
export const scheduleMyWorld = (options: ScheduleMyWorldOptions = {}) => {
  const { canPunch = true } = options;
  let entries = options.entries ?? myEntries();
  const changes = options.changes ?? myChanges();
  let openUnmatched: MySchedulePunchFieldsFragment | null = null;
  let sequence = 0;
  const punches: PunchMyScheduleMutationVariables["input"][] = [];

  const payload = (month: string): MyScheduleQuery["mySchedule"] => {
    const inMonth = month === MY_MONTH ? entries : [];
    const today = entries.filter((entry) => entry.date === MY_TODAY);
    const yesterday = entries.filter(
      (entry) =>
        entry.date === YESTERDAY &&
        (entry.clockOut === null || entry.clockOut === undefined),
    );
    return {
      month,
      today: MY_TODAY,
      canPunch,
      currentOrg: { id: SCHEDULE_BRANCH.id, name: SCHEDULE_BRANCH.name },
      entries: inMonth,
      punchCards: [
        ...today.map((entry) => ({ day: "today", entry })),
        ...yesterday.map((entry) => ({ day: "yesterday", entry })),
      ],
      hasEntryToday: today.length > 0,
      openUnmatchedClockIn: openUnmatched,
      incomplete: entries.filter((entry) => entry.missing.length > 0),
      changes,
      calendarDays:
        month === MY_MONTH ? (options.calendarDays ?? myCalendarDays()) : [],
      dayOffDates: month === MY_MONTH ? MY_DAY_OFF_DATES : [],
    };
  };

  const handlers = [
    api.query("MySchedule", ({ variables }) => {
      const { input } = variables as MyScheduleQueryVariables;
      // 月份查詢是那個月的 `[月初 00:00, 下月初 00:00)`;沒給 = 今天所在的月份
      const month =
        typeof input?.from === "string" ? taipeiMonth(input.from) : MY_MONTH;
      return HttpResponse.json({
        data: { mySchedule: toApi(payload(month)) },
      });
    }),
    api.mutation("PunchMySchedule", ({ variables }) => {
      const { input } = variables as PunchMyScheduleMutationVariables;
      punches.push(input);
      sequence += 1;
      const entryId = input.entryId ?? null;
      const punch: MySchedulePunchFieldsFragment = {
        id: `my-punch-${String(sequence)}`,
        type: input.type,
        at: PUNCH_AT,
        entryId,
        orgId: SCHEDULE_BRANCH.id,
        duplicate: false,
      };
      if (entryId === null) {
        openUnmatched = input.type === "in" ? punch : null;
      } else {
        entries = entries.map((entry) => {
          if (entry.id !== entryId) {
            return entry;
          }
          if (input.type === "in") {
            const duplicate =
              entry.clockIn !== null && entry.clockIn !== undefined;
            punch.duplicate = duplicate;
            return duplicate ? entry : { ...entry, clockIn: PUNCH_AT };
          }
          return {
            ...entry,
            clockOut: PUNCH_AT,
            missing: entry.missing.filter((item) => item !== "out"),
          };
        });
      }
      return HttpResponse.json({ data: { punchMySchedule: punch } });
    }),
  ];

  return { handlers, punches };
};
