import { Args, ID, Query, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { WHOLESALE_PERMISSIONS } from "@repo/domain/project/lottery";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryWholesaleDetailModel,
  LotteryWholesaleFilterOptionsModel,
  LotteryWholesaleModel,
  LotteryWholesaleOptionsModel,
  LotteryWholesaleScanMatchModel,
  LotteryWholesalesInput,
  LotteryWholesalesPayload,
} from "./models/wholesale.model";
import { notFoundError } from "./wholesale-error";
import { WholesaleQueryService } from "./wholesale-query.service";

function orgIdOf(text: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(text)) {
    throw notFoundError("分店不存在");
  }
  return new Types.ObjectId(text);
}

/**
 * 批售單的端點(權限表正本 `docs/modules/project/purchasing.md`「批售單」):新增頁的選本與刷條碼守 `create`;
 * 列表、批售客戶的批售紀錄守 `view`;檢視內容不守模組權限(店長從申請中心進來):讀得到單據就讀得到。
 * 批售單本身的新增 / 送出 / 審核 / 作廢走表單引擎;收付走 `recordLotterySettlement`(出貨店那一邊要 `receive`)。
 */
@RequireTenant()
@Resolver()
export class WholesaleResolver {
  constructor(private readonly query: WholesaleQueryService) {}

  @RequirePermission(WHOLESALE_PERMISSIONS.create)
  @Query(() => LotteryWholesaleOptionsModel, {
    name: "lotteryWholesaleOptions",
  })
  lotteryWholesaleOptions(
    @Args("fromOrgId", { type: () => ID }) fromOrgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleOptionsModel> {
    return this.query.optionsOf(operator, orgIdOf(fromOrgId));
  }

  /** 刷到的碼對到的本與為什麼不能批售(不在可批售的本裡時,新增頁用它寫原因)。 */
  @RequirePermission(WHOLESALE_PERMISSIONS.create)
  @Query(() => [LotteryWholesaleScanMatchModel], {
    name: "lotteryWholesaleScanMatches",
  })
  lotteryWholesaleScanMatches(
    @Args("fromOrgId", { type: () => ID }) fromOrgId: string,
    @Args("bookNo", { type: () => String }) bookNo: string,
    @CurrentOperator() operator: OperatorContext,
    /** 背面編號才有的遊戲代號 */
    @Args("gameCode", { type: () => String, nullable: true })
    gameCode?: string | null,
  ): Promise<LotteryWholesaleScanMatchModel[]> {
    return this.query.scanMatchesOf(
      operator,
      orgIdOf(fromOrgId),
      bookNo,
      gameCode ?? null,
    );
  }

  @RequirePermission(WHOLESALE_PERMISSIONS.view)
  @Query(() => LotteryWholesalesPayload, { name: "lotteryWholesales" })
  lotteryWholesales(
    @Args("input") input: LotteryWholesalesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesalesPayload> {
    return this.query.listOf(operator, input);
  }

  @RequirePermission(WHOLESALE_PERMISSIONS.view)
  @Query(() => LotteryWholesaleFilterOptionsModel, {
    name: "lotteryWholesaleFilterOptions",
  })
  lotteryWholesaleFilterOptions(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleFilterOptionsModel> {
    return this.query.filterOptionsOf(operator);
  }

  @RequirePermission(WHOLESALE_PERMISSIONS.view)
  @Query(() => [LotteryWholesaleModel], {
    name: "lotteryCustomerWholesales",
  })
  lotteryCustomerWholesales(
    @Args("customerId", { type: () => ID }) customerId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleModel[]> {
    return this.query.customerDocumentsOf(operator, customerId);
  }

  @Query(() => LotteryWholesaleDetailModel, {
    name: "lotteryWholesaleDetail",
  })
  lotteryWholesaleDetail(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleDetailModel> {
    return this.query.detailOf(operator, submissionId);
  }
}
