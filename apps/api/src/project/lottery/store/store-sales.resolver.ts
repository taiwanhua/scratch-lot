import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryStoreScanInput,
  LotteryStoreTicketRefInput,
  MoveLotteryTicketsInput,
  RecallLotteryTicketsInput,
  SellLotteryTicketsInput,
  SplitLotteryBookInput,
} from "./dto/lottery-store-sales.input";
import {
  LotteryStoreBookCardPayload,
  LotteryStoreCounterPayload,
  LotteryStoreSalePayload,
  LotteryStoreSalesPayload,
  LotteryStoreScanItemModel,
  LotteryStoreScanPayload,
  LotteryStoreUnopenedBooksPayload,
} from "./models/lottery-store-sales.model";
import { StoreCounterService } from "./store-counter.service";
import { StoreSalesService } from "./store-sales.service";

/**
 * 店面的銷售、當下撤銷、展開卡片、拆本、移櫃 / 收回(規格 6.2–6.4;權限表正本
 * `docs/modules/project/store.md`)。讀取由 service 檢查 `store.view`;寫入守對應的頁內權限。
 */
@RequireTenant()
@Resolver(() => LotteryStoreScanItemModel)
export class LotteryStoreSalesResolver {
  constructor(
    private readonly sales: StoreSalesService,
    private readonly counter: StoreCounterService,
  ) {}

  @Query(() => LotteryStoreScanPayload, { name: "lotteryStoreScan" })
  async lotteryStoreScan(
    @Args("input") input: LotteryStoreScanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreScanPayload> {
    return { items: await this.sales.scan(operator, input) };
  }

  @RequirePermission("store.sell")
  @Mutation(() => LotteryStoreSalesPayload)
  async sellLotteryTickets(
    @Args("input") input: SellLotteryTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalesPayload> {
    return { items: await this.sales.sell(operator, input) };
  }

  @Query(() => LotteryStoreSalePayload, { name: "lotteryStoreSale" })
  async lotteryStoreSale(
    @Args("ticketId", { type: () => ID }) ticketId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalePayload> {
    return { item: await this.sales.saleOf(operator, ticketId) };
  }

  @Query(() => LotteryStoreSalesPayload, { name: "lotteryStoreRecentSales" })
  async lotteryStoreRecentSales(
    @Args("shiftId", { type: () => ID }) shiftId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalesPayload> {
    return { items: await this.sales.recentSales(operator, shiftId) };
  }

  @RequirePermission("store.undo-sale")
  @Mutation(() => LotteryStoreSalePayload)
  async undoLotteryTicketSale(
    @Args("input") input: LotteryStoreTicketRefInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalePayload> {
    return { item: await this.sales.undo(operator, input) };
  }

  @Query(() => LotteryStoreBookCardPayload, { name: "lotteryStoreBookCard" })
  async lotteryStoreBookCard(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("bookId", { type: () => ID }) bookId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreBookCardPayload> {
    return { item: await this.sales.bookCard(operator, orgId, bookId) };
  }

  @Query(() => LotteryStoreUnopenedBooksPayload, {
    name: "lotteryStoreUnopenedBooks",
  })
  async lotteryStoreUnopenedBooks(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreUnopenedBooksPayload> {
    return { items: await this.counter.unopenedBooks(operator, orgId) };
  }

  @RequirePermission("store.split")
  @Mutation(() => LotteryStoreCounterPayload)
  async splitLotteryBook(
    @Args("input") input: SplitLotteryBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCounterPayload> {
    return { count: await this.counter.split(operator, input) };
  }

  @RequirePermission("store.move")
  @Mutation(() => LotteryStoreCounterPayload)
  async moveLotteryTickets(
    @Args("input") input: MoveLotteryTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCounterPayload> {
    return { count: await this.counter.move(operator, input) };
  }

  @RequirePermission("store.move")
  @Mutation(() => LotteryStoreCounterPayload)
  async recallLotteryTickets(
    @Args("input") input: RecallLotteryTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCounterPayload> {
    return { count: await this.counter.recall(operator, input) };
  }
}
