import { Args, ID, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryStoreCashCorrectionsPayload,
  LotteryStoreSaleReversalRowModel,
  LotteryStoreSaleReversalsPayload,
  LotteryStoreShiftOptionsPayload,
} from "./models/lottery-store-forms.model";
import { StoreFormsQueryService } from "./store-forms-query.service";

/**
 * 撤銷售出申請、現金更正單的讀取(規格 8.5、8.8、6.1;正本 `docs/modules/project/store.md`
 * 「撤銷售出申請與現金更正單」)。寫入一律經表單引擎(送出 / 審核 / 掛接點);讀取由 service 檢查 `store.view`。
 */
@RequireTenant()
@Resolver(() => LotteryStoreSaleReversalRowModel)
export class LotteryStoreFormsResolver {
  constructor(private readonly query: StoreFormsQueryService) {}

  @Query(() => LotteryStoreShiftOptionsPayload, {
    name: "lotteryStoreShiftOptions",
  })
  async lotteryStoreShiftOptions(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreShiftOptionsPayload> {
    return { items: await this.query.shiftOptions(operator, orgId) };
  }

  @Query(() => LotteryStoreSaleReversalsPayload, {
    name: "lotteryStoreSaleReversals",
  })
  async lotteryStoreSaleReversals(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSaleReversalsPayload> {
    return { items: await this.query.saleReversals(operator, orgId) };
  }

  @Query(() => LotteryStoreCashCorrectionsPayload, {
    name: "lotteryStoreCashCorrections",
  })
  async lotteryStoreCashCorrections(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCashCorrectionsPayload> {
    return { items: await this.query.cashCorrections(operator, orgId) };
  }
}
