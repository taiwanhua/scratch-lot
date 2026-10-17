import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";
import { validateAudience } from "@repo/domain/audience";
import type { FieldDef } from "@repo/domain/form";
import {
  APPROVER_AUDIENCE_OPTIONS,
  type ReviewStepDef,
  assigneeFieldProblem,
  audienceFormFieldRefsOf,
  audienceOrgFieldProblem,
  audienceStaticIdsOf,
  isReviewStep,
  sharedAudienceViolations,
} from "@repo/domain/workflow";

import { AuditService } from "../../audit/audit.service";
import { BusinessRelationshipsRepository } from "../../database/business-relationships.repository";
import {
  FormVersionsRepository,
  WorkflowVersionsRepository,
} from "../../database/database.module";
import {
  type WorkflowRecord,
  WorkflowsRepository,
} from "../../database/workflows.repository";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
} from "../../forms/form-access.service";
import {
  TenantDirectoryService,
  objectIdsOf,
  systemContext,
} from "../tenant-directory.service";
import { WorkflowAccessService } from "../workflow-access.service";
import {
  type BindingIssue,
  assigneeKindUnknownError,
  bindingInvalidError,
  isDuplicateKey,
  workflowForbiddenError,
  workflowNotFoundError,
} from "../workflows-error";
import type {
  BindFormWorkflowInput,
  UnbindFormWorkflowInput,
} from "./dto/workflow-design.input";
import type { FormWorkflowBinding } from "./models/workflow.model";

/** 稽核動作名(`docs/modules/workflows.md`「稽核」;`targetType` = form)。 */
export const BINDING_AUDIT = {
  bind: "form.bind-workflow",
  unbind: "form.unbind-workflow",
} as const;

/** 一個流程對某張表單「能不能直接綁」的判斷結果(表單管理的流程下拉)。 */
export interface BindableWorkflow {
  workflow: WorkflowRecord;
  issues: BindingIssue[];
}

/**
 * 流程綁定(Spec 6b §3「流程綁定」):`business_relationships` 的 `org_form_workflow`
 * (`tenantId` = `firstId` = 租戶頂層、`secondId` = 表單、`thirdId` = 流程)。
 * 唯一鍵 `(tenantId, type, firstId, secondId)` = 一張表單最多綁一個流程;多張表單可綁同一個流程。
 *
 * **綁定時檢查**只是設計輔助(不取代送出時檢查):共用流程的人員條件不能用使用者 / 角色 / 指定組織
 * (`AUDIENCE_IN_SHARED`);客製流程人員條件裡的使用者 / 角色 / 指定組織要屬本租戶;人員條件用的
 * 表單組織欄位要在被綁表單的目前版本且是組織引用欄(`FIELD_NOT_ORG_REFERENCE`,與送出時同一份檢查);
 * `field` 來源要屬於被綁的表單且欄位在它的目前版本是使用者型引用欄。另外流程要本租戶看得到且已發布
 * (沒有發布版的流程不給綁)。
 */
@Injectable()
export class WorkflowBindingsService {
  constructor(
    private readonly relations: BusinessRelationshipsRepository,
    private readonly workflows: WorkflowsRepository,
    private readonly workflowVersions: WorkflowVersionsRepository,
    private readonly formVersions: FormVersionsRepository,
    private readonly formAccess: FormAccessService,
    private readonly access: WorkflowAccessService,
    private readonly directory: TenantDirectoryService,
    private readonly audit: AuditService,
  ) {}

  /** 綁定 / 換流程(upsert);檢查不過 → `VALIDATION_FAILED` + `issues`。回表單 key。 */
  async bind(
    facts: FormOperatorFacts,
    input: BindFormWorkflowInput,
  ): Promise<string> {
    const tenantId = requireTenant(facts);
    const form = await this.formAccess.requireReadableForm(
      facts,
      input.formKey,
    );
    const workflow = await this.access.findByKey(facts, input.workflowKey);
    if (
      workflow === null ||
      !(await this.access.isHeldByTenant(tenantId, workflow))
    ) {
      throw workflowNotFoundError(`Workflow not found: ${input.workflowKey}`);
    }
    const issues = await this.issuesOf(tenantId, form, workflow);
    if (issues === null) {
      throw workflowForbiddenError(
        `Workflow ${workflow.key} has no published version`,
        "WORKFLOW_UNPUBLISHED",
      );
    }
    if (issues.length > 0) {
      throw bindingInvalidError(
        `Workflow ${workflow.key} cannot be bound to ${form.key} directly`,
        issues,
      );
    }
    const before = await this.linkOf(tenantId, form._id);
    if (before?.thirdId?.equals(workflow._id) === true) {
      return form.key;
    }
    await this.upsert(facts, tenantId, form._id, workflow._id);
    await this.audit.record(facts.operator, {
      action: BINDING_AUDIT.bind,
      targetType: "form",
      targetId: form._id,
      before: { workflowId: before?.thirdId ? String(before.thirdId) : null },
      after: { workflowKey: workflow.key, workflowId: String(workflow._id) },
    });
    return form.key;
  }

  /** 解除綁定(刪 `org_form_workflow`);進過審核的單之後再送出會被擋(Spec §3)。回表單 key。 */
  async unbind(
    facts: FormOperatorFacts,
    input: UnbindFormWorkflowInput,
  ): Promise<string> {
    const tenantId = requireTenant(facts);
    const form = await this.formAccess.requireReadableForm(
      facts,
      input.formKey,
    );
    const before = await this.linkOf(tenantId, form._id);
    const removed = await this.relations.deleteMany(tenantId, {
      type: "org_form_workflow",
      firstId: tenantId,
      secondId: form._id,
    });
    if (removed > 0) {
      await this.audit.record(facts.operator, {
        action: BINDING_AUDIT.unbind,
        targetType: "form",
        targetId: form._id,
        before: {
          workflowId: before?.thirdId ? String(before.thirdId) : null,
        },
      });
    }
    return form.key;
  }

  /** 表單管理列表的流程綁定欄:本租戶這張表單綁到哪個流程、那個流程還有沒有效。 */
  async bindingOf(
    facts: FormOperatorFacts,
    formId: Types.ObjectId,
  ): Promise<FormWorkflowBinding | null> {
    if (facts.tenantId === null) {
      return null;
    }
    const link = await this.linkOf(facts.tenantId, formId);
    if (!link?.thirdId) {
      return null;
    }
    const workflow = await this.workflowById(facts.tenantId, link.thirdId);
    if (workflow === null) {
      return {
        workflowKey: String(link.thirdId),
        workflowName: null,
        isValid: false,
      };
    }
    const isValid =
      workflow.currentVersion !== null &&
      (await this.access.isHeldByTenant(facts.tenantId, workflow));
    return { workflowKey: workflow.key, workflowName: workflow.name, isValid };
  }

  /**
   * 這張表單可以選的流程(本租戶看得到、已發布)與各自的綁定時檢查結果;`issues` 為空 = 可直接綁。
   * 不能直接綁的(共用流程含角色佔位…)照樣列出,前端顯示原因與「建客製流程」捷徑。
   */
  async optionsFor(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<BindableWorkflow[]> {
    const tenantId = requireTenant(facts);
    const form = await this.formAccess.requireReadableForm(facts, formKey);
    const visible = await this.access.listVisible(facts);
    const options: BindableWorkflow[] = [];
    for (const workflow of visible) {
      const issues = await this.issuesOf(tenantId, form, workflow);
      if (issues !== null) {
        options.push({ workflow, issues });
      }
    }
    return options;
  }

  // ---- 內部 ----

  private linkOf(tenantId: Types.ObjectId, formId: Types.ObjectId) {
    return this.relations.findOne(tenantId, {
      type: "org_form_workflow",
      firstId: tenantId,
      secondId: formId,
    });
  }

  /** 綁定指向的流程:共用的,或本租戶的客製(別租戶的一律讀不到)。 */
  private async workflowById(
    tenantId: Types.ObjectId,
    id: Types.ObjectId,
  ): Promise<WorkflowRecord | null> {
    return (
      (await this.workflows.findOne(null, { _id: id })) ??
      (await this.workflows.findOne(tenantId, { _id: id }))
    );
  }

  private async upsert(
    facts: FormOperatorFacts,
    tenantId: Types.ObjectId,
    formId: Types.ObjectId,
    workflowId: Types.ObjectId,
  ): Promise<void> {
    const filter = {
      type: "org_form_workflow" as const,
      firstId: tenantId,
      secondId: formId,
    };
    const updated = await this.relations.setThirdId(
      facts.operator,
      tenantId,
      filter,
      workflowId,
    );
    if (updated) {
      return;
    }
    try {
      await this.relations.create(facts.operator, tenantId, {
        ...filter,
        thirdId: workflowId,
        meta: {},
      });
    } catch (error) {
      // 同時兩個綁定:另一個先建了,改指向這一次的流程
      if (!isDuplicateKey(error)) {
        throw error;
      }
      await this.relations.setThirdId(
        facts.operator,
        tenantId,
        filter,
        workflowId,
      );
    }
  }

  /** 綁定時檢查(Spec §3 表);流程沒有發布版 → null。 */
  private async issuesOf(
    tenantId: Types.ObjectId,
    form: FormRecord,
    workflow: WorkflowRecord,
  ): Promise<BindingIssue[] | null> {
    if (workflow.currentVersion === null) {
      return null;
    }
    const version = await this.workflowVersions.findOne(systemContext(), {
      workflowKey: workflow.key,
      version: workflow.currentVersion,
    });
    if (!version) {
      return null;
    }
    const isShared = workflow.tenantId === null;
    const fields = await this.currentFieldsOf(form);
    const tenantRoles = isShared
      ? new Set<string>()
      : await this.directory.tenantRoleIds(tenantId);
    const tenantOrgs = isShared
      ? new Set<string>()
      : await this.directory.tenantOrgIdSet(tenantId);
    const issues: BindingIssue[] = [];
    for (const [index, step] of version.steps.entries()) {
      if (!isReviewStep(step)) {
        continue;
      }
      const issue = await this.stepIssue(tenantId, step, index + 1, {
        isShared,
        formKey: form.key,
        fields,
        tenantRoles,
        tenantOrgs,
      });
      if (issue !== null) {
        issues.push(issue);
      }
    }
    return issues;
  }

  private async stepIssue(
    tenantId: Types.ObjectId,
    step: ReviewStepDef,
    stepNumber: number,
    context: BindingContext,
  ): Promise<BindingIssue | null> {
    const base = { stepKey: step.key, stepNumber };
    const label = `關卡「${step.name}」`;
    const { assignee } = step;
    switch (assignee.kind) {
      case "manager": {
        return null;
      }
      case "audience": {
        return this.audienceIssue(
          tenantId,
          base,
          label,
          assignee.audience,
          context,
        );
      }
      case "field": {
        return fieldIssue(base, label, assignee, context);
      }
      default: {
        // 型別上不會到這裡;落盤的舊資料(`users` / `role`)才會
        throw assigneeKindUnknownError((assignee as { kind?: unknown }).kind);
      }
    }
  }

  /**
   * 人員條件:共用流程不能用使用者 / 角色 / 指定組織;客製流程裡寫死的使用者 / 角色 / 組織要屬本租戶;
   * 表單組織欄位要在被綁表單的目前版本且是組織引用欄。格式錯的條件發布前已擋,這裡不重複報。
   */
  private async audienceIssue(
    tenantId: Types.ObjectId,
    base: IssueBase,
    label: string,
    raw: Audience,
    context: BindingContext,
  ): Promise<BindingIssue | null> {
    const validation = validateAudience(raw, APPROVER_AUDIENCE_OPTIONS);
    if (!validation.ok) {
      return null;
    }
    const audience = validation.audience;
    if (context.isShared) {
      if (sharedAudienceViolations(audience).length > 0) {
        return {
          ...base,
          problem: "AUDIENCE_IN_SHARED",
          detail: `${label}的審核者條件用了使用者、角色或指定組織,共用流程不能用;請以此流程為基底建客製流程`,
        };
      }
    } else {
      const tenantIssue = await this.audienceTenantIssue(
        tenantId,
        base,
        label,
        audience,
        context,
      );
      if (tenantIssue !== null) {
        return tenantIssue;
      }
    }
    for (const { fieldKey } of audienceFormFieldRefsOf(audience)) {
      const problem = audienceOrgFieldProblem(context.fields, fieldKey);
      if (problem !== null) {
        return {
          ...base,
          problem,
          detail:
            problem === "FIELD_MISSING"
              ? `${label}的審核者條件用的組織欄位 ${fieldKey} 不在表單目前版本`
              : `${label}的審核者條件用的欄位 ${fieldKey} 不是組織引用欄`,
        };
      }
    }
    return null;
  }

  /** 客製流程:人員條件裡寫死的角色 / 組織 / 使用者要屬本租戶。 */
  private async audienceTenantIssue(
    tenantId: Types.ObjectId,
    base: IssueBase,
    label: string,
    audience: Audience,
    context: BindingContext,
  ): Promise<BindingIssue | null> {
    if (
      audienceStaticIdsOf(audience, "role").some(
        (id) => !context.tenantRoles.has(id),
      )
    ) {
      return {
        ...base,
        problem: "ROLE_NOT_IN_TENANT",
        detail: `${label}的審核者條件選的角色不是本租戶的角色`,
      };
    }
    if (
      audienceStaticIdsOf(audience, "org").some(
        (id) => !context.tenantOrgs.has(id),
      )
    ) {
      return {
        ...base,
        problem: "ORG_NOT_IN_TENANT",
        detail: `${label}的審核者條件選的組織不在本租戶`,
      };
    }
    const userIds = audienceStaticIdsOf(audience, "user");
    if (userIds.length === 0) {
      return null;
    }
    const inTenant = await this.directory.userFacts(tenantId, userIds);
    return objectIdsOf(userIds).every((id) => inTenant.has(String(id)))
      ? null
      : {
          ...base,
          problem: "USER_NOT_IN_TENANT",
          detail: `${label}的審核者條件指定的使用者不在本租戶`,
        };
  }

  private async currentFieldsOf(
    form: FormRecord,
  ): Promise<readonly FieldDef[]> {
    if (form.currentVersion === null) {
      return [];
    }
    const version = await this.formVersions.findOne(systemContext(), {
      formKey: form.key,
      version: form.currentVersion,
    });
    return version?.fields ?? [];
  }
}

interface BindingContext {
  isShared: boolean;
  formKey: string;
  fields: readonly FieldDef[];
  tenantRoles: ReadonlySet<string>;
  tenantOrgs: ReadonlySet<string>;
}

type IssueBase = Pick<BindingIssue, "stepKey" | "stepNumber">;

/** `field` 來源:要屬於被綁的表單,欄位在它的目前版本且是使用者型引用欄。 */
function fieldIssue(
  base: IssueBase,
  label: string,
  assignee: { formKey: string; fieldKey: string },
  context: BindingContext,
): BindingIssue | null {
  if (assignee.formKey !== context.formKey) {
    return {
      ...base,
      problem: "FIELD_FORM_MISMATCH",
      detail: `${label}的審核者欄位屬於表單 ${assignee.formKey},不是 ${context.formKey}`,
    };
  }
  const problem = assigneeFieldProblem(context.fields, assignee.fieldKey);
  if (problem === null) {
    return null;
  }
  return {
    ...base,
    problem,
    detail:
      problem === "FIELD_MISSING"
        ? `${label}的審核者欄位 ${assignee.fieldKey} 不在表單目前版本`
        : `${label}的審核者欄位 ${assignee.fieldKey} 不是使用者型引用欄`,
  };
}

/** 綁定要站在租戶內(root 沒有自己的表單綁定)。 */
function requireTenant(facts: FormOperatorFacts): Types.ObjectId {
  if (facts.isRoot || facts.tenantId === null) {
    throw workflowForbiddenError(
      "Form workflow bindings are set from inside a tenant",
      "TENANT_ONLY",
    );
  }
  return facts.tenantId;
}
