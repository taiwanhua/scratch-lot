import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { PURCHASE_PERMISSIONS } from "@repo/domain/project/lottery";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import { LotteryRedemptionModel } from "../redemption/models/redemption.model";
import {
  CompleteLotteryPurchaseReceivingInput,
  CompleteLotteryPurchaseReceivingPayload,
  LotteryDealerPurchaseModel,
  LotteryPurchaseOptionsModel,
  LotteryPurchaseProgressModel,
  LotteryPurchaseReceivingModel,
  ReceiveLotteryPurchaseBookInput,
  ReceiveLotteryPurchaseBookPayload,
} from "./models/purchase.model";
import { notFoundError } from "./purchase-error";
import { PurchaseQueryService } from "./purchase-query.service";
import { PurchaseReceivingService } from "./purchase-receiving.service";

/**
 * 進貨單的端點(權限表正本 `docs/modules/project/purchasing.md`「進貨單」):
 * 新增頁選項守 `create`;列表的點收進度 / 結算、甲類的批購紀錄守 `view`;
 * 點收區塊與刷條碼點收不守模組權限(店長從申請中心進來):讀得到單據、點收任務在自己手上才行。
 * 進貨單本身的新增 / 送出 / 審核 / 作廢走表單引擎;收付走 `recordLotterySettlement`(總部那一邊要 `settle`)。
 */
@RequireTenant()
@Resolver()
export class PurchaseResolver {
  constructor(
    private readonly query: PurchaseQueryService,
    private readonly receiving: PurchaseReceivingService,
  ) {}

  @RequirePermission(PURCHASE_PERMISSIONS.create)
  @Query(() => LotteryPurchaseOptionsModel, { name: "lotteryPurchaseOptions" })
  async lotteryPurchaseOptions(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
    /** 編輯中的那張進貨單(草稿 / 退回):叫貨單清單另含它已引用的那張;新增頁不給 */
    @Args("submissionId", { type: () => ID, nullable: true })
    submissionId?: string | null,
  ): Promise<LotteryPurchaseOptionsModel> {
    if (!Types.ObjectId.isValid(orgId)) {
      throw notFoundError("分店不存在");
    }
    return this.query.optionsOf(
      operator,
      new Types.ObjectId(orgId),
      await this.receiving.readableIdOf(operator, submissionId),
    );
  }

  @RequirePermission(PURCHASE_PERMISSIONS.view)
  @Query(() => [LotteryPurchaseProgressModel], {
    name: "lotteryPurchaseProgress",
  })
  lotteryPurchaseProgress(
    @Args("purchaseIds", { type: () => [ID] }) purchaseIds: string[],
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPurchaseProgressModel[]> {
    return this.query.progressOf(operator, purchaseIds);
  }

  @RequirePermission(PURCHASE_PERMISSIONS.view)
  @Query(() => [LotteryDealerPurchaseModel], {
    name: "lotteryDealerPurchases",
  })
  lotteryDealerPurchases(
    @Args("dealerId", { type: () => ID }) dealerId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerPurchaseModel[]> {
    return this.query.dealerPurchasesOf(operator, dealerId);
  }

  @Query(() => LotteryPurchaseReceivingModel, {
    name: "lotteryPurchaseReceiving",
  })
  lotteryPurchaseReceiving(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPurchaseReceivingModel> {
    return this.receiving.receivingOf(operator, submissionId);
  }

  /** 這張進貨單勾選的兌獎紀錄(讀得到單據就讀得到;兌獎紀錄詳情的入口,規格 6.5)。 */
  @Query(() => [LotteryRedemptionModel], {
    name: "lotteryPurchaseRedemptionRecords",
  })
  lotteryPurchaseRedemptionRecords(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRedemptionModel[]> {
    return this.receiving.redemptionsOf(operator, submissionId);
  }

  @Mutation(() => ReceiveLotteryPurchaseBookPayload)
  receiveLotteryPurchaseBook(
    @Args("input") input: ReceiveLotteryPurchaseBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReceiveLotteryPurchaseBookPayload> {
    return this.receiving.receive(
      operator,
      input.submissionId,
      input.code,
      input.gameId ?? null,
    );
  }

  @Mutation(() => CompleteLotteryPurchaseReceivingPayload)
  completeLotteryPurchaseReceiving(
    @Args("input") input: CompleteLotteryPurchaseReceivingInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CompleteLotteryPurchaseReceivingPayload> {
    return this.receiving.complete(operator, input.submissionId, input.rowIds);
  }

  @Mutation(() => Boolean)
  notifyLotteryPurchaseWrongStore(
    @Args("input") input: ReceiveLotteryPurchaseBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<boolean> {
    return this.receiving.notifyWrongStore(
      operator,
      input.submissionId,
      input.code,
    );
  }
}
