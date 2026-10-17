import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { WorkflowDefinition } from "@repo/domain/workflow";

import { AuditService } from "../../audit/audit.service";
import { WorkflowVersionsRepository } from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { TransactionService } from "../../database/transaction";
import {
  type WorkflowRecord,
  WorkflowsRepository,
} from "../../database/workflows.repository";
import type { FormOperatorFacts } from "../../forms/form-access.service";
import { FormUserNames } from "../../forms/form-mapper";
import { retireCurrentVersion } from "../../versioning/version-lifecycle";
import { WorkflowAccessService } from "../workflow-access.service";
import {
  checkFormKeyFromInput,
  definitionFromInput,
  definitionOfVersion,
} from "../workflow-definition-input";
import { WORKFLOWS_PERMISSIONS } from "../workflow-keys";
import {
  isDuplicateKey,
  workflowConflictError,
  workflowNotFoundError,
  workflowValidationError,
} from "../workflows-error";
import type {
  CreateWorkflowVersionDraftInput,
  DeleteWorkflowVersionDraftInput,
  SaveWorkflowVersionDraftInput,
  ValidateWorkflowVersionInput,
  WorkflowKeyInput,
} from "./dto/workflow-design.input";
import type {
  WorkflowValidationReport,
  WorkflowVersionModel,
  WorkflowVersionPayload,
  WorkflowVersionsPayload,
} from "./models/workflow.model";
import { WorkflowDefinitionChecker } from "./workflow-definition-checker";
import {
  type WorkflowVersionRecord,
  toWorkflowValidationReport,
  toWorkflowVersionModel,
} from "./workflow-mapper";
import {
  WORKFLOW_VERSION_AUDIT,
  WORKFLOW_VERSION_TARGET,
  WorkflowPublishService,
  ownerOf,
} from "./workflow-publish.service";

const EMPTY_DEFINITION: WorkflowDefinition = { steps: [], edges: null };

/** 開草稿 / fork 要複製的內容:定義(節點與連線)+ 設計器的「檢查用表單」。 */
export interface DraftContent {
  definition: WorkflowDefinition;
  checkFormKey: string | null;
}

const EMPTY_CONTENT: DraftContent = {
  definition: EMPTY_DEFINITION,
  checkFormKey: null,
};

/**
 * 流程版本(設計端):讀、開草稿、存草稿、檢查器、退役目前版本;發布在 `WorkflowPublishService`。
 * 一個流程同時只有一份草稿(部分唯一索引);`draftRevision` 是存草稿與發布的樂觀鎖。
 * 定義(`steps` 含 `kind`、`edges`)與「檢查用表單」(`checkFormKey`)在草稿讀寫、fork、發布快照、
 * 版本讀取之間**原樣保留**。
 */
@Injectable()
export class WorkflowVersionsService {
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly access: WorkflowAccessService,
    private readonly checker: WorkflowDefinitionChecker,
    private readonly publisher: WorkflowPublishService,
    private readonly userNames: FormUserNames,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 某一版;`version` 省略 = 草稿(附檢查器結果)。 */
  async get(
    facts: FormOperatorFacts,
    workflowKey: string,
    version: number | null | undefined,
  ): Promise<WorkflowVersionPayload> {
    const workflow = await this.access.requireReadable(facts, workflowKey);
    const record =
      version === null || version === undefined
        ? await this.versions.findOne(facts.operator, {
            workflowKey: workflow.key,
            status: "draft",
          })
        : await this.versions.findOne(facts.operator, {
            workflowKey: workflow.key,
            version,
          });
    if (!record) {
      throw workflowNotFoundError(
        `Workflow version not found: ${workflowKey}@${String(version ?? "draft")}`,
      );
    }
    return this.payloadOf(facts, workflow, record);
  }

  /** 版本面板:全部版本(草稿在最前,其餘新到舊)。 */
  async list(
    facts: FormOperatorFacts,
    workflowKey: string,
  ): Promise<WorkflowVersionsPayload> {
    const workflow = await this.access.requireReadable(facts, workflowKey);
    const records = await this.versions.findMany(
      facts.operator,
      { workflowKey: workflow.key },
      { sort: { version: -1, _id: -1 } },
    );
    const ordered = [
      ...records.filter((record) => record.version === null),
      ...records.filter((record) => record.version !== null),
    ];
    const names = await this.userNames.load(
      facts.operator,
      ordered.map((record) => record.publishedBy),
    );
    return {
      items: ordered.map((record) => toWorkflowVersionModel(record, names)),
      totalCount: ordered.length,
    };
  }

  /**
   * 以任一版(已發布 / 退役)為基底開草稿;已有草稿 / 發布中 → `CONFLICT`。
   * `internal.draftId`:預先配好的草稿 id,只給內部的受管定義安裝用(GraphQL input 不收)。
   */
  async createDraft(
    facts: FormOperatorFacts,
    input: CreateWorkflowVersionDraftInput,
    internal: { draftId?: Types.ObjectId } = {},
  ): Promise<WorkflowVersionPayload> {
    this.access.assertPermission(facts, WORKFLOWS_PERMISSIONS.edit);
    const operator = facts.operator;
    const workflow = await this.access.requireWritable(
      facts,
      input.workflowKey,
    );
    const existing = await this.versions.findOne(operator, {
      workflowKey: workflow.key,
      status: "draft",
    });
    if (existing) {
      throw workflowConflictError(
        `Workflow ${workflow.key} already has a draft`,
        "DRAFT_EXISTS",
      );
    }
    const base = await this.baseContentOf(
      operator,
      workflow,
      input.baseVersion,
    );
    const created = await this.insertDraft(
      operator,
      workflow.key,
      base,
      input.baseVersion ?? null,
      internal.draftId,
    );
    await this.audit.record(operator, {
      action: WORKFLOW_VERSION_AUDIT.createDraft,
      targetType: WORKFLOW_VERSION_TARGET,
      targetId: created._id,
      after: {
        workflowKey: workflow.key,
        baseVersion: input.baseVersion ?? null,
      },
    });
    return this.payloadOf(facts, workflow, created);
  }

  /** 建一份草稿(開草稿 / fork 共用);同流程已有草稿(部分唯一索引)→ `CONFLICT`。 */
  async insertDraft(
    operator: OperatorContext,
    workflowKey: string,
    content: DraftContent,
    baseVersion: number | null,
    draftId?: Types.ObjectId,
  ): Promise<WorkflowVersionRecord> {
    const { definition, checkFormKey } = content;
    try {
      return await this.versions.create(operator, {
        ...(draftId === undefined ? {} : { _id: draftId }),
        workflowKey,
        version: null,
        status: "draft",
        draftRevision: 0,
        baseVersion,
        steps: definition.steps,
        edges: definition.edges ?? null,
        cc: definition.cc ?? null,
        checkFormKey,
        changelog: null,
        publishedAt: null,
        publishedBy: null,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw workflowConflictError(
          `Workflow ${workflowKey} already has a draft`,
          "DRAFT_EXISTS",
        );
      }
      throw error;
    }
  }

  /** 基底版本的內容(複製節點、連線與檢查用表單);不給 = 空白。 */
  async baseContentOf(
    operator: OperatorContext,
    workflow: WorkflowRecord,
    baseVersion: number | null | undefined,
  ): Promise<DraftContent> {
    if (baseVersion === null || baseVersion === undefined) {
      return EMPTY_CONTENT;
    }
    const source = await this.versions.findOne(operator, {
      workflowKey: workflow.key,
      version: baseVersion,
      status: { $in: ["published", "retired"] },
    });
    if (!source) {
      throw workflowValidationError(
        `Version ${String(baseVersion)} of ${workflow.key} cannot be a base`,
        ["baseVersion"],
      );
    }
    return {
      definition: definitionOfVersion(source),
      checkFormKey: source.checkFormKey ?? null,
    };
  }

  /**
   * 存草稿(`expectedDraftRevision` 樂觀鎖);檢查器的錯草稿可以先存,隨 `validation` 回。
   * `internal.draftId`:只給內部的受管定義安裝用 —— 只存**那一份**草稿(id 在更新條件裡);
   * 它已被刪掉、現在的草稿是別人另開的 → `DRAFT_MISSING`,不會因為 revision 剛好相同而改到別人的草稿。
   */
  async saveDraft(
    facts: FormOperatorFacts,
    input: SaveWorkflowVersionDraftInput,
    internal: { draftId?: Types.ObjectId } = {},
  ): Promise<WorkflowVersionPayload> {
    this.access.assertPermission(facts, WORKFLOWS_PERMISSIONS.edit);
    const operator = facts.operator;
    const workflow = await this.access.requireWritable(
      facts,
      input.workflowKey,
    );
    const definition = definitionFromInput(input.definition);
    const checkFormKey = checkFormKeyFromInput(input.definition.checkFormKey);
    const ownDraft =
      internal.draftId === undefined ? {} : { _id: internal.draftId };
    const updated = await this.versions.findOneAndUpdate(
      operator,
      {
        ...ownDraft,
        workflowKey: workflow.key,
        status: "draft",
        draftRevision: input.expectedDraftRevision,
      },
      {
        $set: {
          steps: definition.steps,
          edges: definition.edges ?? null,
          // 缺席 = 不動已存的值(GQL-06;`docs/modules/workflows.md`「api 介面」)
          ...(checkFormKey !== undefined && { checkFormKey }),
          ...(definition.cc !== undefined && { cc: definition.cc }),
        },
        $inc: { draftRevision: 1 },
      },
    );
    if (!updated) {
      const draft = await this.versions.findOne(operator, {
        ...ownDraft,
        workflowKey: workflow.key,
        status: "draft",
      });
      throw draft
        ? workflowConflictError(
            `Draft revision mismatch: expected ${String(input.expectedDraftRevision)}, actual ${String(draft.draftRevision)}`,
            "DRAFT_REVISION_MISMATCH",
          )
        : workflowConflictError(
            `Workflow ${workflow.key} has no draft`,
            "DRAFT_MISSING",
          );
    }
    await this.audit.record(operator, {
      action: WORKFLOW_VERSION_AUDIT.saveDraft,
      targetType: WORKFLOW_VERSION_TARGET,
      targetId: updated._id,
      after: {
        workflowKey: workflow.key,
        draftRevision: updated.draftRevision,
        stepCount: definition.steps.length,
        edgeCount: definition.edges?.length ?? 0,
        checkFormKey: updated.checkFormKey ?? null,
      },
    });
    return this.payloadOf(facts, workflow, updated);
  }

  /**
   * 刪除草稿(`expectedDraftRevision` 樂觀鎖;同時被發布掉了 → 條件刪不到,回 `DRAFT_MISSING`)。
   * **硬刪**(`hardDeleteDraft`,ADR-0007 第三種):草稿從未發布,沒有實例 / 任務引用它;軟刪除會佔住「至多一份草稿」的
   * 部分唯一索引,改成 `retired` 又會把「發布過」的語意弄髒。刪前的整份內容寫進稽核的 `before`,
   * 需要時從稽核回看。已發布 / 退役的版本不受影響,之後可再以任一版開新草稿。
   */
  async deleteDraft(
    facts: FormOperatorFacts,
    input: DeleteWorkflowVersionDraftInput,
  ): Promise<WorkflowRecord> {
    this.access.assertPermission(facts, WORKFLOWS_PERMISSIONS.edit);
    const operator = facts.operator;
    const workflow = await this.access.requireWritable(
      facts,
      input.workflowKey,
    );
    const deleted = await this.versions.hardDeleteDraft(operator, {
      workflowKey: workflow.key,
      status: "draft",
      version: null,
      draftRevision: input.expectedDraftRevision,
    });
    if (!deleted) {
      const draft = await this.versions.findOne(operator, {
        workflowKey: workflow.key,
        status: "draft",
      });
      throw draft
        ? workflowConflictError(
            `Draft revision mismatch: expected ${String(input.expectedDraftRevision)}, actual ${String(draft.draftRevision)}`,
            "DRAFT_REVISION_MISMATCH",
          )
        : workflowConflictError(
            `Workflow ${workflow.key} has no draft`,
            "DRAFT_MISSING",
          );
    }
    await this.audit.record(operator, {
      action: WORKFLOW_VERSION_AUDIT.deleteDraft,
      targetType: WORKFLOW_VERSION_TARGET,
      targetId: deleted._id,
      // 草稿被整筆抹掉:整份定義留在稽核,需要時可回看
      before: {
        workflowKey: workflow.key,
        draftRevision: deleted.draftRevision,
        baseVersion: deleted.baseVersion,
        steps: deleted.steps,
        edges: deleted.edges ?? null,
        cc: deleted.cc ?? null,
        checkFormKey: deleted.checkFormKey ?? null,
      },
    });
    return workflow;
  }

  /** 設計器即時檢查,不落庫。 */
  async validate(
    facts: FormOperatorFacts,
    input: ValidateWorkflowVersionInput,
  ): Promise<WorkflowValidationReport> {
    const workflow = await this.access.requireReadable(
      facts,
      input.workflowKey,
    );
    const checkFormKey =
      checkFormKeyFromInput(input.checkFormKey) ??
      checkFormKeyFromInput(input.definition.checkFormKey) ??
      null;
    return toWorkflowValidationReport(
      await this.checker.check(
        facts,
        workflow,
        definitionFromInput(input.definition),
        checkFormKey,
      ),
    );
  }

  /**
   * 退役目前版本(一個交易):`published → retired`,再 `currentVersion → null`,連同稽核一起提交或回復。
   * 進行中的實例照常走完(實例記的是自己的版本),只影響新送出。
   *
   * `internal.expectedVersion`:只給內部的受管定義安裝用 —— 指名要退役的版本,`currentVersion` 已是別的
   * 版本 → `CURRENT_VERSION_CHANGED`(不退役別人剛發布的新版);那一版已退役、`currentVersion` 也已清掉時
   * 什麼都沒改,不寫稽核。GraphQL 端點不帶,維持「退役讀到的目前版本」。
   */
  async retireCurrent(
    facts: FormOperatorFacts,
    input: WorkflowKeyInput,
    internal: { expectedVersion?: number } = {},
  ): Promise<WorkflowRecord> {
    this.access.assertPermission(facts, WORKFLOWS_PERMISSIONS.publish);
    const operator = facts.operator;
    const workflow = await this.access.requireWritable(
      facts,
      input.workflowKey,
    );
    return this.transactions.withTransaction(async () => {
      const retired = await retireCurrentVersion(
        this.publisher.lifecycle(operator, workflow),
        ownerOf(workflow),
        internal.expectedVersion ?? workflow.currentVersion,
      );
      const updated = await this.workflows.findOne(workflow.tenantId, {
        key: workflow.key,
      });
      if (!updated) {
        throw workflowNotFoundError(`Workflow not found: ${workflow.key}`);
      }
      // 指名版本的重複退役(兩步都已是目標狀態、什麼都沒改)不寫稽核(同表單)
      if (retired || workflow.currentVersion !== null) {
        await this.audit.record(operator, {
          action: WORKFLOW_VERSION_AUDIT.retire,
          targetType: WORKFLOW_VERSION_TARGET,
          ...(retired ? { targetId: retired._id } : {}),
          before: {
            workflowKey: workflow.key,
            currentVersion: workflow.currentVersion,
          },
          after: { currentVersion: null },
        });
      }
      return updated;
    });
  }

  private async payloadOf(
    facts: FormOperatorFacts,
    workflow: WorkflowRecord,
    record: WorkflowVersionRecord,
  ): Promise<WorkflowVersionPayload> {
    const validation =
      record.status === "draft"
        ? toWorkflowValidationReport(
            await this.checker.check(
              facts,
              workflow,
              definitionOfVersion(record),
              record.checkFormKey ?? null,
            ),
          )
        : null;
    return {
      workflowVersion: await this.modelOf(facts.operator, record),
      validation,
    };
  }

  private async modelOf(
    operator: OperatorContext,
    record: WorkflowVersionRecord,
  ): Promise<WorkflowVersionModel> {
    const names = await this.userNames.load(operator, [record.publishedBy]);
    return toWorkflowVersionModel(record, names);
  }
}
