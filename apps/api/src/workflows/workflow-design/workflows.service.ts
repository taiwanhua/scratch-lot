import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { isValidFormKey } from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import { BusinessRelationshipsRepository } from "../../database/business-relationships.repository";
import {
  FormsRepository,
  OrgsRepository,
  WorkflowVersionsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import {
  type WorkflowRecord,
  WorkflowsRepository,
} from "../../database/workflows.repository";
import {
  type FormOperatorFacts,
  escapeRegex,
  toObjectId,
} from "../../forms/form-access.service";
import { WorkflowAccessService } from "../workflow-access.service";
import { WORKFLOWS_PERMISSIONS } from "../workflow-keys";
import {
  isDuplicateKey,
  workflowConflictError,
  workflowForbiddenError,
  workflowNotFoundError,
  workflowValidationError,
} from "../workflows-error";
import {
  type AssignWorkflowToTenantsInput,
  type CreateWorkflowInput,
  DEFAULT_PAGE_SIZE,
  type ForkWorkflowInput,
  MAX_PAGE_SIZE,
  type RevokeWorkflowFromTenantInput,
  type UpdateWorkflowInput,
  type WorkflowsInput,
} from "./dto/workflow-design.input";
import type {
  WorkflowAssignment,
  WorkflowBoundForm,
  WorkflowModel,
  WorkflowsPayload,
} from "./models/workflow.model";
import { WorkflowVersionsService } from "./workflow-versions.service";

/** 稽核動作名(`docs/modules/workflows.md`「稽核」)。 */
export const WORKFLOW_AUDIT = {
  create: "workflow.create",
  update: "workflow.update",
  fork: "workflow.fork",
  assign: "workflow.assign",
  revoke: "workflow.revoke",
} as const;

const WORKFLOW_TARGET = "workflow";

/**
 * 只給內部呼叫端(受管定義的安裝,`seed/`)的選項;GraphQL input 不收這些。
 * `definitionId`:預先配好的流程 id(安裝紀錄先記下 id 再建立,中斷後認得出自己建的那一筆)。
 */
export interface CreateWorkflowInternalOptions {
  definitionId?: Types.ObjectId;
}

/**
 * 只給內部呼叫端的條件更新(CAS):還是同一筆流程(`definitionId`)、`currentVersion` 與名稱都還是
 * `expected` 才寫(條件與寫入在同一次更新裡判斷)。比對之後被別人改名、發布 / 退役了別的版本、
 * 或流程被刪掉重建 → `CONFLICT`(`METADATA_CHANGED`),不蓋掉現場的值。
 */
export interface UpdateWorkflowInternalOptions {
  expected?: {
    definitionId: Types.ObjectId;
    currentVersion: number | null;
    name: string;
  };
}

/** 讀組織只取名稱,不受管理範圍影響。 */
function orgReader(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

function requireName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw workflowValidationError("name is required", ["name"]);
  }
  return trimmed;
}

/**
 * 流程(設計端):清單、建立、改名、以某版為基底建流程(fork)、分派 / 收回。
 * 站在根組織建的是共用流程;站在租戶內建的是客製流程,**自動建本租戶的 `org_workflow`**。
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly forms: FormsRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: BusinessRelationshipsRepository,
    private readonly access: WorkflowAccessService,
    private readonly versionsService: WorkflowVersionsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    facts: FormOperatorFacts,
    input: WorkflowsInput,
  ): Promise<WorkflowsPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const keyword = input.keyword?.trim().toLowerCase() ?? "";
    const pattern = keyword === "" ? null : new RegExp(escapeRegex(keyword));
    const all = await this.access.listVisible(facts);
    const visible = all
      .filter(
        (workflow) =>
          pattern === null ||
          pattern.test(workflow.key.toLowerCase()) ||
          pattern.test(workflow.name.toLowerCase()),
      )
      .toSorted((left, right) => left.key.localeCompare(right.key));
    const items = await this.toModels(
      facts,
      visible.slice((page - 1) * pageSize, page * pageSize),
    );
    return { items, totalCount: visible.length, page, pageSize };
  }

  async get(facts: FormOperatorFacts, key: string): Promise<WorkflowModel> {
    return this.toModel(facts, await this.access.requireReadable(facts, key));
  }

  /** 建流程:根組織 → 共用;租戶內 → 客製 + 本租戶 `org_workflow`。 */
  async create(
    facts: FormOperatorFacts,
    input: CreateWorkflowInput,
    internal: CreateWorkflowInternalOptions = {},
  ): Promise<WorkflowModel> {
    const key = requireWorkflowKey(input.key);
    const name = requireName(input.name);
    const created = await this.insertWorkflow(
      facts,
      key,
      name,
      null,
      internal.definitionId,
    );
    await this.audit.record(facts.operator, {
      action: WORKFLOW_AUDIT.create,
      targetType: WORKFLOW_TARGET,
      targetId: created._id,
      after: { key, name, isShared: created.tenantId === null },
    });
    return this.toModel(facts, created);
  }

  async update(
    facts: FormOperatorFacts,
    input: UpdateWorkflowInput,
    internal: UpdateWorkflowInternalOptions = {},
  ): Promise<WorkflowModel> {
    const workflow = await this.access.requireWritable(facts, input.key);
    const name = requireName(input.name);
    if (name === workflow.name) {
      return this.toModel(facts, workflow);
    }
    const { expected } = internal;
    const updated = await this.workflows.update(
      facts.operator,
      workflow.tenantId,
      expected === undefined
        ? { _id: workflow._id }
        : { _id: expected.definitionId, key: workflow.key },
      { name },
      expected === undefined
        ? {}
        : { currentVersion: expected.currentVersion, name: expected.name },
    );
    if (!updated) {
      throw expected === undefined
        ? workflowNotFoundError(`Workflow not found: ${input.key}`)
        : workflowConflictError(
            `Workflow ${input.key} identity, current version or name changed`,
            "METADATA_CHANGED",
          );
    }
    await this.audit.record(facts.operator, {
      action: WORKFLOW_AUDIT.update,
      targetType: WORKFLOW_TARGET,
      targetId: workflow._id,
      before: { name: workflow.name },
      after: { name },
    });
    return this.toModel(facts, updated);
  }

  /**
   * 以某流程的某一版為基底建新流程 + 一份草稿(節點 `kind` 與 `edges` 原樣複製):
   * 站在根組織 → 共用;站在租戶內 → 客製(`forkedFrom` 記來源,自動 `org_workflow`)。
   * 來源必須讀得到,版本必須已發布或已退役。
   */
  async fork(
    facts: FormOperatorFacts,
    input: ForkWorkflowInput,
  ): Promise<WorkflowModel> {
    const operator = facts.operator;
    const source = await this.access.requireReadable(facts, input.sourceKey);
    const key = requireWorkflowKey(input.key);
    const name = requireName(input.name);
    const content = await this.versionsService.baseContentOf(
      operator,
      source,
      input.sourceVersion,
    );
    const forkedFrom = {
      workflowKey: source.key,
      version: input.sourceVersion,
    };
    const created = await this.insertWorkflow(facts, key, name, forkedFrom);
    // 草稿寫入失敗時流程已建好:可再開草稿補上,不做補償刪除(同表單的 fork)
    await this.versionsService.insertDraft(operator, key, content, null);
    await this.audit.record(operator, {
      action: WORKFLOW_AUDIT.fork,
      targetType: WORKFLOW_TARGET,
      targetId: created._id,
      after: { key, name, forkedFrom },
    });
    return this.toModel(facts, created);
  }

  /** root 分派共用流程給租戶(建 `org_workflow`);已分派的略過(冪等)。 */
  async assign(
    facts: FormOperatorFacts,
    input: AssignWorkflowToTenantsInput,
  ): Promise<WorkflowModel> {
    const workflow = await this.requireAssignable(facts, input.workflowKey);
    const added: string[] = [];
    for (const raw of input.tenantOrgIds) {
      const tenantId = await this.relations.tenantIdFor(
        facts.operator,
        toObjectId(raw, "tenantOrgIds"),
      );
      const existing = await this.relations.findOne(tenantId, {
        type: "org_workflow",
        secondId: workflow._id,
      });
      if (existing) {
        continue;
      }
      try {
        await this.relations.create(facts.operator, tenantId, {
          type: "org_workflow",
          firstId: tenantId,
          secondId: workflow._id,
          meta: {},
        });
        added.push(String(tenantId));
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
      }
    }
    if (added.length > 0) {
      await this.audit.record(facts.operator, {
        action: WORKFLOW_AUDIT.assign,
        targetType: WORKFLOW_TARGET,
        targetId: workflow._id,
        after: { tenantOrgIds: added },
      });
    }
    return this.toModel(facts, workflow);
  }

  /**
   * root 收回分派(刪 `org_workflow`):進行中的實例照常走完;綁著它的表單之後送出會被擋
   * (「審核流程已移除」),綁定本身不刪 —— 列表會顯示「綁定的流程已失效」。
   */
  async revoke(
    facts: FormOperatorFacts,
    input: RevokeWorkflowFromTenantInput,
  ): Promise<WorkflowModel> {
    const workflow = await this.requireAssignable(facts, input.workflowKey);
    const tenantId = await this.relations.tenantIdFor(
      facts.operator,
      toObjectId(input.tenantOrgId, "tenantOrgId"),
    );
    const removed = await this.relations.deleteMany(tenantId, {
      type: "org_workflow",
      secondId: workflow._id,
    });
    if (removed > 0) {
      await this.audit.record(facts.operator, {
        action: WORKFLOW_AUDIT.revoke,
        targetType: WORKFLOW_TARGET,
        targetId: workflow._id,
        before: { tenantOrgId: String(tenantId) },
      });
    }
    return this.toModel(facts, workflow);
  }

  // ---- 內部 ----

  /** 分派 / 收回:站在根組織 + 共用流程。 */
  private async requireAssignable(
    facts: FormOperatorFacts,
    workflowKey: string,
  ): Promise<WorkflowRecord> {
    if (!facts.isRoot) {
      throw workflowForbiddenError(
        "Only the root org can assign workflows",
        "ROOT_ONLY",
      );
    }
    return this.access.requireReadable(facts, workflowKey);
  }

  /** 建流程(共用 / 客製由操作者站在哪裡決定);key 撞名 → `VALIDATION_FAILED`(`key`)。 */
  private async insertWorkflow(
    facts: FormOperatorFacts,
    key: string,
    name: string,
    forkedFrom: { workflowKey: string; version: number } | null,
    definitionId?: Types.ObjectId,
  ): Promise<WorkflowRecord> {
    const tenantId = facts.isRoot ? null : facts.tenantId;
    if (!facts.isRoot && tenantId === null) {
      throw workflowForbiddenError(
        "Operator is not inside a tenant",
        "NOT_WORKFLOW_OWNER",
      );
    }
    let created: WorkflowRecord;
    try {
      created = await this.workflows.create(facts.operator, tenantId, {
        key,
        name,
        forkedFrom,
        ...(definitionId === undefined ? {} : { _id: definitionId }),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw workflowValidationError(`Workflow key already exists: ${key}`, [
          "key",
        ]);
      }
      throw error;
    }
    if (tenantId !== null) {
      await this.relations.create(facts.operator, tenantId, {
        type: "org_workflow",
        firstId: tenantId,
        secondId: created._id,
        meta: {},
      });
    }
    return created;
  }

  private async toModel(
    facts: FormOperatorFacts,
    workflow: WorkflowRecord,
  ): Promise<WorkflowModel> {
    const [model] = await this.toModels(facts, [workflow]);
    if (model === undefined) {
      throw new Error(`流程 ${workflow.key} 沒有產生對外形狀`);
    }
    return model;
  }

  /**
   * 一頁流程 → 對外形狀(順序同輸入)。擁有者、草稿、綁定的表單依整頁一次讀;root 視角的分派
   * 依租戶各一次(TX-07:指令數不隨列數成長)。
   */
  private async toModels(
    facts: FormOperatorFacts,
    workflows: readonly WorkflowRecord[],
  ): Promise<WorkflowModel[]> {
    if (workflows.length === 0) {
      return [];
    }
    const operator = facts.operator;
    const ownerIds = workflows
      .map((workflow) => workflow.ownerOrgId)
      .filter((id): id is Types.ObjectId => id !== null);
    const [owners, drafts] = await Promise.all([
      ownerIds.length === 0
        ? []
        : this.orgs.findMany(orgReader(operator), { _id: { $in: ownerIds } }),
      this.versions.findMany(operator, {
        workflowKey: { $in: workflows.map((workflow) => workflow.key) },
        status: "draft",
      }),
    ]);
    const ownerNameOf = new Map(
      owners.map((owner) => [String(owner._id), owner.name]),
    );
    const draftKeys = new Set(drafts.map((draft) => draft.workflowKey));
    const assignmentsOf = facts.isRoot
      ? await this.assignmentsOf(
          operator,
          workflows.filter((workflow) => workflow.tenantId === null),
        )
      : new Map<string, WorkflowAssignment[]>();
    const boundFormsOf = await this.boundFormsOf(facts, workflows);
    return workflows.map((workflow) =>
      this.modelOf(facts, workflow, {
        ownerOrgName: workflow.ownerOrgId
          ? (ownerNameOf.get(String(workflow.ownerOrgId)) ?? null)
          : null,
        hasDraft: draftKeys.has(workflow.key),
        assignments: assignmentsOf.get(String(workflow._id)) ?? [],
        boundForms: boundFormsOf.get(String(workflow._id)) ?? [],
      }),
    );
  }

  private modelOf(
    facts: FormOperatorFacts,
    workflow: WorkflowRecord,
    loaded: {
      ownerOrgName: string | null;
      hasDraft: boolean;
      assignments: WorkflowAssignment[];
      boundForms: WorkflowBoundForm[];
    },
  ): WorkflowModel {
    const canWrite = this.access.canWrite(facts, workflow);
    return {
      id: String(workflow._id),
      key: workflow.key,
      name: workflow.name,
      isShared: workflow.tenantId === null,
      ownerOrgId: workflow.ownerOrgId ? String(workflow.ownerOrgId) : null,
      ownerOrgName: loaded.ownerOrgName,
      forkedFrom: workflow.forkedFrom,
      currentVersion: workflow.currentVersion,
      hasDraft: loaded.hasDraft,
      assignments: loaded.assignments,
      boundForms: loaded.boundForms,
      abilities: {
        canEdit: canWrite && this.access.has(facts, WORKFLOWS_PERMISSIONS.edit),
        canPublish:
          canWrite && this.access.has(facts, WORKFLOWS_PERMISSIONS.publish),
        canAssign:
          facts.isRoot &&
          workflow.tenantId === null &&
          this.access.has(facts, WORKFLOWS_PERMISSIONS.assign),
        canFork: this.access.has(facts, WORKFLOWS_PERMISSIONS.create),
      },
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };
  }

  /**
   * root 視角:這些共用流程各分派到哪些租戶(以流程 id 為鍵)。`org_workflow` 以租戶為邊界,
   * 所以依租戶各讀一次、一次涵蓋整頁的流程(指令數 = 租戶數 + 1,不隨列數成長)。
   */
  private async assignmentsOf(
    operator: OperatorContext,
    workflows: readonly WorkflowRecord[],
  ): Promise<Map<string, WorkflowAssignment[]>> {
    const assignments = new Map<string, WorkflowAssignment[]>();
    if (workflows.length === 0) {
      return assignments;
    }
    const tenants = await this.orgs.findMany(orgReader(operator), {
      "ancestors.0": { $exists: true },
      "ancestors.1": { $exists: false },
    });
    for (const tenant of tenants) {
      const links = await this.relations.findMany(tenant._id, {
        type: "org_workflow",
        secondId: { $in: workflows.map((workflow) => workflow._id) },
      });
      // 同一個流程有多筆時只算一次(同逐筆時的 `findOne`)
      for (const workflowId of new Set(
        links.map((link) => String(link.secondId)),
      )) {
        assignments.set(workflowId, [
          ...(assignments.get(workflowId) ?? []),
          { tenantOrgId: String(tenant._id), tenantName: tenant.name },
        ]);
      }
    }
    return assignments;
  }

  /**
   * 租戶視角:本租戶哪些表單綁了這些流程(反查 `org_form_workflow.thirdId`;以流程 id 為鍵,
   * 表單依 key 排序)。整頁一次讀關聯、一次讀表單。
   */
  private async boundFormsOf(
    facts: FormOperatorFacts,
    workflows: readonly WorkflowRecord[],
  ): Promise<Map<string, WorkflowBoundForm[]>> {
    const bound = new Map<string, WorkflowBoundForm[]>();
    if (facts.tenantId === null) {
      return bound;
    }
    const links = await this.relations.findMany(facts.tenantId, {
      type: "org_form_workflow",
      thirdId: { $in: workflows.map((workflow) => workflow._id) },
    });
    if (links.length === 0) {
      return bound;
    }
    const forms = await this.forms.findMany(
      facts.operator,
      { _id: { $in: links.map((link) => link.secondId) } },
      { sort: { key: 1 } },
    );
    for (const workflow of workflows) {
      const formIds = new Set(
        links
          .filter((link) => String(link.thirdId) === String(workflow._id))
          .map((link) => String(link.secondId)),
      );
      bound.set(
        String(workflow._id),
        forms
          .filter((form) => formIds.has(String(form._id)))
          .map((form) => ({
            formKey: form.key,
            formName: form.name,
            moduleKey: form.moduleKey,
          })),
      );
    }
    return bound;
  }
}

function requireWorkflowKey(key: string): string {
  if (!isValidFormKey(key)) {
    throw workflowValidationError(`Invalid workflow key: ${key}`, ["key"]);
  }
  return key;
}
