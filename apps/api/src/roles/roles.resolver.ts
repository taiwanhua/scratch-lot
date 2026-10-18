import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { DeletePayload } from "../orgs/models/org-payloads.model";
import { RequirePermission } from "../permission/require-permission.decorator";
import { CreateRoleInput } from "./dto/create-role.input";
import { DeleteRoleInput } from "./dto/delete-role.input";
import { GrantRoleUsersInput } from "./dto/grant-role-users.input";
import { RevokeRoleUsersInput } from "./dto/revoke-role-users.input";
import { RoleUserCandidatesInput } from "./dto/role-user-candidates.input";
import { RoleUsersInput } from "./dto/role-users.input";
import { RolesInput } from "./dto/roles.input";
import { SaveRoleMatrixInput } from "./dto/save-role-matrix.input";
import { SetRoleEnabledInput } from "./dto/set-role-enabled.input";
import { UpdateRoleInput } from "./dto/update-role.input";
import { RoleMatrixPayload } from "./models/role-matrix.model";
import {
  RolePayload,
  RoleUserCandidatesPayload,
  RoleUsersPayload,
  RolesPayload,
} from "./models/role-payloads.model";
import { RoleModel } from "./models/role.model";
import { RoleMatrixService } from "./role-matrix.service";
import { RoleUsersService } from "./role-users.service";
import { RolesService } from "./roles.service";

/**
 * 角色管理的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,範圍與規則全在 service(STRUCT-01);
 * 每個 key 對應 docs/modules/role-manager.md 權限表的同一行。
 */
@Resolver(() => RoleModel)
export class RolesResolver {
  constructor(
    private readonly service: RolesService,
    private readonly matrixService: RoleMatrixService,
    private readonly usersService: RoleUsersService,
  ) {}

  @RequirePermission("system.role-manager.view")
  @Query(() => RolesPayload, { name: "roles" })
  roles(
    @Args("input") input: RolesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RolesPayload> {
    return this.service.list(operator, input);
  }

  /** 單筆(GQL-02:query 也回 payload type,形狀與寫入動作一致)。 */
  @RequirePermission("system.role-manager.view")
  @Query(() => RolePayload, { name: "role" })
  async role(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RolePayload> {
    return { role: await this.service.findOne(operator, id) };
  }

  /** 權限矩陣:模組樹 + 各模組權限 + 目前綁定(只回 enabled 且操作者授得出去的)。 */
  @RequirePermission("system.role-manager.view")
  @Query(() => RoleMatrixPayload, { name: "roleMatrix" })
  roleMatrix(
    @Args("roleId", { type: () => ID }) roleId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleMatrixPayload> {
    return this.matrixService.matrix(operator, roleId);
  }

  /** 分配使用者頁籤的清單(每筆附「組織外」標記)。 */
  @RequirePermission("system.role-manager.view")
  @Query(() => RoleUsersPayload, { name: "roleUsers" })
  roleUsers(
    @Args("roleId", { type: () => ID }) roleId: string,
    @Args("input") input: RoleUsersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleUsersPayload> {
    return this.usersService.list(operator, roleId, input);
  }

  /**
   * 「加入使用者」彈窗的候選:管理範圍內、尚未持有這個角色的人,每筆附 `eligible`。
   * 掛 `assign-users`(不是 `view`):在此之前前端借 `users`,連帶要求
   * `system.user-manager.view` —— 能分配使用者的人不該被迫再要一個使用者管理的權限。
   */
  @RequirePermission("system.role-manager.assign-users")
  @Query(() => RoleUserCandidatesPayload, { name: "roleUserCandidates" })
  roleUserCandidates(
    @Args("roleId", { type: () => ID }) roleId: string,
    @Args("input") input: RoleUserCandidatesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleUserCandidatesPayload> {
    return this.usersService.candidates(operator, roleId, input);
  }

  @RequirePermission("system.role-manager.create")
  @Mutation(() => RolePayload)
  async createRole(
    @Args("input") input: CreateRoleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RolePayload> {
    return { role: await this.service.create(operator, input) };
  }

  @RequirePermission("system.role-manager.edit")
  @Mutation(() => RolePayload)
  async updateRole(
    @Args("input") input: UpdateRoleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RolePayload> {
    return { role: await this.service.update(operator, input) };
  }

  @RequirePermission("system.role-manager.toggle-enabled")
  @Mutation(() => RolePayload)
  async setRoleEnabled(
    @Args("input") input: SetRoleEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RolePayload> {
    return { role: await this.service.setEnabled(operator, input) };
  }

  @RequirePermission("system.role-manager.delete")
  @Mutation(() => DeletePayload)
  deleteRole(
    @Args("input") input: DeleteRoleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeletePayload> {
    return this.service.remove(operator, input);
  }

  @RequirePermission("system.role-manager.edit-matrix")
  @Mutation(() => RoleMatrixPayload)
  saveRoleMatrix(
    @Args("input") input: SaveRoleMatrixInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleMatrixPayload> {
    return this.matrixService.save(operator, input);
  }

  @RequirePermission("system.role-manager.assign-users")
  @Mutation(() => RoleUsersPayload)
  grantRoleUsers(
    @Args("input") input: GrantRoleUsersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleUsersPayload> {
    return this.usersService.grant(operator, input);
  }

  @RequirePermission("system.role-manager.assign-users")
  @Mutation(() => RoleUsersPayload)
  revokeRoleUsers(
    @Args("input") input: RevokeRoleUsersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RoleUsersPayload> {
    return this.usersService.revoke(operator, input);
  }
}
