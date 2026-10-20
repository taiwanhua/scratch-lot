import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  DeleteScheduleTemplateInput,
  SaveScheduleDemandTemplateInput,
  SaveScheduleDemandWeekTemplateInput,
} from "./dto/schedule-template.input";
import {
  DeleteScheduleTemplatePayload,
  ScheduleDemandTemplateModel,
  ScheduleDemandTemplatePayload,
  ScheduleDemandTemplatesPayload,
  ScheduleDemandWeekTemplatePayload,
  ScheduleDemandWeekTemplatesPayload,
} from "./models/schedule-template.model";
import { ScheduleTemplatesService } from "./schedule-templates.service";

/** 排班設定 → 人力需求範本 / 人力需求週範本(`schedule.settings`;寫入要 `edit-templates`)。 */
@Resolver(() => ScheduleDemandTemplateModel)
export class ScheduleTemplatesResolver {
  constructor(private readonly service: ScheduleTemplatesService) {}

  @RequirePermission("schedule.settings.view")
  @Query(() => ScheduleDemandTemplatesPayload, {
    name: "scheduleDemandTemplates",
  })
  scheduleDemandTemplates(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleDemandTemplatesPayload> {
    return this.service.listTemplates(operator);
  }

  @RequirePermission("schedule.settings.edit-templates")
  @Mutation(() => ScheduleDemandTemplatePayload)
  async saveScheduleDemandTemplate(
    @Args("input") input: SaveScheduleDemandTemplateInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleDemandTemplatePayload> {
    return { item: await this.service.saveTemplate(operator, input) };
  }

  @RequirePermission("schedule.settings.edit-templates")
  @Mutation(() => DeleteScheduleTemplatePayload)
  async deleteScheduleDemandTemplate(
    @Args("input") input: DeleteScheduleTemplateInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleTemplatePayload> {
    return { id: await this.service.deleteTemplate(operator, input.id) };
  }

  @RequirePermission("schedule.settings.view")
  @Query(() => ScheduleDemandWeekTemplatesPayload, {
    name: "scheduleDemandWeekTemplates",
  })
  scheduleDemandWeekTemplates(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleDemandWeekTemplatesPayload> {
    return this.service.listWeekTemplates(operator);
  }

  @RequirePermission("schedule.settings.edit-templates")
  @Mutation(() => ScheduleDemandWeekTemplatePayload)
  async saveScheduleDemandWeekTemplate(
    @Args("input") input: SaveScheduleDemandWeekTemplateInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleDemandWeekTemplatePayload> {
    return { item: await this.service.saveWeekTemplate(operator, input) };
  }

  @RequirePermission("schedule.settings.edit-templates")
  @Mutation(() => DeleteScheduleTemplatePayload)
  async deleteScheduleDemandWeekTemplate(
    @Args("input") input: DeleteScheduleTemplateInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleTemplatePayload> {
    return { id: await this.service.deleteWeekTemplate(operator, input.id) };
  }
}
