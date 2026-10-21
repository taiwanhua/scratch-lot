import { Args, Context, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { GraphqlContext } from "../../../auth/request-context";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  DepositLotteryShiftCashInput,
  OpenLotteryShiftInput,
  ReassignLotteryShiftEntryInput,
  WithdrawLotteryShiftCashInput,
} from "./dto/lottery-store.input";
import {
  LotteryShiftInfoPayload,
  LotteryStoreBoardModel,
  LotteryStoreBoardPayload,
  LotteryStoreOpenShiftFormPayload,
  LotteryStorePunchPayload,
  LotteryStoreShiftPayload,
} from "./models/lottery-store.model";
import { StoreBoardService } from "./store-board.service";
import { StoreCashService } from "./store-cash.service";
import { StoreShiftsService } from "./store-shifts.service";

/**
 * 店面管理的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`)。看板與班次資訊由 service 檢查
 * `store.view`;寫入守對應的頁內權限,「負責人或店長」這類依資料而定的判斷在 service。
 */
@Resolver(() => LotteryStoreBoardModel)
export class LotteryStoreResolver {
  constructor(
    private readonly board: StoreBoardService,
    private readonly shifts: StoreShiftsService,
    private readonly cash: StoreCashService,
  ) {}

  @Query(() => LotteryStoreBoardPayload, { name: "lotteryStoreBoard" })
  async lotteryStoreBoard(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreBoardPayload> {
    return { item: await this.board.board(operator, orgId) };
  }

  @RequirePermission("store.open-shift")
  @Query(() => LotteryStoreOpenShiftFormPayload, {
    name: "lotteryStoreOpenShiftForm",
  })
  async lotteryStoreOpenShiftForm(
    @Args("cashPointId", { type: () => ID }) cashPointId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreOpenShiftFormPayload> {
    return { item: await this.shifts.openShiftForm(operator, cashPointId) };
  }

  @RequirePermission("store.open-shift")
  @Mutation(() => LotteryStoreShiftPayload)
  async openLotteryShift(
    @Args("input") input: OpenLotteryShiftInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreShiftPayload> {
    return this.shifts.open(operator, input);
  }

  /** 開班視窗的 [打卡](排班模組另查 `schedule.my.punch`)。 */
  @RequirePermission("store.open-shift")
  @Mutation(() => LotteryStorePunchPayload)
  punchLotteryShiftStart(
    @Args("entryId", { type: () => ID }) entryId: string,
    @CurrentOperator() operator: OperatorContext,
    @Context() context: GraphqlContext,
  ): Promise<LotteryStorePunchPayload> {
    const userAgent = context.req.headers["user-agent"];
    return this.shifts.punchStart(operator, entryId, {
      ip: context.req.ip ?? null,
      userAgent: typeof userAgent === "string" ? userAgent : null,
    });
  }

  @Query(() => LotteryShiftInfoPayload, { name: "lotteryShiftInfo" })
  async lotteryShiftInfo(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryShiftInfoPayload> {
    return { item: await this.shifts.info(operator, id) };
  }

  @Mutation(() => LotteryShiftInfoPayload)
  async reassignLotteryShiftEntry(
    @Args("input") input: ReassignLotteryShiftEntryInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryShiftInfoPayload> {
    return { item: await this.shifts.reassign(operator, input) };
  }

  @RequirePermission("store.deposit")
  @Mutation(() => LotteryStoreShiftPayload)
  async depositLotteryShiftCash(
    @Args("input") input: DepositLotteryShiftCashInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreShiftPayload> {
    return this.cash.deposit(operator, input);
  }

  @RequirePermission("store.withdraw")
  @Mutation(() => LotteryStoreShiftPayload)
  async withdrawLotteryShiftCash(
    @Args("input") input: WithdrawLotteryShiftCashInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStoreShiftPayload> {
    return this.cash.withdraw(operator, input);
  }
}
