import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from "@nestjs/graphql";
import { Types } from "mongoose";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { FormsService } from "../../forms/form-design/forms.service";
import {
  FormModel,
  FormPayload,
} from "../../forms/form-design/models/form.model";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { WorkflowAccessService } from "../workflow-access.service";
import { FORMS_EDIT_PERMISSION } from "../workflow-keys";
import {
  BindFormWorkflowInput,
  UnbindFormWorkflowInput,
} from "./dto/workflow-design.input";
import {
  FormWorkflowBinding,
  FormWorkflowOptionsPayload,
} from "./models/workflow.model";
import { WorkflowBindingsService } from "./workflow-bindings.service";

/**
 * 流程綁定(表單管理列表的流程綁定欄):`bindFormWorkflow` / `unbindFormWorkflow`
 * 與表單的 `workflowBinding` 欄位。站在租戶內、持 `system.forms.edit` 的租戶管理員才能綁;
 * 回傳沿用表單管理的 `FormPayload`。
 */
@Resolver(() => FormModel)
export class WorkflowBindingsResolver {
  constructor(
    private readonly bindings: WorkflowBindingsService,
    private readonly forms: FormsService,
    private readonly access: WorkflowAccessService,
  ) {}

  @RequirePermission(FORMS_EDIT_PERMISSION)
  @Mutation(() => FormPayload)
  async bindFormWorkflow(
    @Args("input") input: BindFormWorkflowInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormPayload> {
    const facts = await this.access.factsOf(operator);
    const formKey = await this.bindings.bind(facts, input);
    return { form: await this.forms.get(facts, formKey) };
  }

  @RequirePermission(FORMS_EDIT_PERMISSION)
  @Mutation(() => FormPayload)
  async unbindFormWorkflow(
    @Args("input") input: UnbindFormWorkflowInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormPayload> {
    const facts = await this.access.factsOf(operator);
    const formKey = await this.bindings.unbind(facts, input);
    return { form: await this.forms.get(facts, formKey) };
  }

  /** 表單管理的流程下拉:本租戶看得到且已發布的流程,與各自能不能直接綁這張表單。 */
  @RequirePermission(FORMS_EDIT_PERMISSION)
  @Query(() => FormWorkflowOptionsPayload, { name: "formWorkflowOptions" })
  async formWorkflowOptions(
    @Args("formKey", { type: () => ID }) formKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormWorkflowOptionsPayload> {
    const options = await this.bindings.optionsFor(
      await this.access.factsOf(operator),
      formKey,
    );
    return {
      items: options.map(({ workflow, issues }) => ({
        workflowKey: workflow.key,
        workflowName: workflow.name,
        isShared: workflow.tenantId === null,
        canBind: issues.length === 0,
        issues,
      })),
      totalCount: options.length,
    };
  }

  /** 本租戶這張表單綁的流程;沒綁 / 站在根組織為 null。`isValid: false` = 綁定的流程已失效。 */
  @ResolveField(() => FormWorkflowBinding, {
    name: "workflowBinding",
    nullable: true,
  })
  async workflowBinding(
    @Parent() form: FormModel,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormWorkflowBinding | null> {
    return this.bindings.bindingOf(
      await this.access.factsOf(operator),
      new Types.ObjectId(form.id),
    );
  }
}
