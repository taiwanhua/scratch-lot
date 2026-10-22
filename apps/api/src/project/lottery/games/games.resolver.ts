import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  CreateLotteryGameInput,
  DeleteLotteryGameInput,
  LotteryGamesInput,
  UpdateLotteryGameInput,
} from "./dto/lottery-game.input";
import { LotteryGamesService } from "./games.service";
import {
  DeleteLotteryGamePayload,
  LotteryGameModel,
  LotteryGamePayload,
  LotteryGamesPayload,
} from "./models/lottery-game.model";

/**
 * 遊戲的 GraphQL 端點(權限表正本 `docs/modules/project/master-data.md`)。
 * 讀取沒有 `view` 權限可守(規格 3.2),由 service 檢查有沒有綁 `master-data.games`;
 * 寫入守 `master-data.games.create` / `edit` / `delete`。
 */
@RequireTenant()
@Resolver(() => LotteryGameModel)
export class LotteryGamesResolver {
  constructor(private readonly service: LotteryGamesService) {}

  @Query(() => LotteryGamesPayload, { name: "lotteryGames" })
  lotteryGames(
    @Args("input") input: LotteryGamesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryGamesPayload> {
    return this.service.list(operator, input);
  }

  @Query(() => LotteryGamePayload, { name: "lotteryGame" })
  async lotteryGame(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryGamePayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  @RequirePermission("master-data.games.create")
  @Mutation(() => LotteryGamePayload)
  async createLotteryGame(
    @Args("input") input: CreateLotteryGameInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryGamePayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission("master-data.games.edit")
  @Mutation(() => LotteryGamePayload)
  async updateLotteryGame(
    @Args("input") input: UpdateLotteryGameInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryGamePayload> {
    return { item: await this.service.update(operator, input) };
  }

  @RequirePermission("master-data.games.delete")
  @Mutation(() => DeleteLotteryGamePayload)
  deleteLotteryGame(
    @Args("input") input: DeleteLotteryGameInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteLotteryGamePayload> {
    return this.service.remove(operator, input);
  }
}
