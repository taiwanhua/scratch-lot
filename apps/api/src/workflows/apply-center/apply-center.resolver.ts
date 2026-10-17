import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { RequirePermission } from "../../permission/require-permission.decorator";
import {
  BatchApproveTasksPayload,
  WorkflowDecideResultEnum,
  WorkflowInstancePayload,
  WorkflowTaskPayload,
  WorkflowTasksPayload,
} from "../models/workflow-instance.model";
import { WorkflowAccessService } from "../workflow-access.service";
import {
  BatchApproveTasksInput,
  DecideTaskInput,
} from "../workflow-engine/dto/workflow-engine.input";
import { TaskActionsService } from "../workflow-engine/task-actions.service";
import { WorkflowPresenter } from "../workflow-engine/workflow-presenter.service";
import { APPLY_CENTER_VIEW_PERMISSION } from "../workflow-keys";
import { ApplyCenterService } from "./apply-center.service";
import {
  ApplicableModuleForms,
  ApplyCenterCounts,
  MyApplicationsInput,
  MyApplicationsPayload,
  MyTasksInput,
} from "./apply-center.types";

/**
 * 申請中心(`apply-center`,Spec 6b §7):兩個頁籤與新申請入口守 `apply-center.view`;
 * 實例詳情與決定不經模組權限 —— 授權分別是 `canReadSubmissionRevision` 與「我是這個任務的有效承辦人」
 * (審核者不一定有申請中心或業務模組的頁面權限,例如從通知信的連結進來)。
 */
@Resolver()
export class ApplyCenterResolver {
  constructor(
    private readonly service: ApplyCenterService,
    private readonly actions: TaskActionsService,
    private readonly presenter: WorkflowPresenter,
    private readonly access: WorkflowAccessService,
  ) {}

  @RequirePermission(APPLY_CENTER_VIEW_PERMISSION)
  @Query(() => MyApplicationsPayload, { name: "myApplications" })
  async myApplications(
    @Args("input") input: MyApplicationsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MyApplicationsPayload> {
    return this.service.myApplications(
      await this.access.factsOf(operator),
      input,
    );
  }

  @RequirePermission(APPLY_CENTER_VIEW_PERMISSION)
  @Query(() => [ApplicableModuleForms], { name: "applicableForms" })
  async applicableForms(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ApplicableModuleForms[]> {
    return this.service.applicableForms(await this.access.factsOf(operator));
  }

  @RequirePermission(APPLY_CENTER_VIEW_PERMISSION)
  @Query(() => WorkflowTasksPayload, { name: "myTasks" })
  async myTasks(
    @Args("input") input: MyTasksInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowTasksPayload> {
    return this.service.myTasks(await this.access.factsOf(operator), input);
  }

  /** 申請中心兩個頁籤的 badge 數字;權限同兩個列表(側欄的數字走 `sidebarBadges`,見 `apply-center-badge.ts`)。 */
  @RequirePermission(APPLY_CENTER_VIEW_PERMISSION)
  @Query(() => ApplyCenterCounts, { name: "applyCenterCounts" })
  async applyCenterCounts(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ApplyCenterCounts> {
    return this.service.counts(await this.access.factsOf(operator));
  }

  @Query(() => WorkflowInstancePayload, { name: "workflowInstance" })
  async workflowInstance(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowInstancePayload> {
    return {
      instance: await this.service.instance(
        await this.access.factsOf(operator),
        id,
      ),
    };
  }

  /** 審核決定;`result: stepClosed` = 此關已結束或任務已變更(任務不動,前端提示並重載)。 */
  @Mutation(() => WorkflowTaskPayload)
  async decideTask(
    @Args("input") input: DecideTaskInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<WorkflowTaskPayload> {
    const { task, result } = await this.actions.decide(
      await this.access.factsOf(operator),
      input,
    );
    const [model] = await this.presenter.taskModels([task]);
    if (!model) {
      throw new Error("決定後讀不到任務");
    }
    return {
      task: model,
      result:
        result === "accepted"
          ? WorkflowDecideResultEnum.ACCEPTED
          : WorkflowDecideResultEnum.STEP_CLOSED,
    };
  }

  /**
   * 批次核准(底座規格 3.10 B18):授權同 `decideTask`(逐筆看「我是這個任務的有效承辦人」);
   * 每一筆一個交易、各自經 `beforeApprove`,逐筆回 `{ taskId, ok, reason, projectReason }`。
   */
  @Mutation(() => BatchApproveTasksPayload)
  async batchApproveTasks(
    @Args("input") input: BatchApproveTasksInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BatchApproveTasksPayload> {
    return {
      results: await this.actions.batchApprove(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }
}
