import { HttpResponse } from "msw";

import type {
  DeleteScheduleDemandMutationVariables,
  DeleteScheduleEntryMutationVariables,
  RemoveScheduleDayEntriesMutationVariables,
  SaveScheduleDemandMutationVariables,
  SaveScheduleEntryMutationVariables,
  ScheduleDemandFieldsFragment,
  ScheduleEntryFieldsFragment,
  ScheduleRosterQueryVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  ROSTER_ORG,
  ROSTER_PEOPLE,
  ROSTER_SETTINGS,
  ROSTER_TEMPLATES,
  type TestRosterDemand,
  type TestRosterEntry,
  sampleRoster,
  sampleRosterExtras,
} from "./schedule-roster-fixtures";

export interface ScheduleRosterWorldOptions {
  /** 有 `schedule.manage.edit`:api 回 canEdit = true */
  canEdit?: boolean;
  /** 有 `edit-templates`:可以「同時存成人力需求範本」 */
  canSaveTemplate?: boolean;
  /** 一律回這個月沒有人力需求(SC-35) */
  isEmpty?: boolean;
}

const nameOf = (userId: string) =>
  ROSTER_PEOPLE.find((person) => person.userId === userId)?.name ?? null;

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-new-${String(sequence)}`;
};

/** 夾具時間一律台北時區:時點 → 當地日期。 */
const localDate = (iso: string): string =>
  new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * 排班表的假 api:有狀態(依第一次查的月份產生夾具);人力需求每筆執行任務的填的人由排班的
 * 填進紀錄算出;記錄送出的 input 給測試斷言。
 */
export const scheduleRosterWorld = (
  options: ScheduleRosterWorldOptions = {},
) => {
  const { canEdit = true, canSaveTemplate = true, isEmpty = false } = options;
  let loadedMonth: string | null = null;
  let demands: TestRosterDemand[] = [];
  let entries: TestRosterEntry[] = [];
  const inputs = {
    demands: [] as SaveScheduleDemandMutationVariables["input"][],
    entries: [] as SaveScheduleEntryMutationVariables["input"][],
    removedDays: [] as string[],
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

  const handlers = [
    api.query("ScheduleRoster", ({ variables }) => {
      const { input } = variables as ScheduleRosterQueryVariables;
      ensure(input.month);
      return HttpResponse.json({
        data: {
          scheduleRoster: {
            orgId: input.orgId ?? ROSTER_ORG.id,
            orgName: ROSTER_ORG.name,
            month: input.month,
            period: {
              status: "unpublished",
              publishedAt: null,
              publishedByName: null,
            },
            canEdit,
            canSaveTemplate,
            settings: ROSTER_SETTINGS,
            people: ROSTER_PEOPLE,
            demands: demands.map((demand) => demandOf(demand)),
            entries: entries.map((entry) => entryOf(entry)),
            ...sampleRosterExtras(input.month),
            templates: ROSTER_TEMPLATES,
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
        date: localDate(input.startAt),
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
      const id = input.id ?? nextId("e");
      const existing = entries.find((entry) => entry.id === id);
      const entry: TestRosterEntry = {
        id,
        userId: existing?.userId ?? input.userId ?? "",
        date: localDate(input.startAt),
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
      entries = entries.filter((entry) => entry.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleEntry: { id: input.id } },
      });
    }),
    api.mutation("RemoveScheduleDayEntries", ({ variables }) => {
      const { input } = variables as RemoveScheduleDayEntriesMutationVariables;
      inputs.removedDays.push(input.date);
      const removed = entries.filter((entry) => entry.date === input.date);
      entries = entries.filter((entry) => entry.date !== input.date);
      return HttpResponse.json({
        data: {
          removeScheduleDayEntries: {
            deletedIds: removed.map((entry) => entry.id),
            skippedIds: [],
          },
        },
      });
    }),
  ];

  return {
    handlers,
    inputs,
    demandIds: () => demands.map((demand) => demand.id),
  };
};
