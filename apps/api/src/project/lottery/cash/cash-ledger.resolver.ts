import { Args, ID, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { CashLedgerViewService } from "./cash-ledger-view.service";
import {
  LotteryCashLedgerInput,
  LotteryCashLedgerPayload,
  LotteryCashMovementModel,
  LotteryCashMovementPayload,
} from "./models/lottery-cash-ledger.model";

/** 即時現金帳的端點(只能查看;`accounts.view-cash` 由 service 檢查)。沒有寫入端點:流水由各功能經服務寫。 */
@Resolver(() => LotteryCashMovementModel)
export class LotteryCashLedgerResolver {
  constructor(private readonly view: CashLedgerViewService) {}

  @Query(() => LotteryCashLedgerPayload, { name: "lotteryCashLedger" })
  lotteryCashLedger(
    @Args("input") input: LotteryCashLedgerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCashLedgerPayload> {
    return this.view.ledgerOf(operator, input);
  }

  @Query(() => LotteryCashMovementPayload, { name: "lotteryCashMovement" })
  async lotteryCashMovement(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCashMovementPayload> {
    return { item: await this.view.movementOf(operator, id) };
  }
}
