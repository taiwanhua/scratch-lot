import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryStoreCounterScanInput,
  LotteryStoreScanInput,
  MoveLotteryTicketsByCountInput,
  MoveLotteryTicketsInput,
  RecallLotteryTicketsInput,
  SellLotteryTicketsByCountInput,
  SellLotteryTicketsInput,
  SplitLotteryBookInput,
  UndoLotteryCountSaleInput,
  UndoLotteryTicketSaleInput,
} from "./dto/lottery-store-sales.input";
import {
  LotteryStoreBookCardPayload,
  LotteryStoreCountSalesPayload,
  LotteryStoreCounterPayload,
  LotteryStoreCounterScanPayload,
  LotteryStoreSalePayload,
  LotteryStoreSalesPayload,
  LotteryStoreScanItemModel,
  LotteryStoreScanPayload,
  LotteryStoreStockBooksPayload,
} from "./models/lottery-store-sales.model";
import { StoreCountSalesService } from "./store-count-sales.service";
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
    private readonly countSales: StoreCountSalesService,
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

  /** 依張數標記售出(張數店規格 7.2;只有張數店,權限 `store.sell`)。 */
  @RequirePermission("store.sell")
  @Mutation(() => LotteryStoreCountSalesPayload)
  async sellLotteryTicketsByCount(
    @Args("input") input: SellLotteryTicketsByCountInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCountSalesPayload> {
    return { items: await this.countSales.sellByCount(operator, input) };
  }

  @RequirePermission("store.undo-sale")
  @Mutation(() => LotteryStoreSalePayload)
  async undoLotteryTicketSale(
    @Args("input") input: UndoLotteryTicketSaleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalePayload> {
    return { item: await this.sales.undo(operator, input) };
  }

  /** 撤一筆依張數賣出的其中 N 張(張數店規格 7.3 第 2 點;權限同當下撤銷)。 */
  @RequirePermission("store.undo-sale")
  @Mutation(() => LotteryStoreSalePayload)
  async undoLotteryCountSale(
    @Args("input") input: UndoLotteryCountSaleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreSalePayload> {
    return { item: await this.sales.undoCountSale(operator, input) };
  }

  @Query(() => LotteryStoreBookCardPayload, { name: "lotteryStoreBookCard" })
  async lotteryStoreBookCard(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("bookId", { type: () => ID }) bookId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreBookCardPayload> {
    return { item: await this.sales.bookCard(operator, orgId, bookId) };
  }

  @Query(() => LotteryStoreStockBooksPayload, {
    name: "lotteryStoreStockBooks",
  })
  async lotteryStoreStockBooks(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreStockBooksPayload> {
    return { items: await this.counter.stockBooks(operator, orgId) };
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

  /** [收回] / [刷條碼移櫃] 刷到一張(張數店規格 13.1;只讀,service 檢查 `store.view`)。 */
  @Query(() => LotteryStoreCounterScanPayload, {
    name: "lotteryStoreCounterScan",
  })
  async lotteryStoreCounterScan(
    @Args("input") input: LotteryStoreCounterScanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCounterScanPayload> {
    return { items: await this.counter.counterScan(operator, input) };
  }

  /** 依張數移櫃(張數店規格 7.7;`store.move`,另要 `store.sell`,service 檢查)。 */
  @RequirePermission("store.move")
  @Mutation(() => LotteryStoreCounterPayload)
  async moveLotteryTicketsByCount(
    @Args("input") input: MoveLotteryTicketsByCountInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreCounterPayload> {
    return { count: await this.counter.moveByCount(operator, input) };
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
