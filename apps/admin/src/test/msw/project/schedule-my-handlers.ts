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
      return HttpResponse.json({
        data: { mySchedule: payload(input?.month ?? MY_MONTH) },
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
