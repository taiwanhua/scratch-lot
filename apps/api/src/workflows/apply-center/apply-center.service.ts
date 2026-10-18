import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { temporalIsoOf } from "@repo/domain/form";
import { stepOf } from "@repo/domain/workflow";

import { BusinessRelationshipsRepository } from "../../database/business-relationships.repository";
import {
  FormsRepository,
  ModulesRepository,
} from "../../database/database.module";
import { allowsDraft } from "../../database/schemas/form.schema";
import {
  type SubmissionFilter,
  type SubmissionSnapshotRecord,
  WorkflowSubmissionStore,
} from "../../database/workflow-submission-store";
import { WorkflowTasksRepository } from "../../database/workflow-tasks.repository";
import {
  FormAccessService,
  type FormOperatorFacts,
  toObjectId,
} from "../../forms/form-access.service";
import { FormSubmissionStatusEnum } from "../../forms/form-runtime/models/form-submission.model";
import type {
  WorkflowInstanceModel,
  WorkflowTasksPayload,
} from "../models/workflow-instance.model";
import { systemContext } from "../tenant-directory.service";
import { SubmissionReadAccess } from "../workflow-engine/submission-read-access.service";
import { WorkflowEngineService } from "../workflow-engine/workflow-engine.service";
import { WorkflowPresenter } from "../workflow-engine/workflow-presenter.service";
import { WORKFLOW_REASSIGN_PERMISSION } from "../workflow-keys";
import { workflowNotFoundError } from "../workflows-error";
import {
  type ApplicableModuleForms,
  type ApplicationItem,
  type ApplyCenterCounts,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type MyApplicationsInput,
  type MyApplicationsPayload,
  type MyTasksInput,
} from "./apply-center.types";

const DONE_STATUSES = ["approved", "rejected", "returned", "late"];

/** 「我的申請」計數的「進行中」:審核中與被退回(已完成、已駁回、已作廢、已撤回、草稿不算)。 */
const IN_PROGRESS_STATUSES: readonly FormSubmissionStatusEnum[] = [
  FormSubmissionStatusEnum.REVIEWING,
  FormSubmissionStatusEnum.RETURNED,
];

interface ListCriteria {
  moduleKey?: string | null;
  formKey?: string | null;
}

/**
 * 「我的申請」的條件(列表與計數共用):`createdBy = 我` 且(走過流程,或該表單目前綁了流程)。
 * `statuses` 空 = 不限狀態。
 */
function myApplicationsFilter(
  actorId: Types.ObjectId,
  boundKeys: ReadonlySet<string>,
  criteria: ListCriteria & { statuses: readonly FormSubmissionStatusEnum[] },
): SubmissionFilter {
  const { statuses } = criteria;
  return {
    createdBy: actorId,
    ...(criteria.moduleKey ? { moduleKey: criteria.moduleKey } : {}),
    ...(criteria.formKey ? { formKey: criteria.formKey } : {}),
    ...(statuses.length === 1 ? { status: statuses[0] } : {}),
    ...(statuses.length > 1 ? { status: { $in: [...statuses] } } : {}),
    $or: [
      { currentInstanceId: { $ne: null } },
      { formKey: { $in: [...boundKeys] } },
    ],
  };
}

/** 「待我審核」的條件(列表與計數共用):`assigneeId = 我`;待處理 = `pending`,已處理 = 有結果的。 */
function myTasksFilter(
  actorId: Types.ObjectId,
  criteria: ListCriteria & { done: boolean },
): Record<string, unknown> {
  return {
    assigneeId: actorId,
    status: criteria.done ? { $in: DONE_STATUSES } : "pending",
    ...(criteria.moduleKey ? { moduleKey: criteria.moduleKey } : {}),
    ...(criteria.formKey ? { formKey: criteria.formKey } : {}),
  };
}

function pageOf(input: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
} {
  return {
    page: Math.max(1, input.page ?? 1),
    pageSize: Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    ),
  };
}

/**
 * 申請中心(`apply-center`):兩個跨模組頁籤 + 新申請入口 + 詳情。
 * **都以 `tenantId` 為邊界**,不套可見範圍與資料範圍(內容以「我」為邊界:我送的、派給我的);
 * 任務列表與詳情的摘要一律讀**實例快照**。
 */
@Injectable()
export class ApplyCenterService {
  constructor(
    private readonly store: WorkflowSubmissionStore,
    private readonly tasks: WorkflowTasksRepository,
    private readonly relations: BusinessRelationshipsRepository,
    private readonly forms: FormsRepository,
    private readonly modules: ModulesRepository,
    private readonly formAccess: FormAccessService,
    private readonly readAccess: SubmissionReadAccess,
    private readonly engine: WorkflowEngineService,
    private readonly presenter: WorkflowPresenter,
  ) {}

  /** 我的申請:`createdBy = 我` 且(走過流程,或該表單目前綁了流程)。 */
  async myApplications(
    facts: FormOperatorFacts,
    input: MyApplicationsInput,
  ): Promise<MyApplicationsPayload> {
    const { page, pageSize } = pageOf(input);
    const tenantId = facts.tenantId;
    const actorId = facts.operator.actorId;
    if (tenantId === null || actorId === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const filter = myApplicationsFilter(
      actorId,
      await this.boundFormKeys(tenantId),
      {
        moduleKey: input.moduleKey,
        formKey: input.formKey,
        statuses: input.status ? [input.status] : [],
      },
    );
    const [totalCount, records] = await Promise.all([
      this.store.count(tenantId, filter),
      this.store.findMany(tenantId, filter, {
        sort: { updatedAt: -1, _id: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    ]);
    const items: ApplicationItem[] = [];
    for (const record of records) {
      items.push(await this.applicationOf(record));
    }
    return { items, totalCount, page, pageSize };
  }

  /** 新申請:我有新增資格(`canCreateWithForm`)且可新增、而且本租戶綁了流程的表單,依模組分組。 */
  async applicableForms(
    facts: FormOperatorFacts,
  ): Promise<ApplicableModuleForms[]> {
    if (facts.tenantId === null) {
      return [];
    }
    const boundKeys = await this.boundFormKeys(facts.tenantId);
    const modules = await this.modules.findMany(
      systemContext(),
      { engine: "form" },
      { sort: { order: 1, key: 1 } },
    );
    const groups: ApplicableModuleForms[] = [];
    for (const module of modules) {
      // 模組層連一張表單的新增資格都沒有 → 不查表單
      if (!this.formAccess.canCreateInModule(facts, module.key)) {
        continue;
      }
      const available = await this.formAccess.availableForms(facts, module.key);
      const forms = available
        .filter(
          (form) =>
            boundKeys.has(form.key) &&
            this.formAccess.canCreateWithForm(facts, module.key, form.key),
        )
        .map((form) => ({
          key: form.key,
          name: form.name,
          moduleKey: form.moduleKey,
          currentVersion: form.currentVersion ?? 0,
          tabLabelTemplate: form.tabLabelTemplate,
          allowDraft: allowsDraft(form),
          canCreate: true,
        }));
      if (forms.length > 0) {
        groups.push({ moduleKey: module.key, moduleName: module.name, forms });
      }
    }
    return groups;
  }

  /** 待我審核:`assigneeId = 我`;摘要與申請人讀實例快照。 */
  async myTasks(
    facts: FormOperatorFacts,
    input: MyTasksInput,
  ): Promise<WorkflowTasksPayload> {
    const { page, pageSize } = pageOf(input);
    const tenantId = facts.tenantId;
    const actorId = facts.operator.actorId;
    if (tenantId === null || actorId === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const isDone = input.done === true;
    const filter = myTasksFilter(actorId, {
      moduleKey: input.moduleKey,
      formKey: input.formKey,
      done: isDone,
    });
    const [totalCount, records] = await Promise.all([
      this.tasks.count(tenantId, filter),
      this.tasks.findMany(tenantId, filter, {
        sort: isDone ? { decidedAt: -1, _id: -1 } : { createdAt: -1, _id: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    ]);
    return {
      items: await this.presenter.taskModels(records),
      totalCount,
      page,
      pageSize,
    };
  }

  /**
   * 頁籤與側欄的 badge 數字:待我處理的任務數(=「待我審核」預設的待處理)、進行中的申請數
   * (「我的申請」條件 + 審核中 / 被退回)。條件與兩個列表共用同一組 builder,只做 `countDocuments`。
   */
  async counts(facts: FormOperatorFacts): Promise<ApplyCenterCounts> {
    const tenantId = facts.tenantId;
    const actorId = facts.operator.actorId;
    if (tenantId === null || actorId === null) {
      return { myTasks: 0, myApplications: 0 };
    }
    const [myTasks, myApplications] = await Promise.all([
      this.myTaskCount(facts),
      this.boundFormKeys(tenantId).then((boundKeys) =>
        this.store.count(
          tenantId,
          myApplicationsFilter(actorId, boundKeys, {
            statuses: IN_PROGRESS_STATUSES,
          }),
        ),
      ),
    ]);
    return { myTasks, myApplications };
  }

  /**
   * 待我處理的任務數(`counts` 的 `myTasks`):側欄「申請中心」的數字只要這一項
   * (登記在 `ApplyCenterBadge`)。
   */
  async myTaskCount(facts: FormOperatorFacts): Promise<number> {
    const tenantId = facts.tenantId;
    const actorId = facts.operator.actorId;
    if (tenantId === null || actorId === null) {
      return 0;
    }
    return this.tasks.count(tenantId, myTasksFilter(actorId, { done: false }));
  }

  /** 實例詳情:授權同 `canReadSubmissionRevision`(申請人 / 模組讀者 / 任務持有者只看該修訂)。 */
  async instance(
    facts: FormOperatorFacts,
    id: string,
  ): Promise<WorkflowInstanceModel> {
    const instance = await this.engine.findInstance(toObjectId(id, "id"));
    const submission =
      instance === null || facts.tenantId === null
        ? null
        : await this.readAccess.findInTenant(facts, instance.submissionId);
    if (
      instance === null ||
      submission === null ||
      !(await this.readAccess.canReadSubmissionRevision(
        facts,
        submission,
        instance.revision,
      ))
    ) {
      throw workflowNotFoundError(`Instance not found: ${id}`);
    }
    return this.presenter.instanceModel(instance, {
      actorId: facts.operator.actorId,
      canManage: this.formAccess.has(facts, WORKFLOW_REASSIGN_PERMISSION),
    });
  }

  // ---- 內部 ----

  private async boundFormKeys(tenantId: Types.ObjectId): Promise<Set<string>> {
    const links = await this.relations.findMany(tenantId, {
      type: "org_form_workflow",
    });
    if (links.length === 0) {
      return new Set();
    }
    const forms = await this.forms.findMany(systemContext(), {
      _id: { $in: links.map((link) => link.secondId) },
    });
    return new Set(forms.map((form) => form.key));
  }

  private async applicationOf(
    record: SubmissionSnapshotRecord,
  ): Promise<ApplicationItem> {
    const [form, module, instance] = await Promise.all([
      this.forms.findOne(systemContext(), { key: record.formKey }),
      this.modules.findOne(systemContext(), { key: record.moduleKey }),
      record.currentInstanceId === null
        ? null
        : this.engine.findInstance(record.currentInstanceId),
    ]);
    const definition = instance
      ? await this.engine.definitionOf(instance)
      : null;
    return {
      id: String(record._id),
      moduleKey: record.moduleKey,
      moduleName: module?.name ?? null,
      formKey: record.formKey,
      formName: form?.name ?? null,
      status: record.status as FormSubmissionStatusEnum,
      blocked: record.blocked,
      revision: record.revision,
      summary: record.summary
        ? {
            title: record.summary.title,
            date: temporalIsoOf(record.summary.date),
            amount: record.summary.amount ?? null,
          }
        : null,
      currentInstanceId: record.currentInstanceId
        ? String(record.currentInstanceId)
        : null,
      activeSteps:
        instance && definition
          ? instance.activeStepKeys.map((stepKey) => ({
              stepKey,
              name: stepOf(definition, stepKey)?.name ?? stepKey,
            }))
          : [],
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
    };
  }
}
