import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { LIVE_INSTANCE_STATUSES } from "@repo/domain/workflow";

import { WorkflowInstancesRepository } from "../../database/database.module";
import { TransactionService } from "../../database/transaction";
import { systemContext } from "../tenant-directory.service";
import {
  workflowConflictError,
  workflowForbiddenError,
} from "../workflows-error";
import {
  WorkflowEngineHooks,
  WorkflowEngineService,
} from "./workflow-engine.service";

const LIVE = [...LIVE_INSTANCE_STATUSES];

/**
 * 撤回(Spec 6b §6「撤回」):只有申請人本人(實例的 `createdBy`,抄自提交)能撤回,別人 → `FORBIDDEN`
 * (`NOT_APPLICANT`),先於狀態檢查。條件更新實例 `{ status ∈ [running, blocked], editVersion: 預期值,
 * 所有關卡的 decisions 都空 }` → `withdrawn`、所有 active 關卡 `terminated`、`$inc editVersion`,
 * 之後 `advance` 收尾(列 2:任務取消、提交 → `withdrawn`)。**整個撤回是一個交易**(ADR-0013;
 * 呼叫端已在交易內就併進去)。決定與撤回並發:決定先提交 → 撤回的寫入衝突、整個交易重跑,
 * 重讀後看到決定 → 拒絕「已有審核意見,不能撤回」;「沒有決定」也寫在條件裡。
 */
@Injectable()
export class InstanceWithdrawService {
  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly engine: WorkflowEngineService,
    private readonly hooks: WorkflowEngineHooks,
    private readonly transactions: TransactionService,
  ) {}

  withdraw(instanceId: Types.ObjectId, actorId: Types.ObjectId): Promise<void> {
    return this.transactions.withTransaction(() =>
      this.withdrawOnce(instanceId, actorId),
    );
  }

  private async withdrawOnce(
    instanceId: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const instance = await this.engine.findInstance(instanceId);
    if (instance !== null && !instance.createdBy?.equals(actorId)) {
      throw workflowForbiddenError(
        "Only the applicant can withdraw the submission",
        "NOT_APPLICANT",
      );
    }
    if (instance === null || !LIVE.includes(instance.status as never)) {
      throw workflowConflictError(
        "The submission is no longer under review",
        "STATUS_MISMATCH",
      );
    }
    if (instance.steps.some((step) => step.decisions.length > 0)) {
      throw workflowConflictError(
        "Accepted review decisions exist; the submission can no longer be withdrawn",
        "HAS_DECISIONS",
      );
    }
    const set: Record<string, unknown> = {
      status: "withdrawn",
      activeStepKeys: [],
    };
    const arrayFilters = instance.activeStepKeys.map((stepKey, index) => {
      set[`steps.$[s${String(index)}].status`] = "terminated";
      return { [`s${String(index)}.stepKey`]: stepKey };
    });
    await this.hooks.reached("withdraw:before-write");
    const updated = await this.instances.findOneAndUpdate(
      systemContext(),
      {
        _id: instance._id,
        editVersion: instance.editVersion,
        status: { $in: LIVE },
        "steps.decisions.0": { $exists: false },
      },
      {
        $set: set,
        $push: {
          history: { at: new Date(), kind: "withdrawn", userId: actorId },
        },
        $inc: { editVersion: 1 },
      },
      arrayFilters.length > 0 ? { arrayFilters } : {},
    );
    if (updated === null) {
      throw workflowConflictError(
        "The instance changed; reload and try again",
        "INSTANCE_CHANGED",
      );
    }
    await this.engine.advance(instance._id);
  }
}
