import type { Persisted } from "../../../database/base.repository";
import type {
  ScheduleDemandDocument,
  ScheduleTaskAssignmentDocument,
} from "../../database/schedule/roster.repositories";
import type {
  ScheduleDemandModel,
  ScheduleEntryModel,
} from "./models/schedule-roster.model";
import type { EntryRecord } from "./roster-people";

export type DemandRecord = Persisted<ScheduleDemandDocument>;
export type AssignmentRecord = Persisted<ScheduleTaskAssignmentDocument>;

/** 人力需求 → 畫面:每筆執行任務帶上填的人(用 `(demandId, taskId)` 對應填進紀錄)。 */
export function demandModelOf(
  record: DemandRecord,
  context: {
    assignments: readonly AssignmentRecord[];
    entryUser: ReadonlyMap<string, string>;
    names: ReadonlyMap<string, string>;
    positionNotes: Readonly<Record<string, string>>;
    visibleTemplateIds: ReadonlySet<string>;
  },
): ScheduleDemandModel {
  const byTask = new Map(
    context.assignments
      .filter((item) => String(item.demandId) === String(record._id))
      .map((item) => [item.taskId, item]),
  );
  const templateId =
    record.templateId === null ? null : String(record.templateId);
  return {
    id: String(record._id),
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    positionKey: record.positionKey,
    positionNote: context.positionNotes[record.positionKey] ?? null,
    templateId:
      templateId !== null && context.visibleTemplateIds.has(templateId)
        ? templateId
        : null,
    source: record.source,
    createdAt: record.createdAt,
    tasks: record.tasks.map((task) => {
      const assignment = byTask.get(task.taskId);
      const entryId =
        assignment === undefined ? null : String(assignment.entryId);
      const userId =
        entryId === null ? null : (context.entryUser.get(entryId) ?? null);
      return {
        taskId: task.taskId,
        role: task.role,
        taskKey: task.taskKey,
        entryId,
        userId,
        userName: userId === null ? null : (context.names.get(userId) ?? null),
      };
    }),
  };
}

/** 排班 → 畫面:填進的執行任務帶上職責與任務內容(人力需求已不在 / 任務已拿掉的略過)。 */
export function entryModelOf(
  record: EntryRecord,
  context: {
    assignments: readonly AssignmentRecord[];
    demands: ReadonlyMap<string, DemandRecord>;
    blocked: ReadonlySet<string>;
  },
): ScheduleEntryModel {
  return {
    id: String(record._id),
    userId: String(record.userId),
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    breakMinutes: record.breakMinutes,
    deletable: !context.blocked.has(String(record._id)),
    assignments: context.assignments
      .filter((item) => String(item.entryId) === String(record._id))
      .flatMap((item) => {
        const demand = context.demands.get(String(item.demandId));
        const task = demand?.tasks.find((t) => t.taskId === item.taskId);
        return task === undefined
          ? []
          : [
              {
                demandId: String(item.demandId),
                taskId: item.taskId,
                role: task.role,
                taskKey: task.taskKey,
                source: item.source,
                reason: item.reason,
              },
            ];
      }),
  };
}
