import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import { LotteryCashPointsService } from "./cash-points.service";
import {
  CreateLotteryCashPointInput,
  LotteryCashPointsInput,
  UpdateLotteryCashPointInput,
} from "./dto/lottery-cash-point.input";
import {
  LotteryCashPointModel,
  LotteryCashPointPayload,
  LotteryCashPointsPayload,
  LotteryPositionOptionsPayload,
} from "./models/lottery-cash-point.model";

/**
 * 收銀點的 GraphQL 端點(權限表正本 `docs/modules/project/master-data.md`)。
 * 讀取由 service 檢查有沒有綁 `master-data.cash-points`;寫入守 `create` / `edit`。**沒有刪除端點**。
 */
@RequireTenant()
@Resolver(() => LotteryCashPointModel)
export class LotteryCashPointsResolver {
  constructor(private readonly service: LotteryCashPointsService) {}

  @Query(() => LotteryCashPointsPayload, { name: "lotteryCashPoints" })
  lotteryCashPoints(
    @Args("input") input: LotteryCashPointsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCashPointsPayload> {
    return this.service.list(operator, input);
  }

  @Query(() => LotteryPositionOptionsPayload, {
    name: "lotteryPositionOptions",
  })
  lotteryPositionOptions(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPositionOptionsPayload> {
    return this.service.positionOptions(operator, orgId);
  }

  @RequirePermission("master-data.cash-points.create")
  @Mutation(() => LotteryCashPointPayload)
  async createLotteryCashPoint(
    @Args("input") input: CreateLotteryCashPointInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCashPointPayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission("master-data.cash-points.edit")
  @Mutation(() => LotteryCashPointPayload)
  async updateLotteryCashPoint(
    @Args("input") input: UpdateLotteryCashPointInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCashPointPayload> {
    return { item: await this.service.update(operator, input) };
  }
}
