import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { ScheduleCalendarDay } from "./schedule-calendar-day.schema";
import { ScheduleDayOffLock } from "./schedule-day-off-lock.schema";
import { ScheduleDayOff } from "./schedule-day-off.schema";
import { ScheduleDemandTemplate } from "./schedule-demand-template.schema";
import { ScheduleDemandWeekTemplate } from "./schedule-demand-week-template.schema";
import { ScheduleRelationship } from "./schedule-relationship.schema";
import { ScheduleSetting } from "./schedule-setting.schema";
import { ScheduleStaff } from "./schedule-staff.schema";

export type ScheduleStaffDocument = HydratedDocument<ScheduleStaff>;
export type ScheduleRelationshipDocument =
  HydratedDocument<ScheduleRelationship>;
export type ScheduleSettingDocument = HydratedDocument<ScheduleSetting>;
export type ScheduleDemandTemplateDocument =
  HydratedDocument<ScheduleDemandTemplate>;
export type ScheduleDemandWeekTemplateDocument =
  HydratedDocument<ScheduleDemandWeekTemplate>;
export type ScheduleCalendarDayDocument = HydratedDocument<ScheduleCalendarDay>;
export type ScheduleDayOffDocument = HydratedDocument<ScheduleDayOff>;
export type ScheduleDayOffLockDocument = HydratedDocument<ScheduleDayOffLock>;

/** schedule_staff(排班檔案)。 */
@Injectable()
export class ScheduleStaffRepository extends BaseRepository<
  ScheduleStaff,
  ScheduleStaffDocument
> {
  constructor(
    @InjectModel(ScheduleStaff.name)
    model: RepositoryModel<ScheduleStaff, ScheduleStaffDocument>,
  ) {
    super(model);
  }
}

/** schedule_relationships(排班人員 ↔ 可以排的分店)。 */
@Injectable()
export class ScheduleRelationshipsRepository extends BaseRepository<
  ScheduleRelationship,
  ScheduleRelationshipDocument
> {
  constructor(
    @InjectModel(ScheduleRelationship.name)
    model: RepositoryModel<ScheduleRelationship, ScheduleRelationshipDocument>,
  ) {
    super(model);
  }
}

/** schedule_settings(規則與自動排班條件的自訂)。 */
@Injectable()
export class ScheduleSettingsRepository extends BaseRepository<
  ScheduleSetting,
  ScheduleSettingDocument
> {
  constructor(
    @InjectModel(ScheduleSetting.name)
    model: RepositoryModel<ScheduleSetting, ScheduleSettingDocument>,
  ) {
    super(model);
  }
}

/** schedule_demand_templates(人力需求範本)。 */
@Injectable()
export class ScheduleDemandTemplatesRepository extends BaseRepository<
  ScheduleDemandTemplate,
  ScheduleDemandTemplateDocument
> {
  constructor(
    @InjectModel(ScheduleDemandTemplate.name)
    model: RepositoryModel<
      ScheduleDemandTemplate,
      ScheduleDemandTemplateDocument
    >,
  ) {
    super(model);
  }
}

/** schedule_demand_week_templates(人力需求週範本)。 */
@Injectable()
export class ScheduleDemandWeekTemplatesRepository extends BaseRepository<
  ScheduleDemandWeekTemplate,
  ScheduleDemandWeekTemplateDocument
> {
  constructor(
    @InjectModel(ScheduleDemandWeekTemplate.name)
    model: RepositoryModel<
      ScheduleDemandWeekTemplate,
      ScheduleDemandWeekTemplateDocument
    >,
  ) {
    super(model);
  }
}

/** schedule_calendar_days(行事曆)。 */
@Injectable()
export class ScheduleCalendarDaysRepository extends BaseRepository<
  ScheduleCalendarDay,
  ScheduleCalendarDayDocument
> {
  constructor(
    @InjectModel(ScheduleCalendarDay.name)
    model: RepositoryModel<ScheduleCalendarDay, ScheduleCalendarDayDocument>,
  ) {
    super(model);
  }
}

/** schedule_day_offs(畫休)。 */
@Injectable()
export class ScheduleDayOffsRepository extends BaseRepository<
  ScheduleDayOff,
  ScheduleDayOffDocument
> {
  constructor(
    @InjectModel(ScheduleDayOff.name)
    model: RepositoryModel<ScheduleDayOff, ScheduleDayOffDocument>,
  ) {
    super(model);
  }
}

/** schedule_day_off_locks(畫休寫入的守門文件)。 */
@Injectable()
export class ScheduleDayOffLocksRepository extends BaseRepository<
  ScheduleDayOffLock,
  ScheduleDayOffLockDocument
> {
  constructor(
    @InjectModel(ScheduleDayOffLock.name)
    model: RepositoryModel<ScheduleDayOffLock, ScheduleDayOffLockDocument>,
  ) {
    super(model);
  }
}
