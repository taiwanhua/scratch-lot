import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import {
  CreateMyDelegationInput,
  DeleteMyDelegationInput,
  MyDelegateCandidatesInput,
  MyDelegationsInput,
} from "./dto/user-delegations.input";
import {
  DeleteMyDelegationPayload,
  MyDelegateCandidatesPayload,
  MyDelegationPayload,
  MyDelegationsPayload,
} from "./models/user-delegations.model";
import { UserDelegationsService } from "./user-delegations.service";

/**
 * 代理人(《底座規格》3.7 B15):只讀寫自己的,所有登入者都能用 —— 不經模組權限
 * (個人設定是殼層路由、不是模組,不分配給角色;同 `UserPreferencesResolver`)。
 */
@Resolver()
export class UserDelegationsResolver {
  constructor(private readonly service: UserDelegationsService) {}

  @Query(() => MyDelegationsPayload, { name: "myDelegations" })
  myDelegations(
    @Args("input") input: MyDelegationsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyDelegationsPayload> {
    return this.service.mine(operator, input);
  }

  @Query(() => MyDelegateCandidatesPayload, { name: "myDelegateCandidates" })
  myDelegateCandidates(
    @Args("input") input: MyDelegateCandidatesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyDelegateCandidatesPayload> {
    return this.service.candidates(operator, input);
  }

  @Mutation(() => MyDelegationPayload, { name: "createMyDelegation" })
  async createMyDelegation(
    @Args("input") input: CreateMyDelegationInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyDelegationPayload> {
    return { delegation: await this.service.create(operator, input) };
  }

  @Mutation(() => DeleteMyDelegationPayload, { name: "deleteMyDelegation" })
  async deleteMyDelegation(
    @Args("input") input: DeleteMyDelegationInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteMyDelegationPayload> {
    return { id: await this.service.remove(operator, input.id) };
  }
}
