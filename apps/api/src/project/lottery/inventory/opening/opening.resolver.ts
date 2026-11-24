import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../../auth/decorators";
import type { OperatorContext } from "../../../../database/operator-context";
import { RequirePermission } from "../../../../permission/require-permission.decorator";
import { RequireTenant } from "../../../tenant-scope/require-tenant.decorator";
import {
  CreateLotteryOpeningBookInput,
  LotteryOpeningScanInput,
  ReopenLotteryStoreOpeningInput,
} from "./opening.input";
import {
  LotteryOpeningBookPayload,
  LotteryOpeningScanPayload,
  LotteryStoreOpeningModel,
  LotteryStoreOpeningPayload,
} from "./opening.model";
import { InventoryOpeningService } from "./opening.service";

/**
 * 期初建檔的 GraphQL 端點(期初建檔規格第 3、6 節;權限表正本 `docs/modules/project/inventory.md`)。
 * 建檔、作廢、刷到一張守 `inventory.opening`;結束 / 重新開放守 `lottery-settings.edit-org`;
 * 狀態讀取兩者之一(service 判斷)。
 */
@RequireTenant()
@Resolver(() => LotteryStoreOpeningModel)
export class LotteryOpeningResolver {
  constructor(private readonly openings: InventoryOpeningService) {}

  @Query(() => LotteryStoreOpeningPayload, { name: "lotteryStoreOpening" })
  async lotteryStoreOpening(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreOpeningPayload> {
    return { item: await this.openings.storeOpening(operator, orgId) };
  }

  @RequirePermission("inventory.opening")
  @Query(() => LotteryOpeningScanPayload, { name: "lotteryOpeningScan" })
  lotteryOpeningScan(
    @Args("input") input: LotteryOpeningScanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOpeningScanPayload> {
    return this.openings.scan(operator, input);
  }

  @RequirePermission("inventory.opening")
  @Mutation(() => LotteryOpeningBookPayload)
  createLotteryOpeningBook(
    @Args("input") input: CreateLotteryOpeningBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOpeningBookPayload> {
    return this.openings.create(operator, input);
  }

  @RequirePermission("inventory.opening")
  @Mutation(() => LotteryOpeningBookPayload)
  voidLotteryOpeningBook(
    @Args("bookId", { type: () => ID }) bookId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOpeningBookPayload> {
    return this.openings.voidBook(operator, bookId);
  }

  @RequirePermission("lottery-settings.edit-org")
  @Mutation(() => LotteryStoreOpeningPayload)
  async closeLotteryStoreOpening(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreOpeningPayload> {
    return { item: await this.openings.close(operator, orgId) };
  }

  @RequirePermission("lottery-settings.edit-org")
  @Mutation(() => LotteryStoreOpeningPayload)
  async reopenLotteryStoreOpening(
    @Args("input") input: ReopenLotteryStoreOpeningInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreOpeningPayload> {
    return { item: await this.openings.reopen(operator, input) };
  }
}
