import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { UpdateMyPreferencesInput } from "./dto/update-my-preferences.input";
import {
  MyPreferencesPayload,
  UpdateMyPreferencesPayload,
} from "./models/user-preferences.model";
import { UserPreferencesService } from "./user-preferences.service";

/**
 * 個人偏好(規格 10.6):只讀寫自己的,所有登入者都能用 —— 不經模組權限
 * (個人設定是殼層路由、不是模組,不分配給角色)。
 */
@Resolver()
export class UserPreferencesResolver {
  constructor(private readonly service: UserPreferencesService) {}

  @Query(() => MyPreferencesPayload, { name: "myPreferences" })
  async myPreferences(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyPreferencesPayload> {
    return { settings: await this.service.mine(operator) };
  }

  @Mutation(() => UpdateMyPreferencesPayload, { name: "updateMyPreferences" })
  async updateMyPreferences(
    @Args("input") input: UpdateMyPreferencesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UpdateMyPreferencesPayload> {
    return {
      settings: await this.service.updateMine(operator, input.settings),
    };
  }
}
