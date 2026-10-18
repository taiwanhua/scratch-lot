import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { FormAccessService } from "../form-access.service";
import {
  DELETE_RETIRED_PERMISSION,
  MODULE_MANAGER_VIEW,
} from "../form-permission-keys";
import { forbiddenError } from "../forms-error";
import { DeleteRetiredPermissionInput } from "./dto/form-design.input";
import { FormFieldPermissionsService } from "./form-field-permissions.service";
import {
  DeleteRetiredPermissionPayload,
  RetiredFormPermission,
  RetiredFormPermissionsPayload,
} from "./models/form.model";

/**
 * 「模組與權限」頁的退役權限清理(根組織專屬)。
 * 權限守端點;「站在根組織」另外守(與模組與權限頁其他端點同一條判準)。
 */
@Resolver(() => RetiredFormPermission)
export class RetiredPermissionsResolver {
  constructor(
    private readonly service: FormFieldPermissionsService,
    private readonly access: FormAccessService,
  ) {}

  @RequirePermission(MODULE_MANAGER_VIEW)
  @Query(() => RetiredFormPermissionsPayload, {
    name: "retiredFormPermissions",
  })
  async retiredFormPermissions(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RetiredFormPermissionsPayload> {
    await this.assertRoot(operator);
    return this.service.retired(operator);
  }

  @RequirePermission(DELETE_RETIRED_PERMISSION)
  @Mutation(() => DeleteRetiredPermissionPayload)
  async deleteRetiredPermission(
    @Args("input") input: DeleteRetiredPermissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteRetiredPermissionPayload> {
    await this.assertRoot(operator);
    return this.service.deleteRetired(operator, input);
  }

  private async assertRoot(operator: OperatorContext): Promise<void> {
    const facts = await this.access.factsOf(operator);
    if (!facts.isRoot) {
      throw forbiddenError(
        "Retired permission cleanup is only available from the root org",
        "ROOT_ONLY",
      );
    }
  }
}
