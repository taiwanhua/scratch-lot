import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  CorrectLotterySkippedTicketsInput,
  LotteryAllocationsInput,
  LotteryInventoryBooksInput,
  LotteryStockOverviewInput,
  LotteryTicketLookupInput,
  MarkLotterySkippedTicketsInput,
  RecoverLotteryTicketsInput,
  ScrapLotteryTicketsInput,
  SetLotteryAllocationInput,
} from "./dto/lottery-inventory.input";
import { InventoryActionsService } from "./inventory-actions.service";
import { InventoryStockService } from "./inventory-stock.service";
import { InventoryViewService } from "./inventory-view.service";
import {
  LotteryAllocationPayload,
  LotteryAllocationsPayload,
  LotteryInventoryActionPayload,
  LotteryInventoryBookModel,
  LotteryInventoryBookPayload,
  LotteryInventoryBooksPayload,
  LotteryInventoryStoresPayload,
  LotteryInvestigationsPayload,
  LotteryStockOverviewPayload,
  LotteryTicketLookupPayload,
} from "./models/lottery-inventory.model";

/**
 * 庫存管理的 GraphQL 端點(權限表正本 `docs/modules/project/inventory.md`)。
 * 讀取由 service 檢查庫存管理有沒有綁(本模組沒有 `view`);寫入守對應的頁內權限。
 */
@RequireTenant()
@Resolver(() => LotteryInventoryBookModel)
export class LotteryInventoryResolver {
  constructor(
    private readonly view: InventoryViewService,
    private readonly actions: InventoryActionsService,
    private readonly stock: InventoryStockService,
  ) {}

  @Query(() => LotteryInventoryBooksPayload, { name: "lotteryInventoryBooks" })
  lotteryInventoryBooks(
    @Args("input") input: LotteryInventoryBooksInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryBooksPayload> {
    return this.view.listBooks(operator, input);
  }

  @Query(() => LotteryInventoryBookPayload, { name: "lotteryInventoryBook" })
  async lotteryInventoryBook(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryBookPayload> {
    return { item: await this.view.bookDetail(operator, id) };
  }

  @Query(() => LotteryTicketLookupPayload, { name: "lotteryTicketLookup" })
  async lotteryTicketLookup(
    @Args("input") input: LotteryTicketLookupInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryTicketLookupPayload> {
    return { items: await this.view.lookup(operator, input) };
  }

  @Query(() => LotteryInvestigationsPayload, {
    name: "lotteryInvestigations",
  })
  lotteryInvestigations(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInvestigationsPayload> {
    return this.view.investigations(operator);
  }

  @Query(() => LotteryAllocationsPayload, { name: "lotteryAllocations" })
  lotteryAllocations(
    @Args("input") input: LotteryAllocationsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryAllocationsPayload> {
    return this.stock.allocationsOf(operator, input);
  }

  @Query(() => LotteryStockOverviewPayload, { name: "lotteryStockOverview" })
  lotteryStockOverview(
    @Args("input") input: LotteryStockOverviewInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStockOverviewPayload> {
    return this.stock.stockOverview(operator, input);
  }

  /** 看得到的店(尋回視窗「回到哪家店」);只要登入(店面刷到待查的張也會用)。 */
  @Query(() => LotteryInventoryStoresPayload, {
    name: "lotteryInventoryStores",
  })
  async lotteryInventoryStores(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryStoresPayload> {
    return { items: await this.stock.visibleStores(operator) };
  }

  @RequirePermission("inventory.edit-allocations")
  @Mutation(() => LotteryAllocationPayload)
  async setLotteryAllocation(
    @Args("input") input: SetLotteryAllocationInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryAllocationPayload> {
    return { item: await this.stock.setAllocation(operator, input) };
  }

  @RequirePermission("inventory.mark-skipped")
  @Mutation(() => LotteryInventoryActionPayload)
  correctLotterySkippedTickets(
    @Args("input") input: CorrectLotterySkippedTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryActionPayload> {
    return this.actions.correctSkips(operator, input);
  }

  @RequirePermission("inventory.mark-skipped")
  @Mutation(() => LotteryInventoryActionPayload)
  markLotterySkippedTickets(
    @Args("input") input: MarkLotterySkippedTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryActionPayload> {
    return this.actions.markSkips(operator, input);
  }

  @RequirePermission("inventory.recover")
  @Mutation(() => LotteryInventoryActionPayload)
  recoverLotteryTickets(
    @Args("input") input: RecoverLotteryTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryActionPayload> {
    return this.actions.recover(operator, input);
  }

  @RequirePermission("inventory.scrap")
  @Mutation(() => LotteryInventoryActionPayload)
  scrapLotteryTickets(
    @Args("input") input: ScrapLotteryTicketsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryInventoryActionPayload> {
    return this.actions.scrap(operator, input);
  }
}
