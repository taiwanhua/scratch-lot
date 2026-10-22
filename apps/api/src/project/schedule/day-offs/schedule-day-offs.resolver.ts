import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  AddMyScheduleDayOffsInput,
  AddScheduleDayOffsOnBehalfInput,
  DeleteMyScheduleDayOffInput,
  DeleteScheduleDayOffOnBehalfInput,
  MyScheduleDayOffsInput,
  ScheduleDayOffOverviewInput,
} from "./dto/schedule-day-off.input";
import {
  DeleteScheduleDayOffPayload,
  MyScheduleDayOffsPayload,
  SaveScheduleDayOffsPayload,
  ScheduleDayOffModel,
  ScheduleDayOffOverviewPayload,
} from "./models/schedule-day-off.model";
import { ScheduleDayOffsService } from "./schedule-day-offs.service";

/**
 * 畫休:我的畫休(`schedule.my.edit-day-offs`)、畫休總覽(`schedule.manage.view-day-offs`)、
 * 代改(`schedule.manage.edit-day-offs`)。
 */
@RequireTenant()
@Resolver(() => ScheduleDayOffModel)
export class ScheduleDayOffsResolver {
  constructor(private readonly service: ScheduleDayOffsService) {}

  @RequirePermission("schedule.my.edit-day-offs")
  @Query(() => MyScheduleDayOffsPayload, { name: "myScheduleDayOffs" })
  myScheduleDayOffs(
    @Args("input", { type: () => MyScheduleDayOffsInput, nullable: true })
    input: MyScheduleDayOffsInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyScheduleDayOffsPayload> {
    return this.service.mine(operator, input?.month);
  }

  @RequirePermission("schedule.my.edit-day-offs")
  @Mutation(() => SaveScheduleDayOffsPayload)
  addMyScheduleDayOffs(
    @Args("input") input: AddMyScheduleDayOffsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SaveScheduleDayOffsPayload> {
    return this.service.addMine(operator, input);
  }

  @RequirePermission("schedule.my.edit-day-offs")
  @Mutation(() => DeleteScheduleDayOffPayload)
  async deleteMyScheduleDayOff(
    @Args("input") input: DeleteMyScheduleDayOffInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleDayOffPayload> {
    return { id: await this.service.removeMine(operator, input.id) };
  }

  @RequirePermission("schedule.manage.view-day-offs")
  @Query(() => ScheduleDayOffOverviewPayload, {
    name: "scheduleDayOffOverview",
  })
  scheduleDayOffOverview(
    @Args("input", { type: () => ScheduleDayOffOverviewInput, nullable: true })
    input: ScheduleDayOffOverviewInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleDayOffOverviewPayload> {
    return this.service.overview(operator, input?.orgId, input?.month);
  }

  @RequirePermission("schedule.manage.edit-day-offs")
  @Mutation(() => SaveScheduleDayOffsPayload)
  addScheduleDayOffsOnBehalf(
    @Args("input") input: AddScheduleDayOffsOnBehalfInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SaveScheduleDayOffsPayload> {
    return this.service.addOnBehalf(operator, input);
  }

  @RequirePermission("schedule.manage.edit-day-offs")
  @Mutation(() => DeleteScheduleDayOffPayload)
  async deleteScheduleDayOffOnBehalf(
    @Args("input") input: DeleteScheduleDayOffOnBehalfInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleDayOffPayload> {
    return { id: await this.service.removeOnBehalf(operator, input) };
  }
}
