import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AssignUserRolesInput } from "./dto/assign-user-roles.input";
import { CopyUserOrgRolesInput } from "./dto/copy-user-org-roles.input";
import { CreateUserInput } from "./dto/create-user.input";
import { SetUserEnabledInput } from "./dto/set-user-enabled.input";
import { SetUserOrgsInput } from "./dto/set-user-orgs.input";
import { UpdateUserInput } from "./dto/update-user.input";
import { UsersInput } from "./dto/users.input";
import { CopyUserOrgRolesPayload } from "./models/copy-user-org-roles.model";
import {
  SetUserOrgsPayload,
  UserPayload,
  UsersPayload,
} from "./models/user-payloads.model";
import { UserModel } from "./models/user.model";
import { UsersService } from "./users.service";

/**
 * 使用者管理的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,範圍與規則全在 service(STRUCT-01);
 * 每個 key 對應 user-manager.md 權限表的同一行,欄位級的兩個 key 在 service 內判斷。
 */
@Resolver(() => UserModel)
export class UsersResolver {
  constructor(private readonly service: UsersService) {}

  @RequirePermission("system.user-manager.view")
  @Query(() => UsersPayload, { name: "users" })
  users(
    @Args("input") input: UsersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UsersPayload> {
    return this.service.list(operator, input);
  }

  @RequirePermission("system.user-manager.view")
  @Query(() => UserModel, { name: "user" })
  user(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserModel> {
    return this.service.findOne(operator, id);
  }

  @RequirePermission("system.user-manager.create")
  @Mutation(() => UserPayload)
  async createUser(
    @Args("input") input: CreateUserInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserPayload> {
    return { user: await this.service.create(operator, input) };
  }

  @RequirePermission("system.user-manager.edit")
  @Mutation(() => UserPayload)
  async updateUser(
    @Args("input") input: UpdateUserInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserPayload> {
    return { user: await this.service.update(operator, input) };
  }

  @RequirePermission("system.user-manager.toggle-enabled")
  @Mutation(() => UserPayload)
  async setUserEnabled(
    @Args("input") input: SetUserEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserPayload> {
    return { user: await this.service.setEnabled(operator, input) };
  }

  @RequirePermission("system.user-manager.manage-orgs")
  @Mutation(() => SetUserOrgsPayload)
  setUserOrgs(
    @Args("input") input: SetUserOrgsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SetUserOrgsPayload> {
    return this.service.setOrgs(operator, input);
  }

  @RequirePermission("system.user-manager.assign-roles")
  @Mutation(() => UserPayload)
  async assignUserRoles(
    @Args("input") input: AssignUserRolesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserPayload> {
    return { user: await this.service.assignRoles(operator, input) };
  }

  /**
   * 複製使用者的組織與角色:要 `view` + `manage-orgs` + `assign-roles` 三個權限。
   * 裝飾器只守 `view`(疊多個 `@RequirePermission` 不是 AND),另外兩個在 service 判斷。
   */
  @RequirePermission("system.user-manager.view")
  @Mutation(() => CopyUserOrgRolesPayload)
  copyUserOrgRoles(
    @Args("input") input: CopyUserOrgRolesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CopyUserOrgRolesPayload> {
    return this.service.copyOrgRoles(operator, input);
  }
}
