import type { DatabaseRegistration } from "../../../database/registration";
import {
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "./roster.repositories";
import {
  SCHEDULE_DEMANDS_COLLECTION,
  ScheduleDemand,
  ScheduleDemandSchema,
} from "./schedule-demand.schema";
import {
  SCHEDULE_ENTRIES_COLLECTION,
  ScheduleEntry,
  ScheduleEntrySchema,
} from "./schedule-entry.schema";
import {
  SCHEDULE_PERIODS_COLLECTION,
  SchedulePeriod,
  SchedulePeriodSchema,
} from "./schedule-period.schema";
import {
  SCHEDULE_TASK_ASSIGNMENTS_COLLECTION,
  ScheduleTaskAssignment,
  ScheduleTaskAssignmentSchema,
} from "./schedule-task-assignment.schema";

const TABLES = [
  {
    key: "schedule-demands",
    name: ScheduleDemand.name,
    collection: SCHEDULE_DEMANDS_COLLECTION,
    schema: ScheduleDemandSchema,
    provider: ScheduleDemandsRepository,
  },
  {
    key: "schedule-periods",
    name: SchedulePeriod.name,
    collection: SCHEDULE_PERIODS_COLLECTION,
    schema: SchedulePeriodSchema,
    provider: SchedulePeriodsRepository,
  },
  {
    key: "schedule-entries",
    name: ScheduleEntry.name,
    collection: SCHEDULE_ENTRIES_COLLECTION,
    schema: ScheduleEntrySchema,
    provider: ScheduleEntriesRepository,
  },
  {
    key: "schedule-task-assignments",
    name: ScheduleTaskAssignment.name,
    collection: SCHEDULE_TASK_ASSIGNMENTS_COLLECTION,
    schema: ScheduleTaskAssignmentSchema,
    provider: ScheduleTaskAssignmentsRepository,
  },
] as const;

/** 排班表的資料登記:人力需求、月份狀態、排班、排班填進執行任務四張租戶表(歸屬欄 `orgId` = 分店)。 */
export const SCHEDULE_ROSTER_REGISTRATION: DatabaseRegistration = {
  key: "schedule-roster",
  models: TABLES.map((table) => ({
    name: table.name,
    collection: table.collection,
    schema: table.schema,
  })),
  repositories: TABLES.map((table) => ({
    modelName: table.name,
    provider: table.provider,
  })),
  orgDataChecks: TABLES.map((table) => ({
    key: table.key,
    modelName: table.name,
    repository: table.provider,
    ownerField: "orgId",
  })),
};
