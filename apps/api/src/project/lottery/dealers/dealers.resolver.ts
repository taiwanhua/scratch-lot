import { Args, ID, Int, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { DealerContactsService } from "./dealer-contacts.service";
import { DEALERS_PERMISSIONS } from "./dealer-keys";
import { DealerSigninsService } from "./dealer-signins.service";
import { LotteryDealersService } from "./dealers.service";
import {
  CreateLotteryDealerContactInput,
  LotteryDealerContactsInput,
  UpdateLotteryDealerContactInput,
} from "./dto/lottery-dealer-contact.input";
import {
  CreateLotteryDealerInput,
  LotteryDealersInput,
  RegisterLotteryDealerSigninInput,
  UpdateLotteryDealerInput,
  UpdateLotteryDealerSigninInput,
} from "./dto/lottery-dealer.input";
import {
  LotteryDealerContactModel,
  LotteryDealerContactPayload,
  LotteryDealerContactsPayload,
} from "./models/lottery-dealer-contact.model";
import {
  LotteryDealerCoSellersPayload,
  LotteryDealerModel,
  LotteryDealerPayload,
  LotteryDealerSigninPayload,
  LotteryDealerSigninsPayload,
  LotteryDealersPayload,
  LotteryOccupiedStoresPayload,
} from "./models/lottery-dealer.model";

/**
 * 經銷商的 GraphQL 端點(權限表正本 `docs/modules/project/dealers.md`)。
 * 讀取沒有 `view` 權限可守(規格 3.2),由 service 檢查有沒有綁 `dealers`;
 * 寫入守 `dealers.create` / `dealers.edit`(見簽也用 `edit`)。欄位級權限在 service。
 */
@Resolver(() => LotteryDealerModel)
export class LotteryDealersResolver {
  constructor(
    private readonly service: LotteryDealersService,
    private readonly signins: DealerSigninsService,
  ) {}

  @Query(() => LotteryDealersPayload, { name: "lotteryDealers" })
  lotteryDealers(
    @Args("input") input: LotteryDealersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealersPayload> {
    return this.service.list(operator, input);
  }

  @Query(() => LotteryDealerPayload, { name: "lotteryDealer" })
  async lotteryDealer(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerPayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  @Query(() => LotteryDealerSigninsPayload, { name: "lotteryDealerSignins" })
  lotteryDealerSignins(
    @Args("dealerId", { type: () => ID }) dealerId: string,
    @Args("year", { type: () => Int }) year: number,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerSigninsPayload> {
    return this.signins.list(operator, dealerId, year);
  }

  @Query(() => LotteryDealerCoSellersPayload, {
    name: "lotteryDealerCoSellers",
  })
  lotteryDealerCoSellers(
    @Args("dealerId", { type: () => ID }) dealerId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerCoSellersPayload> {
    return this.service.coSellers(operator, dealerId);
  }

  @Query(() => LotteryOccupiedStoresPayload, {
    name: "lotteryOccupiedStores",
  })
  lotteryOccupiedStores(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOccupiedStoresPayload> {
    return this.service.occupiedStores(operator);
  }

  @RequirePermission(DEALERS_PERMISSIONS.create)
  @Mutation(() => LotteryDealerPayload)
  async createLotteryDealer(
    @Args("input") input: CreateLotteryDealerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerPayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.edit)
  @Mutation(() => LotteryDealerPayload)
  async updateLotteryDealer(
    @Args("input") input: UpdateLotteryDealerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerPayload> {
    return { item: await this.service.update(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.edit)
  @Mutation(() => LotteryDealerSigninPayload)
  async registerLotteryDealerSignin(
    @Args("input") input: RegisterLotteryDealerSigninInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerSigninPayload> {
    return { item: await this.signins.register(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.edit)
  @Mutation(() => LotteryDealerSigninPayload)
  async updateLotteryDealerSignin(
    @Args("input") input: UpdateLotteryDealerSigninInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerSigninPayload> {
    return { item: await this.signins.update(operator, input) };
  }
}

/** 關係人的 GraphQL 端點:讀取同經銷商(綁 `dealers`),寫入守 `dealers.contacts.create` / `edit`。 */
@Resolver(() => LotteryDealerContactModel)
export class LotteryDealerContactsResolver {
  constructor(private readonly service: DealerContactsService) {}

  @Query(() => LotteryDealerContactsPayload, { name: "lotteryDealerContacts" })
  lotteryDealerContacts(
    @Args("input") input: LotteryDealerContactsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerContactsPayload> {
    return this.service.list(operator, input);
  }

  @Query(() => LotteryDealerContactPayload, { name: "lotteryDealerContact" })
  async lotteryDealerContact(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerContactPayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.contactsCreate)
  @Mutation(() => LotteryDealerContactPayload)
  async createLotteryDealerContact(
    @Args("input") input: CreateLotteryDealerContactInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerContactPayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission(DEALERS_PERMISSIONS.contactsEdit)
  @Mutation(() => LotteryDealerContactPayload)
  async updateLotteryDealerContact(
    @Args("input") input: UpdateLotteryDealerContactInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDealerContactPayload> {
    return { item: await this.service.update(operator, input) };
  }
}
