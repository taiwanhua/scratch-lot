import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  AddScheduleStaffInput,
  ScheduleStaffListInput,
  UpdateScheduleStaffInput,
} from "./dto/schedule-staff.input";
import {
  AddScheduleStaffPayload,
  ScheduleStaffListPayload,
  ScheduleStaffPayload,
  ScheduleStaffRowModel,
} from "./models/schedule-staff.model";
import { ScheduleStaffService } from "./schedule-staff.service";

/** 排班設定 → 排班人員(`schedule.settings`;寫入要 `edit-staff`)。 */
@Resolver(() => ScheduleStaffRowModel)
export class ScheduleStaffResolver {
  constructor(private readonly service: ScheduleStaffService) {}

  @RequirePermission("schedule.settings.view")
  @Query(() => ScheduleStaffListPayload, { name: "scheduleStaff" })
  scheduleStaff(
    @Args("input", { type: () => ScheduleStaffListInput, nullable: true })
    input: ScheduleStaffListInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleStaffListPayload> {
    return this.service.list(operator, input);
  }

  @RequirePermission("schedule.settings.edit-staff")
  @Mutation(() => AddScheduleStaffPayload)
  async addScheduleStaff(
    @Args("input") input: AddScheduleStaffInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<AddScheduleStaffPayload> {
    return { items: await this.service.add(operator, input) };
  }

  @RequirePermission("schedule.settings.edit-staff")
  @Mutation(() => ScheduleStaffPayload)
  async updateScheduleStaff(
    @Args("input") input: UpdateScheduleStaffInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleStaffPayload> {
    return { item: await this.service.update(operator, input) };
  }
}
