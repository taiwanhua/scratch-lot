import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { ScheduleAttendancePunch } from "./schedule-attendance-punch.schema";
import { ScheduleAutoRun } from "./schedule-auto-run.schema";
import { ScheduleChange } from "./schedule-change.schema";
import { ScheduleDemand } from "./schedule-demand.schema";
import { ScheduleEntryLock } from "./schedule-entry-lock.schema";
import { ScheduleEntry } from "./schedule-entry.schema";
import { SchedulePeriod } from "./schedule-period.schema";
import { ScheduleTaskAssignment } from "./schedule-task-assignment.schema";

export type ScheduleAutoRunDocument = HydratedDocument<ScheduleAutoRun>;
export type ScheduleAttendancePunchDocument =
  HydratedDocument<ScheduleAttendancePunch>;
export type ScheduleChangeDocument = HydratedDocument<ScheduleChange>;
export type ScheduleDemandDocument = HydratedDocument<ScheduleDemand>;
export type SchedulePeriodDocument = HydratedDocument<SchedulePeriod>;
export type ScheduleEntryDocument = HydratedDocument<ScheduleEntry>;
export type ScheduleEntryLockDocument = HydratedDocument<ScheduleEntryLock>;
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

/** schedule_entry_locks(排班寫入的「人」守門文件)。 */
@Injectable()
export class ScheduleEntryLocksRepository extends BaseRepository<
  ScheduleEntryLock,
  ScheduleEntryLockDocument
> {
  constructor(
    @InjectModel(ScheduleEntryLock.name)
    model: RepositoryModel<ScheduleEntryLock, ScheduleEntryLockDocument>,
  ) {
    super(model);
  }
}

/** schedule_changes(發布後的排班異動)。 */
@Injectable()
export class ScheduleChangesRepository extends BaseRepository<
  ScheduleChange,
  ScheduleChangeDocument
> {
  constructor(
    @InjectModel(ScheduleChange.name)
    model: RepositoryModel<ScheduleChange, ScheduleChangeDocument>,
  ) {
    super(model);
  }
}

/** schedule_auto_runs(自動排班的執行紀錄)。 */
@Injectable()
export class ScheduleAutoRunsRepository extends BaseRepository<
  ScheduleAutoRun,
  ScheduleAutoRunDocument
> {
  constructor(
    @InjectModel(ScheduleAutoRun.name)
    model: RepositoryModel<ScheduleAutoRun, ScheduleAutoRunDocument>,
  ) {
    super(model);
  }
}

/** schedule_attendance_punches(打卡;只新增)。 */
@Injectable()
export class ScheduleAttendancePunchesRepository extends BaseRepository<
  ScheduleAttendancePunch,
  ScheduleAttendancePunchDocument
> {
  constructor(
    @InjectModel(ScheduleAttendancePunch.name)
    model: RepositoryModel<
      ScheduleAttendancePunch,
      ScheduleAttendancePunchDocument
    >,
  ) {
    super(model);
  }
}
