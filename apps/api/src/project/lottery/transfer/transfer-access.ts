import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TRANSFER_FORM_KEY,
  TRANSFER_MODULE_KEY,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
  WorkflowInstancesRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { notFoundError } from "./transfer-error";
import { toObjectId } from "./transfer-rules.service";

export type TransferSubmission = NonNullable<
  Awaited<ReturnType<FormSubmissionsRepository["findOne"]>>
>;

/**
 * 調貨單的讀取放行與點收資格(專案規格 8.4):
 *
 * - `readable`:看得到這張調貨單 = 一般讀取讀得到(可見範圍內,或出貨分店 / 收貨分店在讀者的可見範圍內 ——
 *   受管表單的「依欄位共用」`from_branch` / `to_branch`,ADR-0014),或建立者本人,或持有(曾持有)它的審核任務
 * - `canReceive`:單據在審核中,而且點收關卡(流程實例的最後一關)的任務在操作者手上
 */
@Injectable()
export class TransferAccess {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly tasks: WorkflowTasksRepository,
  ) {}

  async readable(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<TransferSubmission> {
    const submissionId = toObjectId(submissionIdText);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (submissionId === null) {
      throw notFoundError("調貨單不存在");
    }
    const filter = {
      _id: submissionId,
      moduleKey: TRANSFER_MODULE_KEY,
      formKey: TRANSFER_FORM_KEY,
    };
    const visible = await this.submissions.findOne(operator, filter);
    if (visible !== null) {
      return visible;
    }
    const actorId = operator.actorId;
    if (tenantId === null || actorId === null) {
      throw notFoundError("調貨單不存在");
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findOne(reader, filter);
    if (submission === null) {
      throw notFoundError("調貨單不存在");
    }
    if (submission.createdBy?.equals(actorId) === true) {
      return submission;
    }
    const held = await this.tasks.findOne(tenantId, {
      submissionId,
      $or: [{ assigneeId: actorId }, { previousAssigneeIds: actorId }],
    });
    if (held === null) {
      throw notFoundError("調貨單不存在");
    }
    return submission;
  }

  async canReceive(
    operator: OperatorContext,
    submission: TransferSubmission,
  ): Promise<boolean> {
    if (
      submission.status !== "reviewing" ||
      submission.tenantId === null ||
      operator.actorId === null
    ) {
      return false;
    }
    const task = await this.tasks.findOne(submission.tenantId, {
      submissionId: submission._id,
      assigneeId: operator.actorId,
      status: "pending",
    });
    if (task === null) {
      return false;
    }
    return (
      (await this.lastStepOf(submission.tenantId, task.instanceId)) ===
      task.stepKey
    );
  }

  private async lastStepOf(
    tenantId: Types.ObjectId,
    instanceId: Types.ObjectId,
  ): Promise<string | null> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const instance = await this.instances.findOne(
      reader,
      { _id: instanceId },
      { select: "steps.stepKey" },
    );
    return instance?.steps.at(-1)?.stepKey ?? null;
  }
}
