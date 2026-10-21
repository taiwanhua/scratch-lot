import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { ScheduleAttendanceService } from "./attendance.service";
import {
  MakeupPunchEntryOptionsInput,
  ReassignSchedulePunchInput,
  ScheduleAttendanceByPersonInput,
  ScheduleAttendanceByStoreInput,
  ScheduleAttendanceExportInput,
} from "./dto/attendance.input";
import { MakeupPunchService } from "./makeup-punch.service";
import {
  ScheduleAttendanceByPersonPayload,
  ScheduleAttendanceByStorePayload,
  ScheduleAttendanceEntryOptionModel,
  ScheduleAttendanceExportPayload,
  ScheduleAttendancePunchModel,
} from "./models/attendance.model";

/**
 * 出勤紀錄(`schedule.attendance`;規格 14.7、14.8):讀要 `view`(只看自己的;`view-all` 看全部由 service 判斷)、
 * 匯出要 `export`、改對應排班要 `reassign-punches`、補打卡新增頁的下拉要 `create`。
 */
@Resolver(() => ScheduleAttendanceByStorePayload)
export class ScheduleAttendanceResolver {
  constructor(
    private readonly service: ScheduleAttendanceService,
    private readonly makeup: MakeupPunchService,
  ) {}

  @RequirePermission("schedule.attendance.view")
  @Query(() => ScheduleAttendanceByPersonPayload)
  scheduleAttendanceByPerson(
    @Args("input") input: ScheduleAttendanceByPersonInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendanceByPersonPayload> {
    return this.service.byPerson(operator, input);
  }

  @RequirePermission("schedule.attendance.view")
  @Query(() => ScheduleAttendanceByStorePayload)
  scheduleAttendanceByStore(
    @Args("input") input: ScheduleAttendanceByStoreInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendanceByStorePayload> {
    return this.service.byStore(operator, input);
  }

  @RequirePermission("schedule.attendance.export")
  @Query(() => ScheduleAttendanceExportPayload)
  scheduleAttendanceExport(
    @Args("input") input: ScheduleAttendanceExportInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendanceExportPayload> {
    return this.service.exportRows(operator, input);
  }

  @RequirePermission("schedule.attendance.reassign-punches")
  @Query(() => [ScheduleAttendanceEntryOptionModel])
  scheduleAttendancePunchEntryOptions(
    @Args("punchId", { type: () => ID }) punchId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendanceEntryOptionModel[]> {
    return this.service.entryOptionsOfPunch(operator, punchId);
  }

  @RequirePermission("schedule.attendance.reassign-punches")
  @Mutation(() => ScheduleAttendancePunchModel)
  reassignSchedulePunch(
    @Args("input") input: ReassignSchedulePunchInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendancePunchModel> {
    return this.service.reassign(operator, input);
  }

  @RequirePermission("schedule.attendance.create")
  @Query(() => [ScheduleAttendanceEntryOptionModel])
  async makeupPunchEntryOptions(
    @Args("input") input: MakeupPunchEntryOptionsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAttendanceEntryOptionModel[]> {
    const entries = await this.makeup.entryOptions(operator, input);
    return entries.map((entry) => ({
      id: entry.id,
      orgId: entry.orgId,
      orgName: "",
      date: entry.date,
      startAt: entry.startAt,
      endAt: entry.endAt,
      shortName: entry.shortName,
    }));
  }

  /** 我送出、還在審核中的補打卡申請對應的排班(我的班表的「補卡審核中」)。 */
  @RequirePermission("schedule.my.view")
  @Query(() => [ID])
  myPendingMakeupPunchEntryIds(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<string[]> {
    return this.makeup.pendingEntryIds(operator);
  }

  /**
   * 補打卡申請選的排班還在不在(審核畫面的警告;選「沒有排班」= true)。只要登入:申請中心的審核者
   * 不一定有出勤紀錄的權限(只回是 / 否,在操作者的租戶內查)。
   */
  @Query(() => Boolean)
  makeupPunchEntryExists(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<boolean> {
    return this.makeup.entryExistsFor(operator, submissionId);
  }
}
