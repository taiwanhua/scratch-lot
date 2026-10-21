import { Args, ID, Query, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  LotteryPurchaseListModel,
  LotteryRequisitionCandidateModel,
  LotteryRequisitionStateModel,
} from "./models/requisition.model";
import { notFoundError } from "./requisition-error";
import { RequisitionQueryService } from "./requisition-query.service";

/**
 * 叫貨單的讀取端點(權限表正本 `docs/modules/project/purchasing.md`):
 * 新增頁的遊戲清單守 `purchasing.requisition.create`、採購清單守 `purchasing.requisition.purchase-list`、
 * 列表的衍生狀態守 `purchasing.requisition.view`。叫貨單本身的新增 / 送出 / 作廢走表單引擎。
 */
@Resolver()
export class RequisitionResolver {
  constructor(private readonly query: RequisitionQueryService) {}

  @RequirePermission("purchasing.requisition.create")
  @Query(() => [LotteryRequisitionCandidateModel], {
    name: "lotteryRequisitionCandidates",
  })
  lotteryRequisitionCandidates(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRequisitionCandidateModel[]> {
    if (!Types.ObjectId.isValid(orgId)) {
      throw notFoundError("分店不存在");
    }
    return this.query.candidates(operator, new Types.ObjectId(orgId));
  }

  @RequirePermission("purchasing.requisition.purchase-list")
  @Query(() => LotteryPurchaseListModel, { name: "lotteryPurchaseList" })
  lotteryPurchaseList(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPurchaseListModel> {
    return this.query.purchaseList(operator);
  }

  @RequirePermission("purchasing.requisition.view")
  @Query(() => [LotteryRequisitionStateModel], {
    name: "lotteryRequisitionStates",
  })
  lotteryRequisitionStates(
    @Args("requisitionIds", { type: () => [ID] }) requisitionIds: string[],
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRequisitionStateModel[]> {
    return this.query.states(operator, requisitionIds);
  }
}
