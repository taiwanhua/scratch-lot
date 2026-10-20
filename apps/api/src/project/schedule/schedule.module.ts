import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { FieldOptionsModule } from "../../fields/field-options.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { ScheduledJobsModule } from "../../scheduled-jobs/scheduled-jobs.module";
import { ScheduleAutoRunResolver } from "./auto-run/schedule-auto-run.resolver";
import { ScheduleAutoRunService } from "./auto-run/schedule-auto-run.service";
import { ScheduleCalendarResolver } from "./calendar/schedule-calendar.resolver";
import { ScheduleCalendarService } from "./calendar/schedule-calendar.service";
import { ScheduleChangesService } from "./changes/schedule-changes.service";
import { ScheduleCheckResolver } from "./check/schedule-check.resolver";
import { ScheduleCheckService } from "./check/schedule-check.service";
import { SchedulePublishService } from "./check/schedule-publish.service";
import { DayOffRemindersService } from "./day-offs/day-off-reminders.service";
import { ScheduleDayOffsResolver } from "./day-offs/schedule-day-offs.resolver";
import { ScheduleDayOffsService } from "./day-offs/schedule-day-offs.service";
import { ScheduleFieldOptionsResolver } from "./field-options/schedule-field-options.resolver";
import { ScheduleFieldOptionsService } from "./field-options/schedule-field-options.service";
import { ScheduleEntryLookup } from "./integration/entry-lookup";
import { MyScheduleResolver } from "./my/my-schedule.resolver";
import { MyScheduleService } from "./my/my-schedule.service";
import { PublishedEntries } from "./my/published-entries";
import { RosterPeopleReader } from "./roster/roster-people";
import { ScheduleRosterWritesService } from "./roster/schedule-roster-writes.service";
import { ScheduleRosterResolver } from "./roster/schedule-roster.resolver";
import { ScheduleRosterService } from "./roster/schedule-roster.service";
import { ScheduleRulesResolver } from "./rules/schedule-rules.resolver";
import { ScheduleRulesService } from "./rules/schedule-rules.service";
import { ScheduleClock } from "./shared/schedule-clock";
import { SchedulePermissions } from "./shared/schedule-permissions";
import { SchedulePersonLocks } from "./shared/schedule-person-locks";
import { ScheduleStaffResolver } from "./staff/schedule-staff.resolver";
import { ScheduleStaffService } from "./staff/schedule-staff.service";
import { ScheduleTemplatesResolver } from "./templates/schedule-templates.resolver";
import { ScheduleTemplatesService } from "./templates/schedule-templates.service";

/**
 * 班表管理(排班與出勤,規格第 14 章;正本 `docs/modules/project/schedule.md`)。
 * 獨立的專案模組:不得 import 任何刮刮樂路徑(`project-lint.test.ts` 守)。
 * 稽核與權限解析分別由 @Global 的 AuditModule / PermissionModule 提供。
 *
 * 匯出的 service 給同模組的其他功能共用:候選人(`listScheduleCandidates`)、
 * 規則的生效設定(`effectiveSettingsForOrg`)、行事曆的生效日(`effectiveDays`)、
 * 每人每天的畫休(`ScheduleDayOffsService.listUnavailable`);給刮刮樂的排班查詢(`ScheduleEntryLookup`,
 * `integration/entry-lookup.ts`)。
 */
@Module({
  imports: [
    DatabaseModule,
    FieldOptionsModule,
    NotificationsModule,
    ScheduledJobsModule,
  ],
  providers: [
    SchedulePermissions,
    SchedulePersonLocks,
    ScheduleClock,
    ScheduleFieldOptionsService,
    ScheduleFieldOptionsResolver,
    ScheduleRulesService,
    ScheduleRulesResolver,
    ScheduleStaffService,
    ScheduleStaffResolver,
    ScheduleTemplatesService,
    ScheduleTemplatesResolver,
    ScheduleCalendarService,
    ScheduleCalendarResolver,
    ScheduleDayOffsService,
    ScheduleDayOffsResolver,
    DayOffRemindersService,
    RosterPeopleReader,
    ScheduleRosterService,
    ScheduleRosterWritesService,
    ScheduleRosterResolver,
    ScheduleCheckService,
    ScheduleChangesService,
    SchedulePublishService,
    ScheduleCheckResolver,
    ScheduleAutoRunService,
    ScheduleAutoRunResolver,
    PublishedEntries,
    MyScheduleService,
    MyScheduleResolver,
    ScheduleEntryLookup,
  ],
  exports: [
    SchedulePermissions,
    ScheduleRulesService,
    ScheduleStaffService,
    ScheduleTemplatesService,
    ScheduleCalendarService,
    ScheduleDayOffsService,
    ScheduleEntryLookup,
  ],
})
export class ScheduleModule {}
