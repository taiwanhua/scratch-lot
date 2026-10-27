import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryRedemptionPreviewInput,
  LotteryRedemptionsInput,
  RedeemLotteryTicketInput,
  ReplaceLotteryRedemptionInput,
  RevokeLotteryRedemptionInput,
} from "./dto/redemption.input";
import {
  LotteryPurchaseRedemptionsPayload,
  LotteryRedemptionModel,
  LotteryRedemptionPayload,
  LotteryRedemptionPreviewPayload,
  LotteryRedemptionReplacePayload,
  LotteryRedemptionsPayload,
} from "./models/redemption.model";
import { RedemptionQueryService } from "./redemption-query.service";
import { RedemptionService } from "./redemption.service";

/**
 * 兌獎的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`「兌獎」)。讀取由 service 檢查
 * `store.view`;撤銷兩層(`store.redeem` 自己 / `store.undo-redeem`)依資料而定,在 service 判斷。
 */
@RequireTenant()
@Resolver(() => LotteryRedemptionModel)
export class LotteryRedemptionResolver {
  constructor(
    private readonly redemptions: RedemptionService,
    private readonly queries: RedemptionQueryService,
  ) {}

  @RequirePermission("store.redeem")
  @Query(() => LotteryRedemptionPreviewPayload, {
    name: "lotteryRedemptionPreview",
  })
  async lotteryRedemptionPreview(
    @Args("input") input: LotteryRedemptionPreviewInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionPreviewPayload> {
    return { item: await this.redemptions.preview(operator, input) };
  }

  @RequirePermission("store.redeem")
  @Mutation(() => LotteryRedemptionPayload)
  async redeemLotteryTicket(
    @Args("input") input: RedeemLotteryTicketInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionPayload> {
    return { item: await this.redemptions.redeem(operator, input) };
  }

  @Mutation(() => LotteryRedemptionPayload)
  async revokeLotteryRedemption(
    @Args("input") input: RevokeLotteryRedemptionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionPayload> {
    return { item: await this.redemptions.revoke(operator, input) };
  }

  @RequirePermission("store.undo-redeem")
  @Mutation(() => LotteryRedemptionReplacePayload)
  replaceLotteryRedemption(
    @Args("input") input: ReplaceLotteryRedemptionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionReplacePayload> {
    return this.redemptions.replace(operator, input);
  }

  @Query(() => LotteryRedemptionsPayload, { name: "lotteryRedemptions" })
  lotteryRedemptions(
    @Args("input") input: LotteryRedemptionsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionsPayload> {
    return this.queries.list(operator, input);
  }

  @Query(() => [LotteryRedemptionModel], { name: "lotteryRecentRedemptions" })
  lotteryRecentRedemptions(
    @Args("shiftId", { type: () => ID }) shiftId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionModel[]> {
    return this.queries.recent(operator, shiftId);
  }

  @Query(() => LotteryRedemptionPayload, { name: "lotteryRedemption" })
  async lotteryRedemption(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionPayload> {
    return { item: await this.queries.detail(operator, id) };
  }

  @RequirePermission("purchasing.purchase.create")
  @Query(() => LotteryPurchaseRedemptionsPayload, {
    name: "lotteryPurchaseRedemptions",
  })
  async lotteryPurchaseRedemptions(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("submissionId", { type: () => ID, nullable: true })
    submissionId: string | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPurchaseRedemptionsPayload> {
    return {
      items: await this.queries.forPurchase(operator, orgId, submissionId),
    };
  }
}
