import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { ScheduleDemand } from "./schedule-demand.schema";
import { ScheduleEntry } from "./schedule-entry.schema";
import { SchedulePeriod } from "./schedule-period.schema";
import { ScheduleTaskAssignment } from "./schedule-task-assignment.schema";

export type ScheduleDemandDocument = HydratedDocument<ScheduleDemand>;
export type SchedulePeriodDocument = HydratedDocument<SchedulePeriod>;
export type ScheduleEntryDocument = HydratedDocument<ScheduleEntry>;
export type ScheduleTaskAssignmentDocument =
  HydratedDocument<ScheduleTaskAssignment>;

/** schedule_demands(人力需求)。 */
@Injectable()
export class ScheduleDemandsRepository extends BaseRepository<
  ScheduleDemand,
  ScheduleDemandDocument
> {
  constructor(
    @InjectModel(ScheduleDemand.name)
    model: RepositoryModel<ScheduleDemand, ScheduleDemandDocument>,
  ) {
    super(model);
  }
}

/** schedule_periods(某家店某個月的發布狀態)。 */
@Injectable()
export class SchedulePeriodsRepository extends BaseRepository<
  SchedulePeriod,
  SchedulePeriodDocument
> {
  constructor(
    @InjectModel(SchedulePeriod.name)
    model: RepositoryModel<SchedulePeriod, SchedulePeriodDocument>,
  ) {
    super(model);
  }
}

/** schedule_entries(排班)。 */
@Injectable()
export class ScheduleEntriesRepository extends BaseRepository<
  ScheduleEntry,
  ScheduleEntryDocument
> {
  constructor(
    @InjectModel(ScheduleEntry.name)
    model: RepositoryModel<ScheduleEntry, ScheduleEntryDocument>,
  ) {
    super(model);
  }
}

/** schedule_task_assignments(排班填進執行任務)。 */
@Injectable()
export class ScheduleTaskAssignmentsRepository extends BaseRepository<
  ScheduleTaskAssignment,
  ScheduleTaskAssignmentDocument
> {
  constructor(
    @InjectModel(ScheduleTaskAssignment.name)
    model: RepositoryModel<
      ScheduleTaskAssignment,
      ScheduleTaskAssignmentDocument
    >,
  ) {
    super(model);
  }
}
