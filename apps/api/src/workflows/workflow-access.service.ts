import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { BusinessRelationshipsRepository } from "../database/business-relationships.repository";
import type { OperatorContext } from "../database/operator-context";
import {
  type WorkflowRecord,
  WorkflowsRepository,
} from "../database/workflows.repository";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../forms/form-access.service";
import {
  workflowForbiddenError,
  workflowNotFoundError,
} from "./workflows-error";

/**
 * 流程的「誰看得到、誰改得動」(同表單的判準):
 *
 * | 操作者     | 設計端看得到                                                  | 改得動              |
 * | ---------- | ------------------------------------------------------------- | ------------------- |
 * | 站在根組織 | 共用流程(客製流程只有該租戶看得到)                           | 共用流程            |
 * | 站在租戶內 | 自己的客製 + 分派來的共用流程(有 `org_workflow` 且已發布)    | 自己的客製流程      |
 *
 * 「租戶看得到的共用流程」要 `currentVersion` 非 null(流程分派);客製流程一律看得到。
 * 操作者的事實(權限集合、是否站在根組織、租戶)沿用表單引擎的 `FormAccessService.factsOf`。
 */
@Injectable()
export class WorkflowAccessService {
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly relations: BusinessRelationshipsRepository,
    private readonly forms: FormAccessService,
  ) {}

  factsOf(operator: OperatorContext): Promise<FormOperatorFacts> {
    return this.forms.factsOf(operator);
  }

  has(facts: FormOperatorFacts, key: string): boolean {
    return this.forms.has(facts, key);
  }

  /** 沒有該權限 → `FORBIDDEN`(同 `@RequirePermission`,無 reason)。 */
  assertPermission(facts: FormOperatorFacts, key: string): void {
    if (!this.has(facts, key)) {
      throw workflowForbiddenError(`Missing permission ${key}`);
    }
  }

  /** 依 key 找流程(共用的 + 操作者租戶的客製);別租戶的客製一律當不存在。 */
  async findByKey(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<WorkflowRecord | null> {
    const shared = await this.workflows.findOne(null, { key });
    if (shared !== null || facts.tenantId === null) {
      return shared;
    }
    return this.workflows.findOne(facts.tenantId, { key });
  }

  /** 本租戶分派來的共用流程 id(`org_workflow`)。 */
  async assignedSharedIds(tenantId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const links = await this.relations.findMany(tenantId, {
      type: "org_workflow",
    });
    return links.map((link) => link.secondId);
  }

  /**
   * 租戶此刻還「持有」這個流程嗎(送出時檢查的 `isAssigned`、綁定時的可綁判斷):
   * 自己的客製流程,或共用流程且仍有本租戶的 `org_workflow`。
   */
  async isHeldByTenant(
    tenantId: Types.ObjectId,
    workflow: WorkflowRecord,
  ): Promise<boolean> {
    if (workflow.tenantId !== null) {
      return workflow.tenantId.equals(tenantId);
    }
    const link = await this.relations.findOne(tenantId, {
      type: "org_workflow",
      secondId: workflow._id,
    });
    return link !== null;
  }

  /** 設計端讀得到嗎(見 class 註解的表)。 */
  async canRead(
    facts: FormOperatorFacts,
    workflow: WorkflowRecord,
  ): Promise<boolean> {
    if (facts.isRoot) {
      return workflow.tenantId === null;
    }
    if (facts.tenantId === null) {
      return false;
    }
    if (workflow.tenantId !== null) {
      return workflow.tenantId.equals(facts.tenantId);
    }
    return (
      workflow.currentVersion !== null &&
      (await this.isHeldByTenant(facts.tenantId, workflow))
    );
  }

  canWrite(facts: FormOperatorFacts, workflow: WorkflowRecord): boolean {
    if (facts.isRoot) {
      return workflow.tenantId === null;
    }
    return (
      facts.tenantId !== null &&
      workflow.tenantId?.equals(facts.tenantId) === true
    );
  }

  /** 設計端讀:讀不到一律 `NOT_FOUND`(不透露別的租戶有這個流程)。 */
  async requireReadable(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<WorkflowRecord> {
    const workflow = await this.findByKey(facts, key);
    if (!workflow || !(await this.canRead(facts, workflow))) {
      throw workflowNotFoundError(`Workflow not found: ${key}`);
    }
    return workflow;
  }

  /** 設計端寫:讀得到但不是自己的 → `FORBIDDEN`(`NOT_WORKFLOW_OWNER`)。 */
  async requireWritable(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<WorkflowRecord> {
    const workflow = await this.requireReadable(facts, key);
    if (!this.canWrite(facts, workflow)) {
      throw workflowForbiddenError(
        `Workflow ${key} is not owned by the operator`,
        "NOT_WORKFLOW_OWNER",
      );
    }
    return workflow;
  }

  /** 設計端清單看得到的全部流程(root:共用;租戶:客製 + 分派來且已發布的共用)。 */
  async listVisible(facts: FormOperatorFacts): Promise<WorkflowRecord[]> {
    if (facts.isRoot) {
      return this.workflows.findMany(null);
    }
    if (facts.tenantId === null) {
      return [];
    }
    const visible = await this.workflows.findVisibleToTenant(
      facts.tenantId,
      await this.assignedSharedIds(facts.tenantId),
    );
    return visible.filter(
      (workflow) =>
        workflow.tenantId !== null || workflow.currentVersion !== null,
    );
  }
}
