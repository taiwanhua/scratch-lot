import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  DeleteScheduleCalendarDayInput,
  SaveScheduleCalendarDayInput,
  ScheduleCalendarInput,
} from "./dto/schedule-calendar.input";
import {
  DeleteScheduleCalendarDayPayload,
  ScheduleCalendarDayModel,
  ScheduleCalendarDayPayload,
  ScheduleCalendarPayload,
} from "./models/schedule-calendar.model";
import { ScheduleCalendarService } from "./schedule-calendar.service";

/** 排班作業 → 行事曆(`schedule.manage`;寫入要 `edit-calendar`)。 */
@RequireTenant()
@Resolver(() => ScheduleCalendarDayModel)
export class ScheduleCalendarResolver {
  constructor(private readonly service: ScheduleCalendarService) {}

  @RequirePermission("schedule.manage.view")
  @Query(() => ScheduleCalendarPayload, { name: "scheduleCalendar" })
  scheduleCalendar(
    @Args("input") input: ScheduleCalendarInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleCalendarPayload> {
    return this.service.month(operator, input.orgId, input.month);
  }

  @RequirePermission("schedule.manage.edit-calendar")
  @Mutation(() => ScheduleCalendarDayPayload)
  async saveScheduleCalendarDay(
    @Args("input") input: SaveScheduleCalendarDayInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleCalendarDayPayload> {
    return { item: await this.service.save(operator, input) };
  }

  @RequirePermission("schedule.manage.edit-calendar")
  @Mutation(() => DeleteScheduleCalendarDayPayload)
  async deleteScheduleCalendarDay(
    @Args("input") input: DeleteScheduleCalendarDayInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleCalendarDayPayload> {
    return { id: await this.service.remove(operator, input) };
  }
}
