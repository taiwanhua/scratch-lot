import { HttpResponse } from "msw";

import type {
  AddMyScheduleDayOffsMutationVariables,
  AddScheduleDayOffsOnBehalfMutationVariables,
  DeleteMyScheduleDayOffMutationVariables,
  DeleteScheduleDayOffOnBehalfMutationVariables,
  MyScheduleDayOffsQueryVariables,
  ScheduleDayOffFieldsFragment,
  ScheduleDayOffOverviewQueryVariables,
  ScheduleDayOffViolationFieldsFragment,
} from "@repo/graphql";

import { graphqlError } from "../auth-handlers";
import { api } from "../server";
import {
  DAY_OFF_ME,
  DAY_OFF_MONTH,
  DAY_OFF_STAFF,
  sampleDayOffViolations,
  sampleDayOffs,
} from "./schedule-day-offs-fixtures";
import { SCHEDULE_BRANCH } from "./schedule-settings-fixtures";

export interface ScheduleDayOffsWorldOptions {
  /** 開放期間的狀態(我的畫休與總覽共用;預設開放中) */
  windowState?: "open" | "closed" | "before";
  /** 我的畫休:有代改權限(顯示「到畫休總覽代改」) */
  canOverride?: boolean;
  /** 總覽:有 `edit-day-offs`(顯示 [代改]) */
  canEditOverview?: boolean;
  dayOffs?: ScheduleDayOffFieldsFragment[];
  /** 登記這些日期會被擋下(回 `VALIDATION_FAILED` + 同日最多畫休人數的違反) */
  blockedDates?: string[];
  /** 登記這些日期時回「這天已經有排班」的衝突清單(先排班、後登記畫休:照樣存,提醒) */
  scheduledDates?: string[];
}

const MAX_DAILY = 2;
const LIMITS = { maxMonthly: 8, minMonthly: 4, maxDailyStaff: MAX_DAILY };
const WINDOW = {
  month: DAY_OFF_MONTH,
  startDate: "2026-11-15",
  endDate: "2026-11-25",
};

/** 過去月份的開放期間(前一個月 15–25 日,已截止;我的畫休與總覽換月用)。 */
const pastWindowOf = (month: string) => {
  const [year = 0, value = 0] = month.split("-").map(Number);
  const index = year * 12 + (value - 1) - 1;
  const previous = `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
  return {
    month,
    startDate: `${previous}-15`,
    endDate: `${previous}-25`,
    state: "closed",
    daysLeft: 0,
  };
};

/** 有畫休的日子:同日畫休人數只算主要分店是這家的人。 */
const daysOf = (dayOffs: readonly ScheduleDayOffFieldsFragment[]) =>
  [...new Set(dayOffs.map((item) => item.date))]
    .toSorted((left, right) => left.localeCompare(right))
    .map((date) => {
      const onDate = dayOffs.filter((item) => item.date === date);
      return {
        date,
        staffCount: new Set(
          onDate.filter((item) => item.isPrimary).map((item) => item.userId),
        ).size,
        dayOffs: onDate,
      };
    });

let sequence = 0;
const nextId = (): string => {
  sequence += 1;
  return `day-off-new-${String(sequence)}`;
};

const blockedViolation = (date: string) => ({
  key: "maxDailyDayOffStaff",
  level: "limit",
  message: "blocked",
  dates: [date],
  actual: MAX_DAILY + 1,
  limit: MAX_DAILY,
  from: date,
  to: date,
});

/**
 * 畫休的假 api(我的畫休、畫休總覽、代改;有狀態):當前使用者 = 何家華(主要分店 A-2 台北分店),
 * 目標月 2026-12、開放期間 11/15–11/25;同日最多畫休 2 人。
 * 我的畫休帶 `month`(早於目標月)→ 那個月的紀錄、已截止、唯讀。
 */
export const scheduleDayOffsWorld = (
  options: ScheduleDayOffsWorldOptions = {},
) => {
  const {
    windowState = "open",
    canOverride = true,
    canEditOverview = true,
    blockedDates = [],
    scheduledDates = [],
  } = options;
  /** 那天已有的排班(14:30–22:00,在本店) */
  const entryConflictsOf = (date: string) =>
    scheduledDates.includes(date)
      ? [
          {
            date,
            startAt: new Date(`${date}T14:30:00+08:00`).toISOString(),
            endAt: new Date(`${date}T22:00:00+08:00`).toISOString(),
            orgName: "A-2 台北分店",
          },
        ]
      : [];
  let dayOffs = [...(options.dayOffs ?? sampleDayOffs)];
  const violations: ScheduleDayOffViolationFieldsFragment[] =
    sampleDayOffViolations;
  const window = {
    ...WINDOW,
    state: windowState,
    daysLeft: windowState === "open" ? 6 : 0,
  };
  const inputs = {
    addMine: [] as AddMyScheduleDayOffsMutationVariables["input"][],
    deleteMine: [] as string[],
    addOnBehalf: [] as AddScheduleDayOffsOnBehalfMutationVariables["input"][],
    deleteOnBehalf:
      [] as DeleteScheduleDayOffOnBehalfMutationVariables["input"][],
  };

  const add = (
    input: { userId?: string; date: string; kind: string; slots?: unknown },
    byName: string | null,
    reason: { reason?: string | null; reasonNote?: string | null },
  ) => {
    const userId = input.userId ?? DAY_OFF_ME.userId;
    const person =
      DAY_OFF_STAFF.find((item) => item.userId === userId) ?? DAY_OFF_ME;
    const slots = (input.slots ?? [null]) as ({
      startTime: string;
      endTime: string;
    } | null)[];
    const created = (input.kind === "full-day" ? [null] : slots).map(
      (slot): ScheduleDayOffFieldsFragment => ({
        id: nextId(),
        userId,
        name: person.name,
        date: input.date,
        kind: input.kind,
        startTime: slot?.startTime ?? null,
        endTime: slot?.endTime ?? null,
        note: null,
        isPrimary: person.isPrimary,
        byName,
        reason: reason.reason ?? null,
        reasonNote: reason.reasonNote ?? null,
      }),
    );
    dayOffs = [...dayOffs, ...created];
    return created;
  };

  const handlers = [
    api.query("MyScheduleDayOffs", ({ variables }) => {
      const { input } = variables as MyScheduleDayOffsQueryVariables;
      const month = input?.month ?? DAY_OFF_MONTH;
      const isPast = month < DAY_OFF_MONTH;
      const ofMonth = dayOffs.filter((item) =>
        item.date.startsWith(`${month}-`),
      );
      const mine = ofMonth.filter((item) => item.userId === DAY_OFF_ME.userId);
      return HttpResponse.json({
        data: {
          myScheduleDayOffs: {
            month,
            primaryOrg: { id: SCHEDULE_BRANCH.id, name: SCHEDULE_BRANCH.name },
            window: isPast ? pastWindowOf(month) : window,
            canEdit: !isPast && windowState === "open",
            canOverride,
            limits: LIMITS,
            dayOffCount: new Set(mine.map((item) => item.date)).size,
            myDayOffs: mine,
            days: daysOf(ofMonth.filter((item) => item.isPrimary)),
            violations: isPast ? [] : violations,
          },
        },
      });
    }),
    api.mutation("AddMyScheduleDayOffs", ({ variables }) => {
      const { input } = variables as AddMyScheduleDayOffsMutationVariables;
      inputs.addMine.push(input);
      if (blockedDates.includes(input.date)) {
        return graphqlError("VALIDATION_FAILED", "blocked", {
          fields: ["date"],
          violations: [blockedViolation(input.date)],
        });
      }
      const items = add(input, null, {});
      return HttpResponse.json({
        data: {
          addMyScheduleDayOffs: {
            items,
            violations: [],
            entryConflicts: entryConflictsOf(input.date),
          },
        },
      });
    }),
    api.mutation("DeleteMyScheduleDayOff", ({ variables }) => {
      const { input } = variables as DeleteMyScheduleDayOffMutationVariables;
      inputs.deleteMine.push(input.id);
      dayOffs = dayOffs.filter((item) => item.id !== input.id);
      return HttpResponse.json({
        data: { deleteMyScheduleDayOff: { id: input.id } },
      });
    }),
    api.query("ScheduleDayOffOverview", ({ variables }) => {
      const { input } = variables as ScheduleDayOffOverviewQueryVariables;
      const month = input?.month ?? DAY_OFF_MONTH;
      const isPast = month < DAY_OFF_MONTH;
      const ofMonth = dayOffs.filter((item) =>
        item.date.startsWith(`${month}-`),
      );
      return HttpResponse.json({
        data: {
          scheduleDayOffOverview: {
            orgId: input?.orgId ?? SCHEDULE_BRANCH.id,
            orgName: SCHEDULE_BRANCH.name,
            month,
            targetMonth: DAY_OFF_MONTH,
            window: isPast ? pastWindowOf(month) : window,
            canEdit: canEditOverview,
            limits: LIMITS,
            staff: DAY_OFF_STAFF.map((person) => ({
              ...person,
              dayOffCount: new Set(
                ofMonth
                  .filter((item) => item.userId === person.userId)
                  .map((item) => item.date),
              ).size,
            })),
            days: daysOf(ofMonth),
          },
        },
      });
    }),
    api.mutation("AddScheduleDayOffsOnBehalf", ({ variables }) => {
      const { input } =
        variables as AddScheduleDayOffsOnBehalfMutationVariables;
      inputs.addOnBehalf.push(input);
      const items = add(input, "李店長", input);
      return HttpResponse.json({
        data: {
          addScheduleDayOffsOnBehalf: {
            items,
            violations: [],
            entryConflicts: entryConflictsOf(input.date),
          },
        },
      });
    }),
    api.mutation("DeleteScheduleDayOffOnBehalf", ({ variables }) => {
      const { input } =
        variables as DeleteScheduleDayOffOnBehalfMutationVariables;
      inputs.deleteOnBehalf.push(input);
      dayOffs = dayOffs.filter((item) => item.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleDayOffOnBehalf: { id: input.id } },
      });
    }),
  ];

  return { handlers, inputs };
};
