import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import { DEALERS_PERMISSIONS } from "./dealer-keys";
import {
  CreateLotteryWholesaleCustomerInput,
  DeleteLotteryWholesaleCustomerInput,
  LotteryWholesaleCustomerSameNamesInput,
  LotteryWholesaleCustomersInput,
  UpdateLotteryWholesaleCustomerInput,
} from "./dto/lottery-wholesale-customer.input";
import {
  DeleteLotteryWholesaleCustomerPayload,
  LotteryWholesaleCustomerModel,
  LotteryWholesaleCustomerPayload,
  LotteryWholesaleCustomerSameNamesPayload,
  LotteryWholesaleCustomersPayload,
} from "./models/lottery-wholesale-customer.model";
import { WholesaleCustomersService } from "./wholesale-customers.service";

/**
 * 批售客戶的 GraphQL 端點(權限表正本 `docs/modules/project/dealers.md`):讀取看有沒有綁
 * `dealers.wholesale-customers`(service);寫入守 `dealers.wholesale-customers.create` / `edit`(刪除也用 `edit`)。
 */
@RequireTenant()
@Resolver(() => LotteryWholesaleCustomerModel)
export class LotteryWholesaleCustomersResolver {
  constructor(private readonly service: WholesaleCustomersService) {}

  @Query(() => LotteryWholesaleCustomersPayload, {
    name: "lotteryWholesaleCustomers",
  })
  lotteryWholesaleCustomers(
    @Args("input") input: LotteryWholesaleCustomersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleCustomersPayload> {
    return this.service.list(operator, input);
  }

  @Query(() => LotteryWholesaleCustomerPayload, {
    name: "lotteryWholesaleCustomer",
  })
  async lotteryWholesaleCustomer(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleCustomerPayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  @Query(() => LotteryWholesaleCustomerSameNamesPayload, {
    name: "lotteryWholesaleCustomerSameNames",
  })
  lotteryWholesaleCustomerSameNames(
    @Args("input") input: LotteryWholesaleCustomerSameNamesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleCustomerSameNamesPayload> {
    return this.service.sameNames(operator, input);
  }

  @RequirePermission(DEALERS_PERMISSIONS.wholesaleCustomersCreate)
  @Mutation(() => LotteryWholesaleCustomerPayload)
  async createLotteryWholesaleCustomer(
    @Args("input") input: CreateLotteryWholesaleCustomerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleCustomerPayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.wholesaleCustomersEdit)
  @Mutation(() => LotteryWholesaleCustomerPayload)
  async updateLotteryWholesaleCustomer(
    @Args("input") input: UpdateLotteryWholesaleCustomerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryWholesaleCustomerPayload> {
    return { item: await this.service.update(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.wholesaleCustomersEdit)
  @Mutation(() => DeleteLotteryWholesaleCustomerPayload)
  async deleteLotteryWholesaleCustomer(
    @Args("input") input: DeleteLotteryWholesaleCustomerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteLotteryWholesaleCustomerPayload> {
    return {
      success: true,
      deletedId: await this.service.delete(operator, input.id),
    };
  }
}
