import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { ScheduleRosterInput } from "../roster/dto/schedule-roster.input";
import { SCHEDULE_PERMISSIONS } from "../shared/schedule-permissions";
import {
  ApplyScheduleTemplatesInput,
  ApplyScheduleTemplatesPayload,
  ClearScheduleAutoAssignmentsPayload,
  RunScheduleAutoRunInput,
  ScheduleAutoRunPreviewPayload,
  ScheduleAutoRunRangeInput,
  ScheduleAutoRunStatusPayload,
  ScheduleAutoRunSummaryModel,
} from "./auto-run.models";
import { ScheduleAutoRunService } from "./schedule-auto-run.service";

/**
 * 排班表的套用範本與自動排班(規格 14.4、14.5):
 * 狀態要 `schedule.manage.view`;套用範本(預覽與套用)要 `edit`;自動排班、預覽與清除自動排入的人要 `auto-run`
 * (有 `auto-run` 就可以先以週範本補上人力需求,不需要 `edit`)。
 */
@Resolver(() => ScheduleAutoRunStatusPayload)
export class ScheduleAutoRunResolver {
  constructor(private readonly service: ScheduleAutoRunService) {}

  @RequirePermission(SCHEDULE_PERMISSIONS.manageView)
  @Query(() => ScheduleAutoRunStatusPayload, { name: "scheduleAutoRunStatus" })
  scheduleAutoRunStatus(
    @Args("input") input: ScheduleRosterInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAutoRunStatusPayload> {
    return this.service.status(operator, input);
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.manageEdit)
  @Query(() => ApplyScheduleTemplatesPayload, {
    name: "scheduleTemplateApplyPreview",
  })
  scheduleTemplateApplyPreview(
    @Args("input") input: ApplyScheduleTemplatesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ApplyScheduleTemplatesPayload> {
    return this.service.applyTemplates(operator, input, { dryRun: true });
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.manageEdit)
  @Mutation(() => ApplyScheduleTemplatesPayload)
  applyScheduleTemplates(
    @Args("input") input: ApplyScheduleTemplatesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ApplyScheduleTemplatesPayload> {
    return this.service.applyTemplates(operator, input, { dryRun: false });
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.autoRun)
  @Query(() => ScheduleAutoRunPreviewPayload, {
    name: "scheduleAutoRunPreview",
  })
  scheduleAutoRunPreview(
    @Args("input") input: ScheduleAutoRunRangeInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAutoRunPreviewPayload> {
    return this.service.preview(operator, input);
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.autoRun)
  @Mutation(() => ScheduleAutoRunSummaryModel)
  runScheduleAutoRun(
    @Args("input") input: RunScheduleAutoRunInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleAutoRunSummaryModel> {
    return this.service.run(operator, input);
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.autoRun)
  @Mutation(() => ClearScheduleAutoAssignmentsPayload)
  clearScheduleAutoAssignments(
    @Args("input") input: ScheduleAutoRunRangeInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ClearScheduleAutoAssignmentsPayload> {
    return this.service.clear(operator, input);
  }
}
