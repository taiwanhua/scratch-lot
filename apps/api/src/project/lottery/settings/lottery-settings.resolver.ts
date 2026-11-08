import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  CancelLotteryCountModeConversionInput,
  CustomizeLotterySettingInput,
  LotteryCountModeChangeCheckInput,
  LotterySettingsInput,
  LotteryStoreCountModeHistoryInput,
  RestoreLotterySettingInput,
} from "./dto/lottery-settings.input";
import { LotterySettingsService } from "./lottery-settings.service";
import {
  LotteryCountModeChangeCheckModel,
  LotterySettingModel,
  LotterySettingMutationPayload,
  LotterySettingsPayload,
  LotteryStoreCountModeHistoryModel,
} from "./models/lottery-settings.model";

/**
 * 刮刮樂設定(`lottery-settings`;權限表正本 `docs/modules/project/lottery-settings.md`)。
 * 寫入的權限依組織而定(最上層組織 `edit-default`、其他 `edit-org`),守門器只能守固定 key,
 * 所以寫入端點守 `view`、細分由 service 判斷(同排班規則)。
 */
@RequireTenant()
@Resolver(() => LotterySettingModel)
export class LotterySettingsResolver {
  constructor(private readonly service: LotterySettingsService) {}

  @RequirePermission("lottery-settings.view")
  @Query(() => LotterySettingsPayload, { name: "lotterySettings" })
  lotterySettings(
    @Args("input", { type: () => LotterySettingsInput, nullable: true })
    input: LotterySettingsInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettingsPayload> {
    return this.service.list(operator, input?.orgId);
  }

  @RequirePermission("lottery-settings.view")
  @Query(() => LotteryCountModeChangeCheckModel, {
    name: "lotteryCountModeChangeCheck",
  })
  lotteryCountModeChangeCheck(
    @Args("input") input: LotteryCountModeChangeCheckInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCountModeChangeCheckModel> {
    return this.service.checkCountModeChange(operator, input);
  }

  @RequirePermission("lottery-settings.view")
  @Query(() => LotteryStoreCountModeHistoryModel, {
    name: "lotteryStoreCountModeHistory",
  })
  lotteryStoreCountModeHistory(
    @Args("input") input: LotteryStoreCountModeHistoryInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCountModeHistoryModel> {
    return this.service.history(operator, input.orgId);
  }

  @RequirePermission("lottery-settings.view")
  @Mutation(() => LotterySettingMutationPayload)
  async customizeLotterySetting(
    @Args("input") input: CustomizeLotterySettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettingMutationPayload> {
    return { settings: await this.service.customize(operator, input) };
  }

  @RequirePermission("lottery-settings.view")
  @Mutation(() => LotterySettingMutationPayload)
  async restoreLotterySetting(
    @Args("input") input: RestoreLotterySettingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettingMutationPayload> {
    return { settings: await this.service.restore(operator, input) };
  }

  @RequirePermission("lottery-settings.view")
  @Mutation(() => LotterySettingMutationPayload)
  async cancelLotteryCountModeConversion(
    @Args("input") input: CancelLotteryCountModeConversionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettingMutationPayload> {
    return { settings: await this.service.cancelConversion(operator, input) };
  }
}
