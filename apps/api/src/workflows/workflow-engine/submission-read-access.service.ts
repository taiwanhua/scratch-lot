import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { SubmissionSummary } from "@repo/domain/form";

import {
  FormSubmissionsRepository,
  WorkflowInstancesRepository,
} from "../../database/database.module";
import {
  type SubmissionSnapshotRecord,
  WorkflowSubmissionStore,
} from "../../database/workflow-submission-store";
import { WorkflowTasksRepository } from "../../database/workflow-tasks.repository";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../../forms/form-access.service";
import { formModulePermission } from "../../forms/form-permission-keys";
import { systemContext } from "../tenant-directory.service";

/** 這位讀者對一筆提交能讀哪些修訂:全部(6a 規則 / 申請人),或只有擔任過審核者的那幾個修訂。 */
export type ReadableRevisions =
  | { kind: "all"; via: "module" | "applicant" }
  | { kind: "revisions"; revisions: ReadonlySet<number> }
  | { kind: "none" };

/**
 * 「誰能看那筆提交」的唯一判準 `canReadSubmissionRevision(user, submission, revision)`:
 * `formSubmission(id, revision)`、`workflowInstance(id)`、附件簽名網址都走這一支。
 *
 * | 誰                                  | 能看什麼                                     |
 * | ----------------------------------- | -------------------------------------------- |
 * | 模組 `view` + 可見範圍 + 資料範圍者 | 6a 原規則(全部修訂)                        |
 * | 申請人(`createdBy = 我`)            | 自己的提交,含所有修訂與歷程(單筆;列表不放寬) |
 * | 任務持有者(現在或曾經)              | **只有**那個實例對應的修訂快照 + 該實例的歷程 |
 * | 知會對象(實例 `ccRecipientIds`)| 同任務持有者:只有被知會的那個實例的修訂      |
 *
 * 任務持有者以 `workflow_tasks.assigneeId` + `previousAssigneeIds` 判(含已取消、被改派走的);
 * 停用 / 移出租戶的人本來就進不來(租戶邊界),不靠舊任務。別人的草稿一律讀不到。
 */
@Injectable()
export class SubmissionReadAccess {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly store: WorkflowSubmissionStore,
    private readonly tasks: WorkflowTasksRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly access: FormAccessService,
  ) {}

  /** 以讀者的租戶為邊界找提交(系統讀;授權另判)。 */
  findInTenant(
    facts: FormOperatorFacts,
    id: Types.ObjectId,
  ): Promise<SubmissionSnapshotRecord | null> {
    if (facts.tenantId === null) {
      return Promise.resolve(null);
    }
    return this.store.findById(facts.tenantId, id);
  }

  async readableRevisions(
    facts: FormOperatorFacts,
    submission: SubmissionSnapshotRecord,
  ): Promise<ReadableRevisions> {
    const actorId = facts.operator.actorId;
    const isOwner =
      actorId !== null && submission.createdBy?.equals(actorId) === true;
    if (isOwner) {
      return { kind: "all", via: "applicant" };
    }
    if (submission.status === "draft") {
      return { kind: "none" };
    }
    if (await this.isModuleReader(facts, submission)) {
      return { kind: "all", via: "module" };
    }
    if (actorId === null || submission.tenantId === null) {
      return { kind: "none" };
    }
    const held = await this.tasks.findMany(submission.tenantId, {
      submissionId: submission._id,
      $or: [{ assigneeId: actorId }, { previousAssigneeIds: actorId }],
    });
    // 知會對象:與任務持有者同等規則,只讀被知會的那幾個修訂
    const copied = await this.instances.findMany(systemContext(), {
      tenantId: submission.tenantId,
      submissionId: submission._id,
      ccRecipientIds: actorId,
    });
    const revisions = new Set([
      ...held.map((task) => task.revision),
      ...copied.map((instance) => instance.revision),
    ]);
    return revisions.size === 0
      ? { kind: "none" }
      : { kind: "revisions", revisions };
  }

  /** `canReadSubmissionRevision(user, submission, revision)`。 */
  async canReadSubmissionRevision(
    facts: FormOperatorFacts,
    submission: SubmissionSnapshotRecord,
    revision: number,
  ): Promise<boolean> {
    const readable = await this.readableRevisions(facts, submission);
    return (
      readable.kind === "all" ||
      (readable.kind === "revisions" && readable.revisions.has(revision))
    );
  }

  /**
   * 讀者是否持有(或曾持有)這張表單的任務 —— 讓沒有業務模組權限的審核者也拿得到表單定義來渲染
   * (`formRuntimeVersion`;申請中心詳情頁不經業務模組頁面權限)。
   */
  async holdsTaskOnForm(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<boolean> {
    const actorId = facts.operator.actorId;
    if (actorId === null || facts.tenantId === null) {
      return false;
    }
    const count = await this.tasks.count(facts.tenantId, {
      formKey,
      $or: [{ assigneeId: actorId }, { previousAssigneeIds: actorId }],
    });
    if (count > 0) {
      return true;
    }
    // 知會對象也要拿得到定義來渲染被知會的那筆
    const copied = await this.instances.count(systemContext(), {
      tenantId: facts.tenantId,
      formKey,
      ccRecipientIds: actorId,
    });
    return copied > 0;
  }

  /**
   * 某修訂的摘要快照(該修訂實例上的 `summary`):只審過舊修訂的人讀提交時,摘要不能用提交最新的。
   * 該修訂沒有實例(沒走流程)→ null。
   */
  async revisionSummaryOf(
    submissionId: Types.ObjectId,
    revision: number,
  ): Promise<SubmissionSummary | null> {
    const instance = await this.instances.findOne(systemContext(), {
      submissionId,
      revision,
    });
    return instance?.summary ?? null;
  }

  /** 6a 原規則:可見範圍 + 資料範圍規則讀得到,且有模組 `view`。 */
  private async isModuleReader(
    facts: FormOperatorFacts,
    submission: SubmissionSnapshotRecord,
  ): Promise<boolean> {
    if (
      !this.access.has(
        facts,
        formModulePermission(submission.moduleKey, "view"),
      )
    ) {
      return false;
    }
    const visible = await this.submissions.findById(
      facts.operator,
      submission._id,
    );
    return visible !== null;
  }
}
