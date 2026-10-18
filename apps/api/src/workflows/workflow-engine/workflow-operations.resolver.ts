import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { RequirePermission } from "../../permission/require-permission.decorator";
import {
  WorkflowDecideResultEnum,
  WorkflowInstanceModel,
  WorkflowInstancePayload,
  WorkflowInstancesPayload,
  WorkflowTaskPayload,
} from "../models/workflow-instance.model";
import { WorkflowAccessService } from "../workflow-access.service";
import { WORKFLOW_REASSIGN_PERMISSION } from "../workflow-keys";
import { BlockedInstancesService } from "./blocked-instances.service";
import {
  AddStepAssigneeInput,
  BlockedInstancesInput,
  ReassignTaskInput,
  RetryAdvanceInstanceInput,
} from "./dto/workflow-engine.input";
import { TaskActionsService } from "./task-actions.service";
import { WorkflowPresenter } from "./workflow-presenter.service";

/**
 * 流程管理者的阻擋清單與處置(`system.workflows.blocked-page`):
 * `blockedInstances`、`reassignTask`、`addStepAssignee`、`retryAdvanceInstance`。
 * 權限一律是隱藏頁自有的 `system.workflows.blocked-page.reassign`(不靠父模組 wildcard);
 * 範圍以操作者的租戶為邊界。摘要不含提交內容。
 */
@Resolver(() => WorkflowInstanceModel)
export class WorkflowOperationsResolver {
  constructor(
    private readonly blocked: BlockedInstancesService,
    private readonly actions: TaskActionsService,
    private readonly presenter: WorkflowPresenter,
    private readonly access: WorkflowAccessService,
  ) {}

  @RequirePermission(WORKFLOW_REASSIGN_PERMISSION)
  @Query(() => WorkflowInstancesPayload, { name: "blockedInstances" })
  async blockedInstances(
    @Args("input") input: BlockedInstancesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowInstancesPayload> {
    return this.blocked.list(await this.access.factsOf(operator), input);
  }

  @RequirePermission(WORKFLOW_REASSIGN_PERMISSION)
  @Mutation(() => WorkflowTaskPayload)
  async reassignTask(
    @Args("input") input: ReassignTaskInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowTaskPayload> {
    const task = await this.actions.reassign(
      await this.access.factsOf(operator),
      input,
    );
    const [model] = await this.presenter.taskModels([task], true);
    if (!model) {
      throw new Error("改派後讀不到任務");
    }
    return { task: model, result: WorkflowDecideResultEnum.ACCEPTED };
  }

  @RequirePermission(WORKFLOW_REASSIGN_PERMISSION)
  @Mutation(() => WorkflowTaskPayload)
  async addStepAssignee(
    @Args("input") input: AddStepAssigneeInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowTaskPayload> {
    const task = await this.actions.addAssignee(
      await this.access.factsOf(operator),
      input,
    );
    const [model] = await this.presenter.taskModels([task], true);
    if (!model) {
      throw new Error("新增審核者後讀不到任務");
    }
    return { task: model, result: WorkflowDecideResultEnum.ACCEPTED };
  }

  @RequirePermission(WORKFLOW_REASSIGN_PERMISSION)
  @Mutation(() => WorkflowInstancePayload)
  async retryAdvanceInstance(
    @Args("input") input: RetryAdvanceInstanceInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowInstancePayload> {
    const instance = await this.actions.retry(
      await this.access.factsOf(operator),
      input,
    );
    return {
      instance: await this.presenter.instanceModel(instance, {
        actorId: operator.actorId,
        canManage: true,
        titleOnly: true,
      }),
    };
  }
}
