import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { ScheduleCalendarResolver } from "./calendar/schedule-calendar.resolver";
import { ScheduleCalendarService } from "./calendar/schedule-calendar.service";
import { ScheduleFieldOptionsResolver } from "./field-options/schedule-field-options.resolver";
import { ScheduleFieldOptionsService } from "./field-options/schedule-field-options.service";
import { ScheduleRulesResolver } from "./rules/schedule-rules.resolver";
import { ScheduleRulesService } from "./rules/schedule-rules.service";
import { SchedulePermissions } from "./shared/schedule-permissions";
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
 * 規則的生效設定(`effectiveSettingsForOrg`)、行事曆的生效日(`effectiveDays`)。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    SchedulePermissions,
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
  ],
  exports: [
    SchedulePermissions,
    ScheduleRulesService,
    ScheduleStaffService,
    ScheduleTemplatesService,
    ScheduleCalendarService,
  ],
})
export class ScheduleModule {}
