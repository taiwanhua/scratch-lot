import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  CustomizeScheduleAutoRunInput,
  CustomizeScheduleRuleInput,
  RestoreScheduleRuleInput,
  ScheduleRulesInput,
} from "./dto/schedule-rule.input";
import {
  ScheduleRuleModel,
  ScheduleRuleMutationPayload,
  ScheduleRulesPayload,
} from "./models/schedule-rule.model";
import { ScheduleRulesService } from "./schedule-rules.service";

/**
 * 排班設定 → 規則(`schedule.settings`)。寫入的權限依組織而定(最上層組織 `edit-default-rules`、
 * 其他 `edit-org-rules`),守門器只能守固定 key,所以寫入端點守 `view`、細分由 service 判斷。
 */
@Resolver(() => ScheduleRuleModel)
export class ScheduleRulesResolver {
  constructor(private readonly service: ScheduleRulesService) {}

  @RequirePermission("schedule.settings.view")
  @Query(() => ScheduleRulesPayload, { name: "scheduleRules" })
  scheduleRules(
    @Args("input", { type: () => ScheduleRulesInput, nullable: true })
    input: ScheduleRulesInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleRulesPayload> {
    return this.service.list(operator, input?.orgId);
  }

  @RequirePermission("schedule.settings.view")
  @Mutation(() => ScheduleRuleMutationPayload)
  async customizeScheduleRule(
    @Args("input") input: CustomizeScheduleRuleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleRuleMutationPayload> {
    return { rules: await this.service.customize(operator, input) };
  }

  @RequirePermission("schedule.settings.view")
  @Mutation(() => ScheduleRuleMutationPayload)
  async customizeScheduleAutoRun(
    @Args("input") input: CustomizeScheduleAutoRunInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleRuleMutationPayload> {
    return { rules: await this.service.customizeAutoRun(operator, input) };
  }

  @RequirePermission("schedule.settings.view")
  @Mutation(() => ScheduleRuleMutationPayload)
  async restoreScheduleRule(
    @Args("input") input: RestoreScheduleRuleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleRuleMutationPayload> {
    return { rules: await this.service.restore(operator, input) };
  }
}
