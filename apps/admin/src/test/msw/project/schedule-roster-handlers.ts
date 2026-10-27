import { HttpResponse } from "msw";

import type {
  DeleteScheduleDemandMutationVariables,
  DeleteScheduleEntryMutationVariables,
  PublishScheduleMutationVariables,
  RemoveScheduleDayEntriesMutationVariables,
  SaveScheduleDemandMutationVariables,
  SaveScheduleEntryMutationVariables,
  ScheduleCheckQueryVariables,
  ScheduleDemandFieldsFragment,
  ScheduleEntryFieldsFragment,
  ScheduleRosterQueryVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  type AutoRunWorldOptions,
  scheduleAutoRunHandlers,
} from "./schedule-auto-run-handlers";
import { type CheckScenario, sampleCheck } from "./schedule-check-fixtures";
import {
  ROSTER_ORG,
  ROSTER_PEOPLE,
  ROSTER_SETTINGS,
  ROSTER_TEMPLATES,
  type TestRosterDemand,
  type TestRosterEntry,
  dayAt,
  sampleCalendarMarks,
  sampleRoster,
  sampleRosterExtras,
  sampleUnmatchedPunches,
} from "./schedule-roster-fixtures";

export interface ScheduleRosterWorldOptions extends AutoRunWorldOptions {
  /** 有 `schedule.manage.edit`:api 回 canEdit = true */
  canEdit?: boolean;
  /** 有 `edit-templates`:可以「同時存成人力需求範本」 */
  canSaveTemplate?: boolean;
  /** 一律回這個月沒有人力需求(SC-35) */
  isEmpty?: boolean;
  /** 檢核結果(預設 `limits`:1 項限制 + 提醒,Figma SC-18) */
  check?: CheckScenario;
  /** 這個月一開始就已發布(SC-15b) */
  isPublished?: boolean;
  /** 有 `schedule.manage.use-punch-time`(預設有) */
  canUsePunchTime?: boolean;
  /** 沒有未對應排班的打卡(預設有 `sampleUnmatchedPunches`) */
  noUnmatchedPunches?: boolean;
  /** 追加特殊日與店休那天的未對應打卡(`sampleCalendarMarks`) */
  calendarMarks?: boolean;
}

const nameOf = (userId: string) =>
  ROSTER_PEOPLE.find((person) => person.userId === userId)?.name ?? null;

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-new-${String(sequence)}`;
};

/** 夾具時間一律台北時區:時點 → 當地日期鍵。 */
const localDate = (iso: string): string =>
  new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** 時點 → 那天台北 00:00(api 的日期)。 */
const dayOf = (iso: string): string => dayAt(localDate(iso));

/**
 * 排班表的假 api:有狀態(依第一次查的月份產生夾具);人力需求每筆執行任務的填的人由排班的
 * 填進紀錄算出;記錄送出的 input 給測試斷言。
 */
export const scheduleRosterWorld = (
  options: ScheduleRosterWorldOptions = {},
) => {
  const {
    canEdit = true,
    canSaveTemplate = true,
    isEmpty = false,
    canUsePunchTime = true,
  } = options;
  /** 已經被排班對話框對應走的卡(不再列為未對應) */
  const matchedPunchIds = new Set<string>();
  const marksOf = (month: string) =>
    options.calendarMarks === true
      ? sampleCalendarMarks(month)
      : { calendarDays: [], unmatchedPunches: [] };
  const unmatchedPunchesOf = (month: string) =>
    options.noUnmatchedPunches === true
      ? []
      : [
          ...sampleUnmatchedPunches(month),
          ...marksOf(month).unmatchedPunches,
        ].filter((punch) => !matchedPunchIds.has(punch.id));
  let checkScenario: CheckScenario = options.check ?? "limits";
  let period: {
    status: string;
    publishedAt: string | null;
    publishedByName: string | null;
  } =
    options.isPublished === true
      ? {
          status: "published",
          publishedAt: "2026-10-28T02:00:00.000Z",
          publishedByName: "李店長",
        }
      : { status: "unpublished", publishedAt: null, publishedByName: null };
  let loadedMonth: string | null = null;
  let demands: TestRosterDemand[] = [];
  let entries: TestRosterEntry[] = [];
  const inputs = {
    demands: [] as SaveScheduleDemandMutationVariables["input"][],
    entries: [] as SaveScheduleEntryMutationVariables["input"][],
    /** 移除這天所有排班送的日期(台北的日期鍵) */
    removedDays: [] as string[],
    /** 排班表查詢的 input(週檢視跨月多讀的 from / to) */
    queries: [] as ScheduleRosterQueryVariables["input"][],
    removedDayInputs:
      [] as RemoveScheduleDayEntriesMutationVariables["input"][],
    deletedEntries: [] as DeleteScheduleEntryMutationVariables["input"][],
    published: [] as PublishScheduleMutationVariables["input"][],
  };

  const ensure = (month: string) => {
    if (loadedMonth === month) {
      return;
    }
    loadedMonth = month;
    const sample = isEmpty ? { demands: [], entries: [] } : sampleRoster(month);
    demands = sample.demands;
    entries = sample.entries;
  };

  const fillerOf = (demandId: string, taskId: string) =>
    entries.find((item) =>
      item.assignments.some(
        (assignment) =>
          assignment.demandId === demandId && assignment.taskId === taskId,
      ),
    );

  const demandOf = (
    demand: TestRosterDemand,
  ): ScheduleDemandFieldsFragment => ({
    ...demand,
    tasks: demand.tasks.map((task) => {
      const entry = fillerOf(demand.id, task.taskId);
      return {
        ...task,
        entryId: entry?.id ?? null,
        userId: entry?.userId ?? null,
        userName: entry === undefined ? null : nameOf(entry.userId),
      };
    }),
  });

  const entryOf = (entry: TestRosterEntry): ScheduleEntryFieldsFragment => ({
    ...entry,
    assignments: entry.assignments.flatMap((item) => {
      const task = demands
        .find((demand) => demand.id === item.demandId)
        ?.tasks.find((candidate) => candidate.taskId === item.taskId);
      return task === undefined
        ? []
        : [{ ...item, role: task.role, taskKey: task.taskKey }];
    }),
  });

  /** 解除人力需求的這些任務,零筆的排班一起刪。 */
  const release = (demandId: string, taskIds: readonly string[]) => {
    const deleted: string[] = [];
    entries = entries.flatMap((entry) => {
      const left = entry.assignments.filter(
        (item) =>
          !(item.demandId === demandId && taskIds.includes(item.taskId)),
      );
      if (left.length === entry.assignments.length) {
        return [entry];
      }
      if (left.length === 0) {
        deleted.push(entry.id);
        return [];
      }
      return [{ ...entry, assignments: left }];
    });
    return deleted;
  };

  // 套用範本與自動排班(P11):讀寫同一份人力需求與排班
  const autoRun = scheduleAutoRunHandlers(
    {
      demands: () => demands,
      setDemands: (next) => {
        demands = next;
      },
      entries: () => entries,
      setEntries: (next) => {
        entries = next;
      },
      ensure,
      isEmpty,
      unavailability: () =>
        loadedMonth === null
          ? []
          : sampleRosterExtras(loadedMonth).unavailability,
    },
    options,
  );

  const handlers = [
    ...autoRun.handlers,
    api.query("ScheduleRoster", ({ variables }) => {
      const { input } = variables as ScheduleRosterQueryVariables;
      inputs.queries.push(input);
      ensure(input.month);
      return HttpResponse.json({
        data: {
          scheduleRoster: {
            orgId: input.orgId ?? ROSTER_ORG.id,
            orgName: ROSTER_ORG.name,
            month: input.month,
            period,
            canEdit,
            canSaveTemplate,
            canUsePunchTime,
            settings: ROSTER_SETTINGS,
            people: ROSTER_PEOPLE,
            demands: demands.map((demand) => demandOf(demand)),
            entries: entries.map((entry) => entryOf(entry)),
            ...sampleRosterExtras(input.month),
            calendarDays: [
              ...sampleRosterExtras(input.month).calendarDays,
              ...marksOf(input.month).calendarDays,
            ],
            templates: ROSTER_TEMPLATES,
            unmatchedPunches: unmatchedPunchesOf(input.month),
          },
        },
      });
    }),
    api.mutation("SaveScheduleDemand", ({ variables }) => {
      const { input } = variables as SaveScheduleDemandMutationVariables;
      inputs.demands.push(input);
      const id = input.id ?? nextId("d");
      const existing = demands.find((demand) => demand.id === id);
      const tasks = input.tasks.map((task) => ({
        taskId: task.taskId ?? nextId("t"),
        role: task.role,
        taskKey: task.taskKey,
      }));
      const removed = (existing?.tasks ?? [])
        .filter((task) => !tasks.some((kept) => kept.taskId === task.taskId))
        .map((task) => task.taskId);
      const deletedEntryIds = release(id, removed);
      const demand: TestRosterDemand = {
        id,
        date: dayOf(input.startAt),
        startAt: input.startAt,
        endAt: input.endAt,
        positionKey: input.positionKey,
        positionNote: null,
        templateId: existing?.templateId ?? input.templateId ?? null,
        source: existing?.source ?? "manual",
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        tasks,
      };
      demands = [...demands.filter((item) => item.id !== id), demand];
      return HttpResponse.json({
        data: {
          saveScheduleDemand: { item: demandOf(demand), deletedEntryIds },
        },
      });
    }),
    api.mutation("DeleteScheduleDemand", ({ variables }) => {
      const { input } = variables as DeleteScheduleDemandMutationVariables;
      const demand = demands.find((item) => item.id === input.id);
      const deletedEntryIds = release(
        input.id,
        demand?.tasks.map((task) => task.taskId) ?? [],
      );
      demands = demands.filter((item) => item.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleDemand: { id: input.id, deletedEntryIds } },
      });
    }),
    api.mutation("SaveScheduleEntry", ({ variables }) => {
      const { input } = variables as SaveScheduleEntryMutationVariables;
      inputs.entries.push(input);
      for (const punchId of input.punchIds ?? []) {
        matchedPunchIds.add(punchId);
      }
      const id = input.id ?? nextId("e");
      const existing = entries.find((entry) => entry.id === id);
      const entry: TestRosterEntry = {
        id,
        userId: existing?.userId ?? input.userId ?? "",
        date: dayOf(input.startAt),
        startAt: input.startAt,
        endAt: input.endAt,
        breakMinutes: input.breakMinutes,
        deletable: true,
        assignments: input.assignments.map((item) => ({
          ...item,
          source: "manual",
        })),
      };
      entries = [...entries.filter((item) => item.id !== id), entry];
      return HttpResponse.json({
        data: { saveScheduleEntry: { item: entryOf(entry) } },
      });
    }),
    api.mutation("DeleteScheduleEntry", ({ variables }) => {
      const { input } = variables as DeleteScheduleEntryMutationVariables;
      inputs.deletedEntries.push(input);
      entries = entries.filter((entry) => entry.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleEntry: { id: input.id } },
      });
    }),
    api.mutation("RemoveScheduleDayEntries", ({ variables }) => {
      const { input } = variables as RemoveScheduleDayEntriesMutationVariables;
      inputs.removedDays.push(localDate(input.date));
      inputs.removedDayInputs.push(input);
      const day = dayOf(input.date);
      const removed = entries.filter((entry) => entry.date === day);
      entries = entries.filter((entry) => entry.date !== day);
      return HttpResponse.json({
        data: {
          removeScheduleDayEntries: {
            deletedIds: removed.map((entry) => entry.id),
            skippedIds: [],
          },
        },
      });
    }),
    api.query("ScheduleCheck", ({ variables }) => {
      const { input } = variables as ScheduleCheckQueryVariables;
      return HttpResponse.json({
        data: {
          scheduleCheck: {
            ...sampleCheck(input.month, checkScenario),
            orgId: input.orgId ?? ROSTER_ORG.id,
          },
        },
      });
    }),
    api.mutation("PublishSchedule", ({ variables }) => {
      const { input } = variables as PublishScheduleMutationVariables;
      inputs.published.push(input);
      if (checkScenario === "limits") {
        return HttpResponse.json({
          errors: [
            {
              message: "cannot publish",
              extensions: {
                code: "VALIDATION_FAILED",
                fields: ["month"],
                reason: "HAS_LIMIT_VIOLATIONS",
              },
            },
          ],
        });
      }
      period = {
        status: "published",
        publishedAt: new Date().toISOString(),
        publishedByName: "何家華",
      };
      return HttpResponse.json({
        data: {
          publishSchedule: {
            period,
            notifiedCount: new Set(entries.map((entry) => entry.userId)).size,
          },
        },
      });
    }),
  ];

  return {
    handlers,
    /** 換檢核結果(例:改好後重查) */
    setCheck: (scenario: CheckScenario) => {
      checkScenario = scenario;
    },
    inputs,
    /** 套用範本 / 自動排班 / 清除送出的 input */
    autoInputs: autoRun.inputs,
    demandIds: () => demands.map((demand) => demand.id),
  };
};
