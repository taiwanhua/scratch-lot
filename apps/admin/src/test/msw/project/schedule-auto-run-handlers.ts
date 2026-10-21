import { HttpResponse } from "msw";

import type {
  ApplyScheduleTemplatesMutationVariables,
  ClearScheduleAutoAssignmentsMutationVariables,
  RunScheduleAutoRunMutationVariables,
  ScheduleAutoRunPreviewQueryVariables,
  ScheduleTemplateApplyPreviewQueryVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  AUTO_RUN_CONDITIONS,
  ROSTER_WEEK_TEMPLATES,
} from "./schedule-auto-run-fixtures";
import {
  ROSTER_PEOPLE,
  ROSTER_TEMPLATES,
  type TestRosterDemand,
  type TestRosterEntry,
} from "./schedule-roster-fixtures";

export interface AutoRunWorldOptions {
  /** 有 `schedule.manage.auto-run`(預設有) */
  canAutoRun?: boolean;
  /** 別人的自動排班執行中(按鈕停用、提示「自動排班執行中」) */
  autoRunning?: boolean;
  /** 一開始就有一次自動排班紀錄(檢核面板最上方的摘要,SC-20b) */
  hasAutoRun?: boolean;
}

/** 排班表假 api 的狀態(`scheduleRosterWorld` 傳進來,兩邊讀寫同一份)。 */
export interface RosterWorldState {
  demands: () => TestRosterDemand[];
  setDemands: (next: TestRosterDemand[]) => void;
  entries: () => TestRosterEntry[];
  setEntries: (next: TestRosterEntry[]) => void;
  ensure: (month: string) => void;
  isEmpty: boolean;
  /** 這個月的畫休(整天 / 時段不可排;假的自動排班要避開) */
  unavailability: () => readonly {
    userId: string;
    date: string;
    fullDay: boolean;
    slots: readonly { startTime: string; endTime: string }[];
  }[];
}

interface AutoRunSummary {
  id: string;
  at: string;
  byName: string | null;
  from: string;
  to: string;
  filledCount: number;
  unfilledCount: number;
  addedDemandCount: number;
  addedDemandDays: number;
}

/** ISO 時點 → 台北的 `HH:mm`(夾具一律台北時區)。 */
const taipeiTime = (iso: string): string =>
  new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-auto-${String(sequence)}`;
};

const sameSlot = (left: TestRosterDemand, right: TestRosterDemand) =>
  left.date === right.date &&
  left.startAt === right.startAt &&
  left.endAt === right.endAt &&
  left.positionKey === right.positionKey;

const templateIdsOf = (
  input: ScheduleTemplateApplyPreviewQueryVariables["input"],
  date: string,
): readonly string[] => {
  if (input.kind === "template") {
    return input.templateIds ?? [];
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (
    ROSTER_WEEK_TEMPLATES.find((item) => item.id === input.weekTemplateId)
      ?.days[weekday] ?? []
  );
};

const demandOfTemplate = (
  templateId: string,
  date: string,
  source: string,
): TestRosterDemand | null => {
  const template = ROSTER_TEMPLATES.find((item) => item.id === templateId);
  if (template === undefined) {
    return null;
  }
  return {
    id: nextId("d"),
    date,
    startAt: new Date(`${date}T${template.startTime}:00+08:00`).toISOString(),
    endAt: new Date(`${date}T${template.endTime}:00+08:00`).toISOString(),
    positionKey: template.positionKey,
    positionNote: null,
    templateId: template.id,
    source,
    createdAt: new Date().toISOString(),
    tasks: template.tasks.map((task) => ({
      taskId: nextId("t"),
      role: task.role,
      taskKey: task.taskKey,
    })),
  };
};

/** 一天要產生的人力需求加進 `created`(和 `taken` 相同時段的略過);回略過的筆數。 */
const addDay = (
  input: ScheduleTemplateApplyPreviewQueryVariables["input"],
  date: string,
  isWeek: boolean,
  taken: readonly TestRosterDemand[],
  created: TestRosterDemand[],
): number => {
  let skipped = 0;
  const seen = [...taken];
  for (const id of templateIdsOf(input, date)) {
    const demand = demandOfTemplate(
      id,
      date,
      isWeek ? "week-template" : "template",
    );
    if (demand === null) {
      continue;
    }
    if (seen.some((item) => sameSlot(item, demand))) {
      skipped += 1;
    } else {
      seen.push(demand);
      created.push(demand);
    }
  }
  return skipped;
};

/**
 * 套用範本與自動排班的假 api(P11;元件測試與 mock 模式共用):套用範本照規則(相同時段略過、
 * 週範本只補空白日)、假的自動排班依序把空的任務排給那天還沒有班的人、清除只清來源自動的。
 */
export const scheduleAutoRunHandlers = (
  state: RosterWorldState,
  options: AutoRunWorldOptions = {},
) => {
  const { canAutoRun = true, autoRunning = false } = options;
  let latestRun: AutoRunSummary | null =
    options.hasAutoRun === true
      ? {
          id: "run-1",
          at: "2026-10-30T06:20:00.000Z",
          byName: "何家華",
          from: "",
          to: "",
          filledCount: 112,
          unfilledCount: 3,
          addedDemandCount: 40,
          addedDemandDays: 18,
        }
      : null;
  const inputs = {
    applied: [] as ApplyScheduleTemplatesMutationVariables["input"][],
    runs: [] as RunScheduleAutoRunMutationVariables["input"][],
    cleared: [] as ClearScheduleAutoAssignmentsMutationVariables["input"][],
  };

  /** 依範本產生的人力需求(相同時段略過;週範本只補空白日)。 */
  const plannedDemands = (
    input: ScheduleTemplateApplyPreviewQueryVariables["input"],
  ) => {
    const plan = {
      created: [] as TestRosterDemand[],
      skippedSlots: 0,
      skippedDays: 0,
      filledDays: 0,
    };
    const isWeek = input.kind !== "template";
    const existing = state.demands();
    for (const date of input.dates.toSorted((left, right) =>
      left.localeCompare(right),
    )) {
      if (isWeek && existing.some((demand) => demand.date === date)) {
        plan.skippedDays += 1;
        continue;
      }
      const before = plan.created.length;
      plan.skippedSlots += addDay(
        input,
        date,
        isWeek,
        [...existing, ...plan.created],
        plan.created,
      );
      if (isWeek && plan.created.length > before) {
        plan.filledDays += 1;
      }
    }
    return plan;
  };
  const applyPayload = (plan: ReturnType<typeof plannedDemands>) => ({
    createdCount: plan.created.length,
    skippedSlots: plan.skippedSlots,
    filledDays: plan.filledDays,
    skippedDays: plan.skippedDays,
  });
  const inRange = (demandId: string, from: string, to: string) => {
    const demand = state.demands().find((item) => item.id === demandId);
    return demand !== undefined && demand.date >= from && demand.date <= to;
  };
  /** 清掉範圍內的填進紀錄(`auto` 只清自動的);零筆的排班一起刪。 */
  const clearRange = (from: string, to: string, which: "auto" | "all") => {
    const deletedEntryIds: string[] = [];
    let removedCount = 0;
    state.setEntries(
      state.entries().flatMap((entry) => {
        const left = entry.assignments.filter(
          (item) =>
            !(
              inRange(item.demandId, from, to) &&
              (which === "all" || item.source === "auto")
            ),
        );
        removedCount += entry.assignments.length - left.length;
        if (left.length === 0) {
          deletedEntryIds.push(entry.id);
          return [];
        }
        return [{ ...entry, assignments: left }];
      }),
    );
    return { removedCount, deletedEntryIds };
  };
  const isFilled = (demandId: string, taskId: string) =>
    state
      .entries()
      .some((entry) =>
        entry.assignments.some(
          (item) => item.demandId === demandId && item.taskId === taskId,
        ),
      );
  /** 這個人那段時間有畫休(整天,或和時段不可排重疊)。 */
  const isOff = (userId: string, demand: TestRosterDemand) => {
    const start = taipeiTime(demand.startAt);
    const end = taipeiTime(demand.endAt);
    return state
      .unavailability()
      .some(
        (day) =>
          day.userId === userId &&
          day.date === demand.date &&
          (day.fullDay ||
            day.slots.some(
              (slot) => slot.startTime < end && slot.endTime > start,
            )),
      );
  };
  /** 假的自動排班:依序把空的任務排給那天還沒有班、沒有畫休的人(負責只給可負責的人)。 */
  const fakeAutoRun = (input: RunScheduleAutoRunMutationVariables["input"]) => {
    if (input.mode !== "fill-empty") {
      clearRange(
        input.from,
        input.to,
        input.mode === "redo-all" ? "all" : "auto",
      );
    }
    let filled = 0;
    let unfilled = 0;
    const open = state
      .demands()
      .filter((demand) => demand.date >= input.from && demand.date <= input.to)
      .flatMap((demand) =>
        demand.tasks
          .filter((task) => !isFilled(demand.id, task.taskId))
          .map((task) => ({ demand, task })),
      );
    for (const { demand, task } of open) {
      const person = ROSTER_PEOPLE.find(
        (candidate) =>
          (task.role !== "leader" || candidate.canLead) &&
          !isOff(candidate.userId, demand) &&
          !state
            .entries()
            .some(
              (entry) =>
                entry.userId === candidate.userId && entry.date === demand.date,
            ),
      );
      if (person === undefined) {
        unfilled += 1;
        continue;
      }
      filled += 1;
      state.setEntries([
        ...state.entries(),
        {
          id: nextId("e"),
          userId: person.userId,
          date: demand.date,
          startAt: demand.startAt,
          endAt: demand.endAt,
          breakMinutes: 30,
          deletable: true,
          assignments: [
            {
              demandId: demand.id,
              taskId: task.taskId,
              source: "auto",
              reason:
                task.role === "leader"
                  ? "自動排入:負責人次數較多"
                  : "自動排入:條件平手,隨機",
            },
          ],
        },
      ]);
    }
    latestRun = {
      id: nextId("run"),
      at: new Date().toISOString(),
      byName: "何家華",
      from: input.from,
      to: input.to,
      filledCount: filled,
      unfilledCount: unfilled,
      addedDemandCount: 0,
      addedDemandDays: 0,
    };
    return latestRun;
  };

  const handlers = [
    api.query("ScheduleAutoRunStatus", () =>
      HttpResponse.json({
        data: {
          scheduleAutoRunStatus: {
            canAutoRun,
            running: autoRunning,
            latest: latestRun,
            weekTemplates: ROSTER_WEEK_TEMPLATES,
            conditions: AUTO_RUN_CONDITIONS,
          },
        },
      }),
    ),
    api.query("ScheduleTemplateApplyPreview", ({ variables }) => {
      const { input } = variables as ScheduleTemplateApplyPreviewQueryVariables;
      state.ensure(input.month);
      return HttpResponse.json({
        data: {
          scheduleTemplateApplyPreview: applyPayload(plannedDemands(input)),
        },
      });
    }),
    api.mutation("ApplyScheduleTemplates", ({ variables }) => {
      const { input } = variables as ApplyScheduleTemplatesMutationVariables;
      inputs.applied.push(input);
      const plan = plannedDemands(input);
      state.setDemands([...state.demands(), ...plan.created]);
      return HttpResponse.json({
        data: { applyScheduleTemplates: applyPayload(plan) },
      });
    }),
    api.query("ScheduleAutoRunPreview", ({ variables }) => {
      const { input } = variables as ScheduleAutoRunPreviewQueryVariables;
      state.ensure(input.month);
      const filled = state
        .entries()
        .flatMap((entry) =>
          entry.assignments.filter((item) =>
            inRange(item.demandId, input.from, input.to),
          ),
        );
      return HttpResponse.json({
        data: {
          scheduleAutoRunPreview: {
            demandCount: state
              .demands()
              .filter(
                (demand) =>
                  demand.date >= input.from && demand.date <= input.to,
              ).length,
            fillableDays: state.isEmpty ? 0 : 3,
            manualCount: filled.filter((item) => item.source !== "auto").length,
            autoCount: filled.filter((item) => item.source === "auto").length,
            weekTemplate: state.isEmpty
              ? null
              : { id: "wk-normal", name: "平日標準週" },
          },
        },
      });
    }),
    api.mutation("RunScheduleAutoRun", ({ variables }) => {
      const { input } = variables as RunScheduleAutoRunMutationVariables;
      inputs.runs.push(input);
      return HttpResponse.json({
        data: { runScheduleAutoRun: fakeAutoRun(input) },
      });
    }),
    api.mutation("ClearScheduleAutoAssignments", ({ variables }) => {
      const { input } =
        variables as ClearScheduleAutoAssignmentsMutationVariables;
      inputs.cleared.push(input);
      return HttpResponse.json({
        data: {
          clearScheduleAutoAssignments: clearRange(
            input.from,
            input.to,
            "auto",
          ),
        },
      });
    }),
  ];

  return { handlers, inputs };
};
