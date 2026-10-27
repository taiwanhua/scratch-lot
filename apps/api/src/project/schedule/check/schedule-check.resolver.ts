import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  Query,
  Resolver,
} from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import { ScheduleRosterInput } from "../roster/dto/schedule-roster.input";
import { SCHEDULE_PERMISSIONS } from "../shared/schedule-permissions";
import {
  PublishSchedulePayload,
  ScheduleCheckPayload,
} from "./models/schedule-check.model";
import { ScheduleCheckService } from "./schedule-check.service";
import { SchedulePublishService } from "./schedule-publish.service";

/** 發布某家店(缺席 = 當前組織)某個月(`YYYY-MM`)。 */
@InputType()
export class PublishScheduleInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  month!: string;
}

/**
 * 排班作業 → 排班表的檢核與發布(規格 14.5「檢核面板」「發布」):
 * 檢核要 `schedule.manage.view`;發布要 `schedule.manage.publish`(沒有取消發布的端點)。
 */
@RequireTenant()
@Resolver(() => ScheduleCheckPayload)
export class ScheduleCheckResolver {
  constructor(
    private readonly checks: ScheduleCheckService,
    private readonly publisher: SchedulePublishService,
  ) {}

  @RequirePermission(SCHEDULE_PERMISSIONS.manageView)
  @Query(() => ScheduleCheckPayload, { name: "scheduleCheck" })
  scheduleCheck(
    @Args("input") input: ScheduleRosterInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleCheckPayload> {
    return this.checks.evaluateSchedule(operator, input.orgId, input.month);
  }

  @RequirePermission(SCHEDULE_PERMISSIONS.publish)
  @Mutation(() => PublishSchedulePayload)
  publishSchedule(
    @Args("input") input: PublishScheduleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PublishSchedulePayload> {
    return this.publisher.publish(operator, input);
  }
}
