import { Injectable, Logger } from "@nestjs/common";

import type { ExpressionContext, FieldDef } from "@repo/domain/form";
import {
  type ReviewStepDef,
  type StepEntry,
  shouldSkipStep,
} from "@repo/domain/workflow";

import { FormVersionsRepository } from "../../database/database.module";
import type { FormRevision } from "../../database/schemas/form-submission.schema";
import { WorkflowSubmissionStore } from "../../database/workflow-submission-store";
import { systemContext } from "../tenant-directory.service";
import { AudienceSourceService } from "./audience-source.service";
import type { InstanceRecord } from "./instance-writes";

/** 一次送出的上下文 → 表達式的 `ctx.*`(跳過條件用送出當時,不用推進當下)。 */
export function expressionContextOf(
  ctx: FormRevision["ctx"],
): ExpressionContext {
  return {
    now: new Date(ctx.at).toISOString(),
    timezone: ctx.timezone,
    user: {
      id: ctx.userId ? String(ctx.userId) : null,
      orgId: ctx.orgId ? String(ctx.orgId) : null,
    },
  };
}

/**
 * 判斷表列 5 的「查資料庫」那一半(Spec 6b §5;domain `advance` 的兩段式 `resolveStepEntry`):
 * 進到某個審核關卡時,算一次跳過條件、解析一次審核者,結果交回 `advance` 寫進派任計畫後不再重算。
 *
 * - 跳過條件拿**該實例修訂**的表單內容與送出當時的上下文算(同一實例內容固定,不重算公式)
 * - 審核者三種來源由 `AudienceSourceService.resolveAudienceSource` 算(只算啟用中、仍在本租戶的人);
 *   剔除申請人由 domain 的 `buildPlan` 做
 * - 解析不到任何人 → 空名單(該關阻擋,不自動改派、不自動跳過)
 */
@Injectable()
export class StepEntryService {
  private readonly logger = new Logger(StepEntryService.name);

  constructor(
    private readonly submissions: WorkflowSubmissionStore,
    private readonly formVersions: FormVersionsRepository,
    private readonly sources: AudienceSourceService,
  ) {}

  async resolve(
    instance: InstanceRecord,
    step: ReviewStepDef,
  ): Promise<StepEntry> {
    const tenantId = instance.tenantId;
    if (tenantId === null) {
      return { kind: "assign", assigneeIds: [] };
    }
    const submission = await this.submissions.findById(
      tenantId,
      instance.submissionId,
    );
    const revision = submission?.revisions.find(
      (entry) => entry.revision === instance.revision,
    );
    if (!revision) {
      this.logger.error(
        `實例 ${String(instance._id)} 找不到提交的修訂 ${String(instance.revision)},該關以阻擋處理`,
      );
      return { kind: "assign", assigneeIds: [] };
    }
    if (await this.isSkipped(instance, step, revision)) {
      return { kind: "skip" };
    }
    const assigneeIds = await this.sources.resolveAudienceSource(
      step.assignee,
      {
        tenantId,
        orgId: instance.orgId,
        applicantId: instance.createdBy,
        values: revision.values,
      },
    );
    return { kind: "assign", assigneeIds: assigneeIds.map(String) };
  }

  /** 跳過條件:沒設 → 不跳過;算不出來(資料損毀)→ 不跳過(照常派人,保守)。 */
  private async isSkipped(
    instance: InstanceRecord,
    step: ReviewStepDef,
    revision: FormRevision,
  ): Promise<boolean> {
    if (step.skipWhen === undefined || step.skipWhen === null) {
      return false;
    }
    const fields = await this.fieldsOf(instance);
    try {
      return shouldSkipStep(step, {
        fields,
        values: revision.values,
        ctx: expressionContextOf(revision.ctx),
      });
    } catch (error) {
      this.logger.error(
        `實例 ${String(instance._id)} 關卡 ${step.key} 的跳過條件算不出來,照常派人:${String(error)}`,
      );
      return false;
    }
  }

  private async fieldsOf(instance: InstanceRecord): Promise<FieldDef[]> {
    const version = await this.formVersions.findOne(systemContext(), {
      formKey: instance.formKey,
      version: instance.formVersion,
    });
    return version?.fields ?? [];
  }
}
