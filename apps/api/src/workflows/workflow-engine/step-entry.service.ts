import { Injectable, Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";
import {
  type ApplicantOrgFact,
  type AutoApproval,
  type BlockedAutoApproval,
  type ReviewStepDef,
  type SkipReason,
  type StepEntry,
  type WorkflowDefinition,
  autoApprovalCandidates,
  isApplicantInSkipOrgs,
  shouldSkipStep,
} from "@repo/domain/workflow";

import { OperatorContextService } from "../../auth/operator-context.service";
import {
  FormVersionsRepository,
  OrgsRepository,
} from "../../database/database.module";
import type {
  FormRevision,
  FormRevisionContext,
} from "../../database/schemas/form-submission.schema";
import { WorkflowSubmissionStore } from "../../database/workflow-submission-store";
import { expressionContextOf } from "../../forms/form-runtime/revision-context";
import { systemContext } from "../tenant-directory.service";
import { AssigneeDelegationService } from "./assignee-delegation.service";
import {
  AudienceSourceService,
  type SubmissionAudienceContext,
} from "./audience-source.service";
import {
  type InstanceRecord,
  toInstanceSnapshot,
  toObjectId,
} from "./instance-writes";
import { FormLifecycleService } from "./lifecycle/form-lifecycle.service";

type SubmissionRecord = NonNullable<
  Awaited<ReturnType<WorkflowSubmissionStore["findById"]>>
>;

/** 進關要不要跑自動通過的守門:推進要跑;「需要推進」的識別(不寫入、可能不在交易內)不跑。 */
export interface StepEntryOptions {
  runApproveGuards: boolean;
}

/**
 * 判斷表列 5 的「查資料庫」那一半(domain `advance` 的兩段式 `resolveStepEntry`):
 * 進到某個審核關卡時,算一次跳過、解析一次審核者、決定一次自動通過,結果交回 `advance` 寫進派任計畫後不再重算。
 *
 * - **跳過**(任一項成立就跳過,依序判斷、記第一個成立的原因):
 *   1. 「申請人屬於這些組織」(`skipOrgs`):比對**該實例修訂**送出當時的所屬組織(`ctx.orgIds` 快照),
 *      「包含下層」看組織的 `ancestors`
 *   2. 「符合條件」(`skipWhen`):拿該修訂的表單內容與送出當時的上下文算(同一實例內容固定,不重算公式)
 * - 審核者三種來源由 `AudienceSourceService.resolveAudienceSource` 算(只算啟用中、仍在本租戶的人);
 *   剔除申請人由 domain 的 `buildPlan` 做
 * - **代理人**:解析完先把此刻在代理期間的人換成代理人(`AssigneeDelegationService`),
 *   自動通過與派任計畫都以換過的名單算(「已在前關核准過」只算代理人本人)
 * - **自動通過**:domain `autoApprovalCandidates` 列出候選,逐位以**他本人**的身分跑
 *   `checkApproveGuard`(`beforeApprove`);擋下的放進 `blockedAutoApprovals`(申請人照一般規則剔除,
 *   其他人照常審核;時間軸記 `auto_approve_blocked`)。`any` 一位通過就停(一人核准即過)
 * - 解析不到任何人 → 空名單(該關阻擋,不自動改派、不自動跳過)
 *
 * 推進在交易內呼叫這裡:讀取依序 `await`(TX-02);守門擋下是結果不是錯誤,其他例外照樣往外拋(TX-04)。
 */
@Injectable()
export class StepEntryService {
  private readonly logger = new Logger(StepEntryService.name);

  constructor(
    private readonly submissions: WorkflowSubmissionStore,
    private readonly formVersions: FormVersionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly sources: AudienceSourceService,
    private readonly lifecycle: FormLifecycleService,
    private readonly operators: OperatorContextService,
    private readonly delegations: AssigneeDelegationService,
  ) {}

  async resolve(
    instance: InstanceRecord,
    definition: WorkflowDefinition,
    step: ReviewStepDef,
    options: StepEntryOptions,
    /** 這一輪推進的時點(`AdvanceInput.now`);代理期間以它判斷,同一輪只用一個時點 */
    now: Date,
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
    if (!submission || !revision) {
      this.logger.error(
        `實例 ${String(instance._id)} 找不到提交的修訂 ${String(instance.revision)},該關以阻擋處理`,
      );
      return { kind: "assign", assigneeIds: [] };
    }
    const skipReason = await this.skipReasonOf(
      instance,
      tenantId,
      step,
      revision,
    );
    if (skipReason !== null) {
      return { kind: "skip", reason: skipReason };
    }
    const resolved = await this.sources.resolveAudienceSource(step.assignee, {
      tenantId,
      orgId: instance.orgId,
      applicantId: instance.createdBy,
      values: revision.values,
    });
    const { assigneeIds, delegatorOf } = await this.delegations.apply(
      resolved.map(String),
      {
        tenantId,
        applicantId:
          instance.createdBy === null ? null : String(instance.createdBy),
        now,
      },
    );
    const delegated = Object.keys(delegatorOf).length > 0 && { delegatorOf };
    const candidates = autoApprovalCandidates(
      definition,
      toInstanceSnapshot(instance),
      step,
      assigneeIds,
    );
    if (candidates.length === 0) {
      return { kind: "assign", assigneeIds, ...delegated };
    }
    if (!options.runApproveGuards) {
      return {
        kind: "assign",
        assigneeIds,
        autoApprovals: candidates,
        ...delegated,
      };
    }
    const guarded = await this.guardedApprovals(submission, step, candidates);
    return {
      kind: "assign",
      assigneeIds,
      autoApprovals: guarded.passed,
      blockedAutoApprovals: guarded.blocked,
      ...delegated,
    };
  }

  /**
   * 依「這張單據」算人的上下文(實例的修訂值、單據所屬組織、申請人):知會(`WorkflowCcService`)與
   * 逾時提醒的通知對象(`WorkflowOverdueService`)從這裡取,與進關解析審核者讀同一份提交 ——
   * 讀提交只經登記過的呼叫端(`WORKFLOW_SUBMISSION_STORE_CALLERS`),不另開一個。
   * 實例沒有租戶 → null;找不到該修訂(資料損毀)→ 值為空(表單欄位來源算不到人)。
   */
  async submissionContextOf(
    instance: InstanceRecord,
  ): Promise<SubmissionAudienceContext | null> {
    const tenantId = instance.tenantId;
    if (tenantId === null) {
      return null;
    }
    const submission = await this.submissions.findById(
      tenantId,
      instance.submissionId,
    );
    const revision = submission?.revisions.find(
      (entry) => entry.revision === instance.revision,
    );
    return {
      tenantId,
      orgId: instance.orgId,
      applicantId: instance.createdBy,
      values: revision?.values ?? {},
    };
  }

  /** 跳過的原因;都不成立 → null。 */
  private async skipReasonOf(
    instance: InstanceRecord,
    tenantId: Types.ObjectId,
    step: ReviewStepDef,
    revision: FormRevision,
  ): Promise<SkipReason | null> {
    if (await this.isApplicantInOrgs(tenantId, step, revision.ctx)) {
      return "skip_orgs";
    }
    if (await this.isConditionMet(instance, step, revision)) {
      return "skip_condition";
    }
    return null;
  }

  /** 「申請人屬於這些組織」:沒設 → 不成立;快照沒有所屬組織(舊修訂)→ 不成立(照常派人,保守)。 */
  private async isApplicantInOrgs(
    tenantId: Types.ObjectId,
    step: ReviewStepDef,
    ctx: FormRevisionContext,
  ): Promise<boolean> {
    const skipOrgs = step.skipOrgs;
    const orgIds = ctx.orgIds ?? [];
    if (skipOrgs === undefined || skipOrgs === null || orgIds.length === 0) {
      return false;
    }
    const facts: ApplicantOrgFact[] = orgIds.map((id) => ({
      id: String(id),
      ancestorIds: [],
    }));
    if (skipOrgs.includeDescendants) {
      const orgs = await this.orgs.findMany(systemContext(), {
        _id: { $in: orgIds },
      });
      facts.splice(
        0,
        facts.length,
        ...orgs.map((org) => ({
          id: String(org._id),
          ancestorIds: org.ancestors.map(String),
        })),
      );
    }
    return isApplicantInSkipOrgs(
      skipOrgs,
      facts,
      String(ctx.tenantId ?? tenantId),
    );
  }

  /** 「符合條件」:沒設 → 不成立;算不出來(資料損毀)→ 不成立(照常派人,保守)。 */
  private async isConditionMet(
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

  /**
   * 逐位以本人身分跑 `beforeApprove`(依序,TX-02);擋下的另列(帶專案錯誤碼,時間軸記一筆)。
   * `any` 一位通過就停。守門擋下以回傳值表示(`checkApproveGuard`),不 catch 例外。
   */
  private async guardedApprovals(
    submission: SubmissionRecord,
    step: ReviewStepDef,
    candidates: readonly AutoApproval[],
  ): Promise<{ passed: AutoApproval[]; blocked: BlockedAutoApproval[] }> {
    const passed: AutoApproval[] = [];
    const blocked: BlockedAutoApproval[] = [];
    for (const candidate of candidates) {
      const { operator } = await this.operators.resolve(
        toObjectId(candidate.assigneeId),
        submission.orgId,
      );
      const result = await this.lifecycle.checkApproveGuard({
        operator,
        submission,
        stepKey: step.key,
      });
      if (result !== null) {
        blocked.push({ ...candidate, code: result.code });
        continue;
      }
      passed.push(candidate);
      if (step.mode === "any") {
        break;
      }
    }
    return { passed, blocked };
  }

  private async fieldsOf(instance: InstanceRecord): Promise<FieldDef[]> {
    const version = await this.formVersions.findOne(systemContext(), {
      formKey: instance.formKey,
      version: instance.formVersion,
    });
    return version?.fields ?? [];
  }
}
