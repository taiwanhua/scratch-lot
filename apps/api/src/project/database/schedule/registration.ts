import type { DatabaseRegistration } from "../../../database/registration";
import {
  SCHEDULE_CALENDAR_DAYS_COLLECTION,
  ScheduleCalendarDay,
  ScheduleCalendarDaySchema,
} from "./schedule-calendar-day.schema";
import {
  SCHEDULE_DAY_OFF_LOCKS_COLLECTION,
  ScheduleDayOffLock,
  ScheduleDayOffLockSchema,
} from "./schedule-day-off-lock.schema";
import {
  SCHEDULE_DAY_OFFS_COLLECTION,
  ScheduleDayOff,
  ScheduleDayOffSchema,
} from "./schedule-day-off.schema";
import {
  SCHEDULE_DEMAND_TEMPLATES_COLLECTION,
  ScheduleDemandTemplate,
  ScheduleDemandTemplateSchema,
} from "./schedule-demand-template.schema";
import {
  SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION,
  ScheduleDemandWeekTemplate,
  ScheduleDemandWeekTemplateSchema,
} from "./schedule-demand-week-template.schema";
import {
  SCHEDULE_RELATIONSHIPS_COLLECTION,
  ScheduleRelationship,
  ScheduleRelationshipSchema,
} from "./schedule-relationship.schema";
import {
  SCHEDULE_SETTINGS_COLLECTION,
  ScheduleSetting,
  ScheduleSettingSchema,
} from "./schedule-setting.schema";
import {
  SCHEDULE_STAFF_COLLECTION,
  ScheduleStaff,
  ScheduleStaffSchema,
} from "./schedule-staff.schema";
import {
  ScheduleCalendarDaysRepository,
  ScheduleDayOffLocksRepository,
  ScheduleDayOffsRepository,
  ScheduleDemandTemplatesRepository,
  ScheduleDemandWeekTemplatesRepository,
  ScheduleRelationshipsRepository,
  ScheduleSettingsRepository,
  ScheduleStaffRepository,
} from "./schedule.repositories";

const TABLES = [
  {
    key: "schedule-staff",
    name: ScheduleStaff.name,
    collection: SCHEDULE_STAFF_COLLECTION,
    schema: ScheduleStaffSchema,
    provider: ScheduleStaffRepository,
  },
  {
    key: "schedule-relationships",
    name: ScheduleRelationship.name,
    collection: SCHEDULE_RELATIONSHIPS_COLLECTION,
    schema: ScheduleRelationshipSchema,
    provider: ScheduleRelationshipsRepository,
  },
  {
    key: "schedule-settings",
    name: ScheduleSetting.name,
    collection: SCHEDULE_SETTINGS_COLLECTION,
    schema: ScheduleSettingSchema,
    provider: ScheduleSettingsRepository,
  },
  {
    key: "schedule-demand-templates",
    name: ScheduleDemandTemplate.name,
    collection: SCHEDULE_DEMAND_TEMPLATES_COLLECTION,
    schema: ScheduleDemandTemplateSchema,
    provider: ScheduleDemandTemplatesRepository,
  },
  {
    key: "schedule-demand-week-templates",
    name: ScheduleDemandWeekTemplate.name,
    collection: SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION,
    schema: ScheduleDemandWeekTemplateSchema,
    provider: ScheduleDemandWeekTemplatesRepository,
  },
  {
    key: "schedule-calendar-days",
    name: ScheduleCalendarDay.name,
    collection: SCHEDULE_CALENDAR_DAYS_COLLECTION,
    schema: ScheduleCalendarDaySchema,
    provider: ScheduleCalendarDaysRepository,
  },
  {
    key: "schedule-day-offs",
    name: ScheduleDayOff.name,
    collection: SCHEDULE_DAY_OFFS_COLLECTION,
    schema: ScheduleDayOffSchema,
    provider: ScheduleDayOffsRepository,
  },
  {
    key: "schedule-day-off-locks",
    name: ScheduleDayOffLock.name,
    collection: SCHEDULE_DAY_OFF_LOCKS_COLLECTION,
    schema: ScheduleDayOffLockSchema,
    provider: ScheduleDayOffLocksRepository,
  },
] as const;

/** 班表管理的資料登記:八張租戶表(含畫休寫入的守門表)、各一個 BaseRepository、各一項組織歸屬檢查(歸屬欄 `orgId`)。 */
export const SCHEDULE_SETTINGS_REGISTRATION: DatabaseRegistration = {
  key: "schedule-settings",
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
