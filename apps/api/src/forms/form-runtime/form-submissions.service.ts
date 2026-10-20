import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type ArrayRowValue,
  type ExpressionContext,
  type FieldDef,
  type FormDefinition,
  type StoredValues,
  type SubmissionSummary,
  arrayColumnsOf,
  arrayRowsOf,
  computeSummary,
  defaultOrder,
  defaultValueOf,
  isEmptyValue,
  lookupLabelFieldsOf,
  normalizeSerialFormat,
  referencedFieldKeys,
  temporalIsoOf,
  upgradeValues,
  uploadLimitIssue,
  withoutLookupFilterVars,
} from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import type { FindOptions, Persisted } from "../../database/base.repository";
import {
  type FormSubmissionDocument,
  FormSubmissionsRepository,
  FormVersionsRepository,
  FormsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import {
  type FormRevision,
  type FormSubmissionStatus,
  revisionVersionOf,
} from "../../database/schemas/form-submission.schema";
import {
  allowsDraft,
  voidReasonCategoryOf,
} from "../../database/schemas/form.schema";
import { TransactionService, afterCommit } from "../../database/transaction";
import { FieldOptionsService } from "../../fields/field-options.service";
import { SerialService } from "../../serials/serial.service";
import { StorageService } from "../../storage/storage.service";
import { InstanceWithdrawService } from "../../workflows/workflow-engine/instance-withdraw.service";
import type { FormVoidReason } from "../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import {
  type EffectSubject,
  FormLifecycleService,
} from "../../workflows/workflow-engine/lifecycle/form-lifecycle.service";
import { SubmissionReadAccess } from "../../workflows/workflow-engine/submission-read-access.service";
import { WorkflowCcService } from "../../workflows/workflow-engine/workflow-cc.service";
import { WorkflowSubmitService } from "../../workflows/workflow-engine/workflow-submit.service";
import { workflowForbiddenError } from "../../workflows/workflows-error";
import { fieldGateOf } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
  escapeRegex,
  toObjectId,
} from "../form-access.service";
import {
  FormUserNames,
  type FormVersionRecord,
  toFormVersionModel,
  userRefOf,
} from "../form-mapper";
import { formModulePermission } from "../form-permission-keys";
import { fieldStatesOf, projectValues } from "../form-values/field-states";
import { SubmissionValuesService } from "../form-values/submission-values.service";
import { storedSummaryOf } from "../form-values/temporal-values";
import {
  conflictError,
  forbiddenError,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "../forms-error";
import {
  LookupProvidersService,
  lookupDisplayLabelOf,
} from "../lookup-providers";
import type { FormVersionPayload } from "../models/form-common.model";
import { projectFieldsForReader } from "./definition-projection";
import { DisplayNamesService } from "./display-names.service";
import {
  type CopySubmissionToDraftInput,
  type CreateAndSubmitFormSubmissionInput,
  type CreateFormDraftInput,
  DEFAULT_PAGE_SIZE,
  type DeleteFormSubmissionInput,
  type FormSubmissionsInput,
  MAX_PAGE_SIZE,
  type SaveFormDraftInput,
  type SubmitFormSubmissionInput,
  type UpdateFormSubmissionInput,
  type VoidSubmissionInput,
  type WithdrawSubmissionInput,
} from "./dto/form-runtime.input";
import {
  type DeleteFormSubmissionPayload,
  type FormSubmissionModel,
  type FormSubmissionRevisionMeta,
  FormSubmissionSort,
  FormSubmissionStatusEnum,
  type FormSubmissionsPayload,
  type FormSummary,
} from "./models/form-submission.model";
import { expressionContextOf } from "./revision-context";
import { assertSubmissionCapacity } from "./revision-limits";

type SubmissionRecord = Persisted<FormSubmissionDocument>;

/** 稽核動作名(`docs/modules/forms.md`「稽核」);值一律不進稽核(可能含受保護欄位)。 */
export const SUBMISSION_AUDIT = {
  createDraft: "submission.create-draft",
  saveDraft: "submission.save-draft",
  submit: "submission.submit",
  update: "submission.update",
  delete: "submission.delete",
  withdraw: "submission.withdraw",
  void: "submission.void",
  copy: "submission.copy",
  /** 複製為新單提交後,附件在 GCS 複製失敗、清空了那幾欄(交易外補記)。 */
  copyAttachmentsFailed: "submission.copy-attachments-failed",
  upgrade: "submission.upgrade",
} as const;

/** 申請人可以改內容(存草稿 / 再送出)的狀態:草稿、被退回、自己撤回。 */
const APPLICANT_EDITABLE: readonly FormSubmissionStatus[] = [
  "draft",
  "returned",
  "withdrawn",
];

/**
 * 只審過某些修訂的讀者(任務持有者)讀這筆提交時的限制:只列有權讀的修訂,
 * 摘要用該修訂實例上的快照(不讀提交最新的 `summary`)。
 */
/** 複製為新單的一個附件:交易內先把新路徑寫進新單,交易成功後才真的複製(TX-03)。 */
interface AttachmentCopy {
  fieldKey: string;
  from: string;
  to: string;
}

/** 複製為新單的結果;`cleared` 為 null = 這次是同一個 `clientRequestId` 的重試(回原本那一筆)。 */
interface CopyOutcome {
  record: SubmissionRecord;
  cleared: string[] | null;
}

interface RevisionRestriction {
  revisions: ReadonlySet<number>;
  summary: SubmissionSummary | null;
}

/** 可讀的一筆:原始文件、限制(全讀為 null)、實際要回的修訂號(null = 目前)。 */
interface ReadableSubmission {
  record: SubmissionRecord;
  restriction: RevisionRestriction | null;
  revision: number | null;
}

const SUBMISSION_TARGET = "form_submission";

/**
 * 列表與詳情的投影:`revisions[]` 只取最後一筆(目前修訂的 `ctx` 是條件上下文),不載入全部修訂快照;
 * 修訂紀錄跳窗(`revisions` 欄位)與讀某個修訂才另外讀。
 */
const LATEST_REVISION_ONLY = { revisions: { $slice: -1 } };

/** 修訂紀錄跳窗:全部修訂的 metadata(修訂號、版本、ctx、來由),不含值快照。 */
const REVISION_METADATA_ONLY = { "revisions.values": 0 };

const MAX_CLIENT_REQUEST_ID_LENGTH = 100;

const SORTS: Readonly<Record<FormSubmissionSort, Record<string, 1 | -1>>> = {
  [FormSubmissionSort.SUBMITTED_AT_DESC]: { submittedAt: -1, _id: -1 },
  [FormSubmissionSort.SUBMITTED_AT_ASC]: { submittedAt: 1, _id: 1 },
  [FormSubmissionSort.UPDATED_AT_DESC]: { updatedAt: -1, _id: -1 },
};

/** 碰過的欄位 key:只留這一版「使用者填」的欄位、去重(前端送什麼都不會存進多餘的鍵)。 */
export function touchedKeysOf(
  fields: readonly FieldDef[],
  touched: readonly string[],
): string[] {
  const inputs = new Set(
    fields
      .filter((field) => field.valueSource.kind === "input")
      .map((field) => field.key),
  );
  return [...new Set(touched)].filter((key) => inputs.has(key));
}

/** 版本定義快取的鍵。 */
function versionKeyOf(formKey: string, version: number): string {
  return `${formKey}@${String(version)}`;
}

export function definitionOf(version: FormVersionRecord): FormDefinition {
  return {
    fields: version.fields,
    layout: version.layout,
    summaryMap: version.summaryMap,
    prefills: version.prefills,
  };
}

/**
 * 表單提交(執行端):草稿 → 送出(即完成)→ 已完成後修改(修訂 +1、完整快照)。
 *
 * - 範圍:`form_submissions` 掛 `tenantScopePlugin({ moduleData: true })`,可見範圍與資料範圍規則
 *   (依 moduleKey)自動套用;草稿只屬於建立者本人(列表不列別人的草稿)
 * - **建立者一律讀得到自己的單**(單筆 `formSubmission(id)`):資料範圍規則把它擋在列表外時,
 *   單筆讀取改用「自己建立的」路徑(可見範圍照套、不套規則);列表**不放寬**
 * - 每次寫入帶 `expectedEditVersion`(已完成修改另帶 `expectedRevision`),條件更新不符 → 409;
 *   `values` / `summary` / `revision` / 快照 / `editVersion` 在**同一次**更新裡寫
 * - 值的寫入規則(四種不能填的原因與順序)在 `form-values/submission-values.service.ts`
 * - 掛接點(`workflows/workflow-engine/lifecycle/`):送出、修改已完成單、刪除、撤回、作廢在交易開頭、寫入之前
 *   呼叫守門;沒走流程的送出(`submitted` → `completed`)與作廢(`voided`)在寫入後、同一個交易內觸發事後動作
 */
/** 落庫狀態 → GraphQL enum(窮舉:新增狀態時編譯器會指到這裡)。 */
function submissionStatusOf(
  status: FormSubmissionStatus,
): FormSubmissionStatusEnum {
  switch (status) {
    case "draft": {
      return FormSubmissionStatusEnum.DRAFT;
    }
    case "reviewing": {
      return FormSubmissionStatusEnum.REVIEWING;
    }
    case "returned": {
      return FormSubmissionStatusEnum.RETURNED;
    }
    case "withdrawn": {
      return FormSubmissionStatusEnum.WITHDRAWN;
    }
    case "completed": {
      return FormSubmissionStatusEnum.COMPLETED;
    }
    case "rejected": {
      return FormSubmissionStatusEnum.REJECTED;
    }
    case "voided": {
      return FormSubmissionStatusEnum.VOIDED;
    }
  }
}

/** 可刪的已送出提交:不綁流程的已完成、已駁回(草稿另判)。 */
function isDeletableRecord(record: {
  status: FormSubmissionStatus;
  currentInstanceId: Types.ObjectId | null;
}): boolean {
  return (
    (record.status === "completed" && record.currentInstanceId === null) ||
    record.status === "rejected"
  );
}

/** 表單關了「允許存草稿」:建草稿、存草稿(狀態草稿)一律擋。 */
function draftDisabledError(formKey: string): Error {
  return forbiddenError(
    `Form ${formKey} does not allow saving drafts`,
    "DRAFT_DISABLED",
  );
}

/** 事後動作的單據資訊(掛接點)。 */
function effectSubjectOf(record: SubmissionRecord): EffectSubject {
  return {
    submissionId: record._id,
    tenantId: record.tenantId,
    orgId: record.orgId,
    moduleKey: record.moduleKey,
    formKey: record.formKey,
    revision: record.revision,
  };
}

function summaryModelOf(summary: SubmissionSummary | null): {
  title: string | null;
  date: string | null;
  amount: string | null;
} | null {
  return summary
    ? {
        title: summary.title,
        date: temporalIsoOf(summary.date),
        amount: summary.amount ?? null,
      }
    : null;
}

/**
 * 提交層的審核狀態欄位。只審過某修訂的讀者只給那個修訂快照 + 歷程:
 * 提交層的現況(目前實例、阻擋、作廢、複製)一律不給。
 */
function workflowFieldsOf(
  record: {
    currentInstanceId: Types.ObjectId | null;
    blocked: boolean;
    voidedAt: Date | null;
    voidReason: string | null;
    voidReasonKey?: string | null;
    voidReasonLabel?: string | null;
    replacedById: Types.ObjectId | null;
    copiedFrom: Types.ObjectId | null;
  },
  isRestricted: boolean,
): Pick<
  FormSubmissionModel,
  | "currentInstanceId"
  | "blocked"
  | "voidedAt"
  | "voidReason"
  | "voidReasonKey"
  | "voidReasonLabel"
  | "replacedById"
  | "copiedFrom"
> {
  if (isRestricted) {
    return {
      currentInstanceId: null,
      blocked: false,
      voidedAt: null,
      voidReason: null,
      voidReasonKey: null,
      voidReasonLabel: null,
      replacedById: null,
      copiedFrom: null,
    };
  }
  return {
    currentInstanceId: record.currentInstanceId
      ? String(record.currentInstanceId)
      : null,
    blocked: record.blocked,
    voidedAt: record.voidedAt,
    voidReason: record.voidReason,
    voidReasonKey: record.voidReasonKey ?? null,
    voidReasonLabel: record.voidReasonLabel ?? null,
    replacedById: record.replacedById ? String(record.replacedById) : null,
    copiedFrom: record.copiedFrom ? String(record.copiedFrom) : null,
  };
}

/** 引用存值的 id(不是 `{ id: string }` → null)。 */
function referenceIdOf(cell: unknown): string | null {
  const id = (cell as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : null;
}

@Injectable()
export class FormSubmissionsService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly forms: FormsRepository,
    private readonly access: FormAccessService,
    private readonly values: SubmissionValuesService,
    private readonly displayNames: DisplayNamesService,
    private readonly userNames: FormUserNames,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly lookups: LookupProvidersService,
    private readonly workflowSubmit: WorkflowSubmitService,
    private readonly readAccess: SubmissionReadAccess,
    private readonly withdrawal: InstanceWithdrawService,
    private readonly transactions: TransactionService,
    private readonly lifecycle: FormLifecycleService,
    private readonly cc: WorkflowCcService,
    private readonly serials: SerialService,
    private readonly fieldOptions: FieldOptionsService,
  ) {}

  // ---- 讀 ----

  /**
   * 新增選單:一張直接進、多張先選。每張附 `canCreate`(`canCreateWithForm`):
   * 清單本身也給列表的表單篩選與頁籤模板用,所以不在這裡刪掉不能新增的表單。
   */
  async moduleForms(
    facts: FormOperatorFacts,
    moduleKey: string,
  ): Promise<FormSummary[]> {
    await this.access.requireFormModule(facts.operator, moduleKey);
    this.access.assertRuntimeAccess(facts, moduleKey);
    const forms = await this.access.availableForms(facts, moduleKey);
    return forms.map((form) => ({
      key: form.key,
      name: form.name,
      moduleKey: form.moduleKey,
      currentVersion: form.currentVersion ?? 0,
      tabLabelTemplate: form.tabLabelTemplate,
      allowDraft: allowsDraft(form),
      canCreate: this.access.canCreateWithForm(facts, form.moduleKey, form.key),
    }));
  }

  /**
   * 填寫端讀某一版的定義(已發布或已退役;草稿不給)。依讀者權限投影:讀不到的欄位只回骨架
   * (`definition-projection.ts`),受保護欄位的固定值、選項、說明不經網路層外流。
   */
  async runtimeVersion(
    facts: FormOperatorFacts,
    formKey: string,
    version: number,
  ): Promise<FormVersionPayload> {
    const form = await this.access.findRuntimeForm(facts, formKey);
    if (!form) {
      throw notFoundError(`Form not found: ${formKey}`);
    }
    // 沒有業務模組權限的審核者(申請中心詳情頁)也要拿得到定義來渲染他審的那筆
    if (!(await this.readAccess.holdsTaskOnForm(facts, formKey))) {
      this.access.assertRuntimeAccess(facts, form.moduleKey, form.key);
    }
    const record = await this.versions.findOne(facts.operator, {
      formKey,
      version,
      status: { $in: ["published", "retired"] },
    });
    if (!record) {
      throw notFoundError(
        `Form version not found: ${formKey}@${String(version)}`,
      );
    }
    const names = await this.userNames.load(facts.operator, [
      record.publishedBy,
    ]);
    const gate = fieldGateOf(facts, form.moduleKey, form.key);
    const formVersion = toFormVersionModel(record, names);
    formVersion.fields = projectFieldsForReader(
      record.fields,
      gate,
    ) as unknown as Record<string, unknown>[];
    return { formVersion, validation: null };
  }

  async list(
    facts: FormOperatorFacts,
    input: FormSubmissionsInput,
  ): Promise<FormSubmissionsPayload> {
    this.access.assertModulePermission(facts, input.moduleKey, "view");
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const keyword = input.keyword?.trim();
    const filter: Record<string, unknown> = {
      moduleKey: input.moduleKey,
      ...(input.formKey ? { formKey: input.formKey } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(keyword
        ? { "summary.title": { $regex: escapeRegex(keyword), $options: "i" } }
        : {}),
      // 草稿只給建立者本人;其餘狀態(審核中 / 退回 / 撤回 / 完成 / 駁回 / 作廢)照可見範圍與資料範圍
      $or: [
        { status: { $ne: "draft" } },
        { status: "draft", createdBy: facts.operator.actorId },
      ],
    };
    const [totalCount, records] = await Promise.all([
      this.submissions.count(facts.operator, filter),
      this.submissions.findMany(facts.operator, filter, {
        select: LATEST_REVISION_ONLY,
        sort: SORTS[input.sort ?? FormSubmissionSort.SUBMITTED_AT_DESC],
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    ]);
    return {
      items: await this.toModels(facts, records, null),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 單筆;`revision` 省略 = 目前。建立者一律讀得到自己的單(不受資料範圍規則限縮)。 */
  async get(
    facts: FormOperatorFacts,
    id: string,
    revision: number | null | undefined,
  ): Promise<FormSubmissionModel> {
    const readable = await this.findReadable(facts, id, revision ?? null);
    const [model] = await this.toModels(
      facts,
      [readable.record],
      readable.revision,
      readable.restriction,
    );
    if (!model) {
      throw notFoundError(`Form submission not found: ${id}`);
    }
    return model;
  }

  /**
   * 修訂紀錄(`FormSubmissionModel.revisions`,只有修訂紀錄跳窗問才讀):全部修訂的 metadata、不載入值快照;
   * 只審過某些修訂的讀者只列那幾筆。每筆帶自己的版本(`revisions[r].version ?? submission.version`)。
   */
  async revisionEntries(
    facts: FormOperatorFacts,
    id: string,
  ): Promise<FormSubmissionRevisionMeta[]> {
    const readable = await this.findReadable(
      facts,
      id,
      null,
      REVISION_METADATA_ONLY,
    );
    const { record, restriction } = readable;
    const entries = record.revisions.filter(
      (item) =>
        restriction === null || restriction.revisions.has(item.revision),
    );
    const names = await this.userNames.load(
      facts.operator,
      entries.flatMap((item) => [item.ctx.userId, item.upgradedBy ?? null]),
    );
    return entries.map((item) => ({
      revision: item.revision,
      version: revisionVersionOf(record, item),
      kind: item.kind ?? null,
      upgradedBy: userRefOf(item.upgradedBy, names),
      upgradedAt: item.upgradedAt ?? null,
      at: item.ctx.at,
      user: userRefOf(item.ctx.userId, names),
    }));
  }

  /** 私有附件的短效下載網址:看得到這筆、看得到這一欄(欄位級權限)才簽。 */
  async attachmentUrl(
    facts: FormOperatorFacts,
    id: string,
    fieldKey: string,
    revision: number | null | undefined,
  ): Promise<string> {
    const readable = await this.findReadable(facts, id, revision ?? null);
    const record = readable.record;
    // 那個修訂自己的版本(舊版資料升級後,歷史修訂可能綁在較舊的版本)
    const viewed = this.viewedRevision(record, readable.revision);
    const version = await this.versionOf(facts.operator, {
      _id: record._id,
      formKey: record.formKey,
      version: viewed.version,
    });
    const field = version.fields.find(
      (candidate) => candidate.key === fieldKey,
    );
    if (field?.type !== "upload") {
      throw validationError(`Field ${fieldKey} is not an upload field`, [
        "fieldKey",
      ]);
    }
    const gate = fieldGateOf(facts, record.moduleKey, record.formKey);
    if (!gate.canShow(version.fields, fieldKey)) {
      throw forbiddenError(
        `Field ${fieldKey} is not readable by the operator`,
        "FIELD_FORBIDDEN",
      );
    }
    const stored = viewed.values[fieldKey] as
      { path?: unknown } | null | undefined;
    const url = await this.storage.readUrlOf(
      typeof stored?.path === "string" ? stored.path : null,
    );
    if (url === null) {
      throw notFoundError(`Submission ${id} has no file in ${fieldKey}`);
    }
    return url;
  }

  // ---- 寫 ----

  /**
   * 新增頁的 [存草稿] = 建草稿(一個交易:草稿 + 稽核);同 `(建立者, clientRequestId)` 重試回同一筆。
   * 表單關了「允許存草稿」→ `FORBIDDEN`(`DRAFT_DISABLED`),只能直接送出(`createAndSubmit`)。
   */
  async createDraft(
    facts: FormOperatorFacts,
    input: CreateFormDraftInput,
  ): Promise<FormSubmissionModel> {
    const clientRequestId = this.requireClientRequestId(input.clientRequestId);
    const retried = await this.findRetried(
      facts,
      input.formKey,
      clientRequestId,
    );
    if (retried) {
      return this.single(facts, retried);
    }
    const { form, version } = await this.creatableVersionOf(
      facts,
      input.formKey,
    );
    if (!allowsDraft(form)) {
      throw draftDisabledError(form.key);
    }
    const created = await this.orRetryWinner(
      facts,
      clientRequestId,
      () => form.key,
      () =>
        this.transactions.withTransaction(() =>
          this.insertDraft(
            facts,
            form,
            version,
            clientRequestId,
            { sent: input.values ?? {}, touched: input.touched ?? [] },
            null,
          ),
        ),
    );
    return this.single(facts, created);
  }

  /**
   * 新增頁的 [送出](不論表單開不開草稿):**一個交易**內建立 + 守門 + 送出,
   * 走與 `submit` 同一條送出路徑(`submitRecord`:全驗、`beforeSubmit` 守門、`submitted` / `completed`
   * 事後動作或進流程)。任一步失敗整個交易回復,資料庫不留任何資料(不產生草稿)。
   *
   * 同 `(建立者, clientRequestId)` 重試:已送出的回那一筆;是草稿(同一頁先前的存草稿其實成功了、
   * 畫面沒拿到回應)→ 還沒被改過(`editVersion = 0`)才以這次的值送出那一筆,否則 409
   * `EDIT_VERSION_MISMATCH`(TX-05:前端沒有預期版本可比,不蓋掉別處的修改)。
   */
  async createAndSubmit(
    facts: FormOperatorFacts,
    input: CreateAndSubmitFormSubmissionInput,
  ): Promise<FormSubmissionModel> {
    const clientRequestId = this.requireClientRequestId(input.clientRequestId);
    const retried = await this.findRetried(
      facts,
      input.formKey,
      clientRequestId,
    );
    if (retried) {
      if (retried.status !== "draft") {
        return this.single(facts, retried);
      }
      const submitted = await this.transactions.withTransaction(async () => {
        const record = await this.requireOwnSubmittable(
          facts,
          String(retried._id),
        );
        return this.submitRecord(facts, record, 0, {
          sent: input.values ?? {},
        });
      });
      return this.single(facts, submitted);
    }
    const { form, version } = await this.creatableVersionOf(
      facts,
      input.formKey,
    );
    const submitted = await this.orRetryWinner(
      facts,
      clientRequestId,
      () => form.key,
      () =>
        this.transactions.withTransaction(async () => {
          const created = await this.insertDraft(
            facts,
            form,
            version,
            clientRequestId,
            { sent: input.values ?? {}, touched: input.touched ?? [] },
            null,
            { skipAudit: true },
          );
          // 重讀成完整的一筆(與 `submit` 讀到的同一個形狀),再走同一條送出路徑
          const record = await this.requireOwnSubmittable(
            facts,
            String(created._id),
          );
          return this.submitRecord(facts, record, record.editVersion, {
            sent: null,
            audit: { direct: true },
          });
        }),
    );
    return this.single(facts, submitted);
  }

  /** 新增資格 + 綁定的版本(目前發布版);沒有發布版 → `FORBIDDEN`(`FORM_NOT_AVAILABLE`)。 */
  private async creatableVersionOf(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<{ form: FormRecord; version: FormVersionRecord }> {
    const form = await this.access.requireAvailableForm(facts, formKey);
    this.access.assertCanCreateWithForm(facts, form.moduleKey, form.key);
    const version = await this.versions.findOne(facts.operator, {
      formKey: form.key,
      version: form.currentVersion,
      status: "published",
    });
    if (version === null || (version.version ?? null) === null) {
      throw forbiddenError(
        `Form ${form.key} has no published version`,
        "FORM_NOT_AVAILABLE",
      );
    }
    return { form, version };
  }

  /**
   * 建一筆草稿(新增 / 複製為新單共用):值照 6a 的寫入規則(草稿放寬完成資料所需的驗證);
   * **預設值**在這裡算一次,只填使用者沒碰過、且送來 / 複製來的值是空的欄位。
   * 在呼叫端的交易內執行;同一次請求的重試同時到、另一個先建好了 → 唯一索引擋下、錯誤往外拋
   * (交易內不吞資料庫錯誤,TX-04),由呼叫端在交易外回那一筆(`orRetryWinner`)。
   */
  private async insertDraft(
    facts: FormOperatorFacts,
    form: FormRecord,
    version: FormVersionRecord,
    clientRequestId: string,
    initial: { sent: StoredValues; touched: readonly string[] },
    copiedFrom: Types.ObjectId | null,
    options: { skipAudit?: boolean } = {},
  ): Promise<SubmissionRecord> {
    const operator = facts.operator;
    const ctx = this.draftContext(facts);
    const touched = touchedKeysOf(version.fields, initial.touched);
    const defaults = await this.defaultsOf(
      facts,
      form,
      version.fields,
      initial.sent,
      touched,
      ctx,
    );
    const values = await this.values.apply({
      facts,
      moduleKey: form.moduleKey,
      formKey: form.key,
      fields: version.fields,
      // 預設值同時當「既有值」(`defaultsOf` 只算操作者改得動的欄位):`readonlyWhen` 一開始就成立的欄位
      // (原因 4 保留既有值)也留得住預設值
      base: defaults,
      sent: { ...initial.sent, ...defaults },
      previous: null,
      ctx,
      mode: "draft",
    });
    const created = await this.submissions.create(operator, {
      moduleKey: form.moduleKey,
      formKey: form.key,
      version: version.version ?? 0,
      values,
      summary: null,
      status: "draft",
      revision: 0,
      revisions: [],
      editVersion: 0,
      clientRequestId,
      submittedAt: null,
      copiedFrom,
      touched,
    });
    // 直接送出:這筆在同一個交易內就送出了,稽核只記送出(`direct: true`)
    if (options.skipAudit !== true) {
      await this.audit.record(operator, {
        action: SUBMISSION_AUDIT.createDraft,
        targetType: SUBMISSION_TARGET,
        targetId: created._id,
        after: {
          formKey: form.key,
          version: version.version,
          ...(copiedFrom === null ? {} : { copiedFrom: String(copiedFrom) }),
        },
      });
    }
    return created;
  }

  /**
   * 存草稿(一個交易):放寬完成資料所需的驗證,寫入守門照常;`expectedEditVersion` 不符 → 409。
   * 被退回 / 撤回的單也由申請人以此改內容(狀態不變,再送出才進下一個修訂)。
   * 狀態草稿、且表單關了「允許存草稿」→ `FORBIDDEN`(`DRAFT_DISABLED`;既有草稿只能送出或刪除)。
   */
  async saveDraft(
    facts: FormOperatorFacts,
    input: SaveFormDraftInput,
  ): Promise<FormSubmissionModel> {
    return this.transactions.withTransaction(async () => {
      const record = await this.requireOwnEditable(facts, input.id);
      if (
        record.status === "draft" &&
        !(await this.formAllowsDraft(facts, record.formKey))
      ) {
        throw draftDisabledError(record.formKey);
      }
      this.assertEditVersion(record, input.expectedEditVersion);
      const version = await this.versionOf(facts.operator, record);
      const values = await this.values.apply({
        facts,
        moduleKey: record.moduleKey,
        formKey: record.formKey,
        fields: version.fields,
        base: record.values,
        sent: input.values,
        previous: null,
        ctx: this.draftContext(facts),
        mode: "draft",
      });
      // 存草稿不加修訂,只看容量
      assertSubmissionCapacity(
        record,
        { set: { values } },
        { isWorkflowBound: false },
      );
      const updated = await this.submissions.findOwnAndUpdate(
        facts.operator,
        {
          _id: record._id,
          status: record.status,
          editVersion: input.expectedEditVersion,
        },
        {
          $set: {
            values,
            ...(input.touched === null || input.touched === undefined
              ? {}
              : { touched: touchedKeysOf(version.fields, input.touched) }),
          },
          $inc: { editVersion: 1 },
        },
      );
      if (!updated) {
        throw conflictError(
          `Submission ${input.id} was updated by someone else`,
          "EDIT_VERSION_MISMATCH",
        );
      }
      await this.audit.record(facts.operator, {
        action: SUBMISSION_AUDIT.saveDraft,
        targetType: SUBMISSION_TARGET,
        targetId: record._id,
        after: { editVersion: updated.editVersion },
      });
      return this.single(facts, updated);
    });
  }

  /**
   * 送出(草稿 / 被退回 / 撤回;`input.values` 有值 = 以畫面上的值送出,與送出同一個交易寫入):
   * 全驗、後端重算 computed、重取選項 / 引用 label、寫摘要,再依送出時檢查分兩條路(本體見
   * `submitRecord`)。提交已是 `reviewing`(重複送出):對原實例再推進一次(連同稽核一個交易),
   * 不驗、不看綁定、不增加修訂。版本已退役的既有草稿仍可送出(寬鬆)。
   */
  async submit(
    facts: FormOperatorFacts,
    input: SubmitFormSubmissionInput,
  ): Promise<FormSubmissionModel> {
    const record = await this.requireOwnSubmittable(facts, input.id);
    if (record.status === "reviewing") {
      await this.transactions.withTransaction(async () => {
        await this.workflowSubmit.resume(record);
        await this.audit.record(facts.operator, {
          action: SUBMISSION_AUDIT.submit,
          targetType: SUBMISSION_TARGET,
          targetId: record._id,
          after: {
            revision: record.revision,
            formKey: record.formKey,
            version: record.version,
            resumed: true,
          },
        });
      });
      return this.single(facts, await this.reloadOwn(facts, record));
    }
    const submitted = await this.transactions.withTransaction(() =>
      this.submitRecord(facts, record, input.expectedEditVersion, {
        sent: input.values ?? null,
      }),
    );
    return this.single(facts, submitted);
  }

  /**
   * 送出的本體(`submit` 與 `createAndSubmit` 共用同一條路徑;在呼叫端的交易內執行):
   *
   * - **不走流程**(沒綁、也沒進過審核):6a 行為 —— `completed`、`revision = 1`、`revisions[0]` = 快照 + ctx,
   *   `values` / `summary` / `revision` / `revisions` / `editVersion` 同一次更新,寫入後依序觸發
   *   `submitted`、`completed` 事後動作,與稽核同一個交易
   * - **走流程**:`WorkflowSubmitService` 建實例 → 提交連上並進 `reviewing` → 推進(送審不經過 `completed`)。
   *   被退回 / 撤回後再送出 = 修訂 +1、新實例
   *
   * 兩條路都在寫入前呼叫 `beforeSubmit` 守門;`sent` = 這次送來的值(null = 以存的值為準)。
   */
  private async submitRecord(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
    expectedEditVersion: number,
    options: { sent: StoredValues | null; audit?: Record<string, unknown> },
  ): Promise<SubmissionRecord> {
    this.assertEditVersion(record, expectedEditVersion);
    const version = await this.versionOf(facts.operator, record);
    const at = new Date();
    const ctx = this.revisionContext(facts, at);
    const values = await this.values.apply({
      facts,
      moduleKey: record.moduleKey,
      formKey: record.formKey,
      fields: version.fields,
      base: record.values,
      sent: options.sent,
      previous: record.revisions.at(-1)?.values ?? null,
      ctx: expressionContextOf(ctx),
      mode: "complete",
    });
    const summary = storedSummaryOf(
      computeSummary(definitionOf(version), values, {
        submittedAt: (record.submittedAt ?? at).toISOString(),
      }),
    );
    const route = await this.workflowSubmit.route(record);
    // 容量上限:走流程 = 修訂 +1 並 push 快照;不走流程 = 第一次送出,修訂只剩這一筆
    assertSubmissionCapacity(
      record,
      route.kind === "workflow"
        ? {
            set: { values, summary },
            pushRevision: {
              revision: record.revision + 1,
              version: record.version,
              values,
              ctx,
            },
          }
        : {
            set: {
              values,
              summary,
              revisions: [
                { revision: 1, version: record.version, values, ctx },
              ],
            },
          },
      { isWorkflowBound: route.kind === "workflow" },
    );
    await this.lifecycle.guard("beforeSubmit", {
      operator: facts.operator,
      submission: record,
      values,
    });
    if (route.kind === "workflow") {
      // 單號在驗證與守門都過了之後、送審寫入之前才取,與送審同一次寫入:
      // `submitted` 事後動作讀得到,持有計數器寫鎖的時間也最短
      const serialNo = await this.serialNoToGive(facts, record, at);
      await this.workflowSubmit.submit(
        facts.operator,
        record,
        expectedEditVersion,
        {
          values,
          summary,
          ctx,
          at,
          ...(serialNo === null ? {} : { serialNo }),
        },
        route,
      );
      await this.audit.record(facts.operator, {
        action: SUBMISSION_AUDIT.submit,
        targetType: SUBMISSION_TARGET,
        targetId: record._id,
        after: {
          revision: record.revision + 1,
          formKey: record.formKey,
          version: record.version,
          workflowKey: route.workflowKey,
          workflowVersion: route.workflowVersion,
          ...options.audit,
        },
      });
      return this.reloadOwn(facts, record);
    }
    // 不走流程:完成、修訂、事後動作與稽核在同一個交易(走流程的寫入由 WorkflowSubmitService 負責)。
    // 單號在寫入前最後一步才取,與完成同一次寫入(持有計數器寫鎖的時間最短)
    const serialNo = await this.serialNoToGive(facts, record, at);
    const updated = await this.submissions.findOwnAndUpdate(
      facts.operator,
      {
        _id: record._id,
        status: "draft",
        editVersion: expectedEditVersion,
      },
      {
        $set: {
          values,
          summary,
          status: "completed",
          revision: 1,
          revisions: [{ revision: 1, version: record.version, values, ctx }],
          submittedAt: at,
          ...(serialNo === null ? {} : { serialNo }),
        },
        $inc: { editVersion: 1 },
      },
    );
    if (!updated) {
      throw conflictError(
        `Submission ${String(record._id)} was updated by someone else`,
        "EDIT_VERSION_MISMATCH",
      );
    }
    // 沒走流程的單直接完成:先 submitted 再 completed(掛接點)
    const subject = effectSubjectOf(updated);
    await this.lifecycle.emit("submitted", subject);
    await this.lifecycle.emit("completed", subject);
    await this.audit.record(facts.operator, {
      action: SUBMISSION_AUDIT.submit,
      targetType: SUBMISSION_TARGET,
      targetId: record._id,
      after: {
        revision: 1,
        formKey: record.formKey,
        version: record.version,
        ...options.audit,
      },
    });
    return updated;
  }

  /** 已完成後修改(一個交易):修訂 +1 並存完整快照(需模組 `edit`);兩個預期值任一不符 → 409。 */
  async update(
    facts: FormOperatorFacts,
    input: UpdateFormSubmissionInput,
  ): Promise<FormSubmissionModel> {
    return this.transactions.withTransaction(async () => {
      const record = await this.submissions.findById(
        facts.operator,
        toObjectId(input.id, "id"),
      );
      if (record?.status !== "completed" || record.currentInstanceId !== null) {
        if (record) {
          // 綁流程的已完成(走過流程)鎖定、只能作廢
          throw conflictError(
            `Submission ${input.id} is not an editable completed submission`,
            "STATUS_MISMATCH",
          );
        }
        throw notFoundError(`Form submission not found: ${input.id}`);
      }
      this.access.assertModulePermission(facts, record.moduleKey, "edit");
      this.assertEditVersion(record, input.expectedEditVersion);
      if (record.revision !== input.expectedRevision) {
        throw conflictError(
          `Revision mismatch: expected ${String(input.expectedRevision)}, actual ${String(record.revision)}`,
          "REVISION_MISMATCH",
        );
      }
      const version = await this.versionOf(facts.operator, record);
      const at = new Date();
      const ctx = this.revisionContext(facts, at);
      const values = await this.values.apply({
        facts,
        moduleKey: record.moduleKey,
        formKey: record.formKey,
        fields: version.fields,
        base: record.values,
        sent: input.values,
        previous: record.values,
        ctx: expressionContextOf(ctx),
        mode: "complete",
      });
      const summary = storedSummaryOf(
        computeSummary(definitionOf(version), values, {
          submittedAt: (record.submittedAt ?? at).toISOString(),
        }),
      );
      const revision = record.revision + 1;
      assertSubmissionCapacity(
        record,
        {
          set: { values, summary },
          pushRevision: { revision, version: record.version, values, ctx },
        },
        { isWorkflowBound: await this.isWorkflowBound(facts, record) },
      );
      await this.lifecycle.guard("beforeEditCompleted", {
        operator: facts.operator,
        submission: record,
        values,
      });
      const updated = await this.submissions.findOneAndUpdate(
        facts.operator,
        {
          _id: record._id,
          status: "completed",
          currentInstanceId: null,
          editVersion: input.expectedEditVersion,
          revision: input.expectedRevision,
        },
        {
          $set: { values, summary, revision },
          $push: {
            revisions: { revision, version: record.version, values, ctx },
          },
          $inc: { editVersion: 1 },
        },
      );
      if (!updated) {
        throw conflictError(
          `Submission ${input.id} was updated by someone else`,
          "EDIT_VERSION_MISMATCH",
        );
      }
      await this.audit.record(facts.operator, {
        action: SUBMISSION_AUDIT.update,
        targetType: SUBMISSION_TARGET,
        targetId: record._id,
        before: { revision: record.revision },
        after: { revision },
      });
      return this.single(facts, updated);
    });
  }

  /** 刪除(軟刪除,一個交易):草稿 = 建立者本人 + `create`;已完成 = 模組 `delete`。 */
  async remove(
    facts: FormOperatorFacts,
    input: DeleteFormSubmissionInput,
  ): Promise<DeleteFormSubmissionPayload> {
    return this.transactions.withTransaction(async () => {
      const id = toObjectId(input.id, "id");
      const own = await this.submissions.findOwnById(facts.operator, id);
      let deleted: SubmissionRecord | null;
      let record: SubmissionRecord | null;
      if (own !== null && APPLICANT_EDITABLE.includes(own.status)) {
        // 草稿 / 被退回 / 已撤回:申請人本人可刪(實例已終局,推進只收尾它自己的任務與歷程)
        this.access.assertCanCreateWithForm(facts, own.moduleKey, own.formKey);
        record = own;
        await this.lifecycle.guard("beforeDelete", {
          operator: facts.operator,
          submission: own,
        });
        deleted = await this.submissions.findOwnAndUpdate(
          facts.operator,
          { _id: id, status: own.status },
          { $set: { deletedAt: new Date() } },
        );
      } else {
        record = await this.submissions.findById(facts.operator, id);
        // 別人的草稿一律不存在(草稿只屬於建立者)
        if (!record || record.status === "draft") {
          throw notFoundError(`Form submission not found: ${input.id}`);
        }
        // 可刪:不綁流程的已完成、已駁回;審核中 / 綁流程的已完成 / 作廢不可刪,
        // 退回 / 撤回只有申請人本人可刪(上一段)
        if (!isDeletableRecord(record)) {
          throw conflictError(
            `Submission ${input.id} cannot be deleted in status ${record.status}`,
            "STATUS_MISMATCH",
          );
        }
        this.access.assertModulePermission(facts, record.moduleKey, "delete");
        await this.lifecycle.guard("beforeDelete", {
          operator: facts.operator,
          submission: record,
        });
        deleted = await this.submissions.softDeleteById(facts.operator, id);
      }
      if (!deleted) {
        throw notFoundError(`Form submission not found: ${input.id}`);
      }
      await this.audit.record(facts.operator, {
        action: SUBMISSION_AUDIT.delete,
        targetType: SUBMISSION_TARGET,
        targetId: record._id,
        before: { status: record.status, revision: record.revision },
      });
      return { success: true, deletedId: String(record._id) };
    });
  }

  // ---- 審核流程的提交動作 ----

  /**
   * 撤回(申請人本人;審核中、還沒有任何被接受的審核意見):實例 CAS → `withdrawn`,
   * 推進收尾把提交同步成 `withdrawn`(可改後再送)。已有審核意見 → `CONFLICT`(`HAS_DECISIONS`)。
   * 看得到這筆(已送出過)、但不是申請人 → `FORBIDDEN`(`NOT_APPLICANT`),先於狀態檢查;
   * 看不到、或是別人的草稿 → `NOT_FOUND`(別人的草稿一律不存在,同 `remove` / `findReadable`)。
   * 一個交易(撤回、推進收尾、稽核;ADR-0013)。
   */
  async withdraw(
    facts: FormOperatorFacts,
    input: WithdrawSubmissionInput,
  ): Promise<FormSubmissionModel> {
    const withdrawn = await this.transactions.withTransaction(() =>
      this.withdrawOnce(facts, input),
    );
    return this.single(facts, withdrawn);
  }

  private async withdrawOnce(
    facts: FormOperatorFacts,
    input: WithdrawSubmissionInput,
  ): Promise<SubmissionRecord> {
    const id = toObjectId(input.id, "id");
    const record = await this.submissions.findOwnById(facts.operator, id);
    if (!record) {
      // 以讀者的可見範圍與資料範圍規則再查一次:看得到、且不是草稿才說「不是申請人」;
      // 看不到的、別人的草稿都不透露存在與否
      const visible = await this.submissions.findById(facts.operator, id);
      if (visible && visible.status !== "draft") {
        throw workflowForbiddenError(
          "Only the applicant can withdraw the submission",
          "NOT_APPLICANT",
        );
      }
      throw notFoundError(`Form submission not found: ${input.id}`);
    }
    if (record.status !== "reviewing" || record.currentInstanceId === null) {
      throw conflictError(
        `Submission ${input.id} is not under review`,
        "STATUS_MISMATCH",
      );
    }
    this.assertEditVersion(record, input.expectedEditVersion);
    await this.lifecycle.guard("beforeWithdraw", {
      operator: facts.operator,
      submission: record,
    });
    await this.withdrawal.withdraw(
      record.currentInstanceId,
      facts.operator.actorId ?? record._id,
    );
    await this.audit.record(facts.operator, {
      action: SUBMISSION_AUDIT.withdraw,
      targetType: SUBMISSION_TARGET,
      targetId: record._id,
      before: { revision: record.revision },
    });
    return this.reloadOwn(facts, record);
  }

  /**
   * 作廢(綁流程且已核准;申請人本人或有該模組 `edit` 者;原因必填;不需審核):提交 → `voided`,內容凍結。
   * 原因:表單沒設作廢原因類別 → 自由文字(`reasonNote` 必填);設了 → `reasonKey` 必填且是該類別啟用中的選項、
   * 選「其他」時 `reasonNote` 必填(`voidReasonOf`)。一個交易(提交更新與稽核;ADR-0013)。
   */
  async voidSubmission(
    facts: FormOperatorFacts,
    input: VoidSubmissionInput,
  ): Promise<FormSubmissionModel> {
    const voided = await this.transactions.withTransaction(() =>
      this.voidOnce(facts, input),
    );
    return this.single(facts, voided);
  }

  private async voidOnce(
    facts: FormOperatorFacts,
    input: VoidSubmissionInput,
  ): Promise<SubmissionRecord> {
    const id = toObjectId(input.id, "id");
    const own = await this.submissions.findOwnById(facts.operator, id);
    const record = own ?? (await this.submissions.findById(facts.operator, id));
    if (!record) {
      throw notFoundError(`Form submission not found: ${input.id}`);
    }
    if (own === null) {
      this.access.assertModulePermission(facts, record.moduleKey, "edit");
    }
    if (record.status !== "completed" || record.currentInstanceId === null) {
      throw conflictError(
        `Submission ${input.id} is not an approved workflow submission`,
        "STATUS_MISMATCH",
      );
    }
    this.assertEditVersion(record, input.expectedEditVersion);
    const voidReason = await this.voidReasonOf(facts, record.formKey, input);
    await this.lifecycle.guard("beforeVoid", {
      operator: facts.operator,
      submission: record,
      voidReason,
    });
    const filter = {
      _id: id,
      status: "completed" as const,
      currentInstanceId: { $ne: null },
      editVersion: input.expectedEditVersion,
    };
    const update = {
      $set: {
        status: "voided",
        voidedAt: new Date(),
        voidedBy: facts.operator.actorId,
        voidReason: voidReason.reasonNote,
        voidReasonKey: voidReason.reasonKey,
        voidReasonLabel: voidReason.reasonLabel,
      },
      $inc: { editVersion: 1 },
    };
    const updated =
      own === null
        ? await this.submissions.findOneAndUpdate(
            facts.operator,
            filter,
            update,
          )
        : await this.submissions.findOwnAndUpdate(
            facts.operator,
            filter,
            update,
          );
    if (!updated) {
      throw conflictError(
        `Submission ${input.id} was updated by someone else`,
        "EDIT_VERSION_MISMATCH",
      );
    }
    await this.lifecycle.emit("voided", effectSubjectOf(updated), {
      voidReason,
    });
    // 知會:單據被作廢 → 整個流程的知會對象(同一個交易)
    await this.cc.voided(record.currentInstanceId);
    await this.audit.record(facts.operator, {
      action: SUBMISSION_AUDIT.void,
      targetType: SUBMISSION_TARGET,
      targetId: record._id,
      before: { status: record.status, revision: record.revision },
      after: {
        status: "voided",
        reason: voidReason.reasonNote,
        ...(voidReason.reasonKey === null
          ? {}
          : { reasonKey: voidReason.reasonKey }),
      },
    });
    return updated;
  }

  /**
   * 作廢原因的驗證與整形:表單(`voidReasonCategoryKey`)沒設類別 → 自由文字,`reasonNote` 必填、不可帶
   * `reasonKey`;設了 → 底座原因檢查 `FieldOptionsService.assertReason`(`reasonKey` 必填且是該類別在操作者
   * 合併範圍內啟用中的選項;類別不存在 = 沒有選項;選「其他」時 `reasonNote` 必填)。
   * 不合 → `VALIDATION_FAILED`(`fields` 指到 `reasonKey` / `reasonNote`)。
   */
  private async voidReasonOf(
    facts: FormOperatorFacts,
    formKey: string,
    input: VoidSubmissionInput,
  ): Promise<FormVoidReason> {
    const form = await this.access.findForm(facts.operator, formKey);
    const categoryKey = form === null ? null : voidReasonCategoryOf(form);
    if (categoryKey !== null) {
      // 白名單只有這張表單設定的那一個類別
      return this.fieldOptions.assertReason(
        facts.operator,
        categoryKey,
        input,
        [categoryKey],
      );
    }
    if ((input.reasonKey?.trim() ?? "") !== "") {
      throw validationError(`Form ${formKey} has no void reason options`, [
        "reasonKey",
      ]);
    }
    const note = input.reasonNote.trim();
    if (note === "") {
      throw validationError("reasonNote is required", ["reasonNote"]);
    }
    return { reasonKey: null, reasonLabel: null, reasonNote: note };
  }

  /**
   * 複製為新單(`copySubmissionToDraft`,專用操作,不走一般帶入 / lookup):來源 = 已作廢、讀者讀得到全部內容;
   * 目標 = 同表單**目前可新增的版本**。只複製「讀者對來源有 `show`、目標版本有同 key 同型別的使用者填欄位、
   * 讀者對目標有 `edit`」的欄位;`computed` / `constant` 由目標版本重算;引用重驗來源可讀,失效 → 清空並列在
   * `clearedFields`;附件複製一份儲存路徑歸新單(沿用 6a 的上傳驗證)。`clientRequestId` 去重;
   * 新草稿記 `copiedFrom`,來源記 `replacedById`。
   */
  async copyToDraft(
    facts: FormOperatorFacts,
    input: CopySubmissionToDraftInput,
  ): Promise<FormSubmissionModel> {
    const clientRequestId = this.requireClientRequestId(input.clientRequestId);
    // 目標表單 = 來源的表單;交易內讀到來源後記下,撞重複鍵時在交易外以它核對重試
    const targetForm: { formKey: string | null } = { formKey: null };
    const outcome = await this.orRetryWinner(
      facts,
      clientRequestId,
      () => targetForm.formKey,
      () =>
        this.transactions.withTransaction(() =>
          this.copyToDraftInTransaction(
            facts,
            input,
            clientRequestId,
            targetForm,
          ),
        ),
      (winner): CopyOutcome => ({ record: winner, cleared: null }),
    );
    const model = await this.single(facts, outcome.record);
    if (outcome.cleared !== null) {
      model.clearedFields = outcome.cleared;
    }
    return model;
  }

  /**
   * 複製為新單的交易本體:新單、來源的 `replacedById`、稽核一起提交。附件只在新單寫上**新路徑**,
   * 真正的 GCS 複製排在交易成功之後(`afterCommit`);複製失敗 → 在交易外把那一欄清空、列進
   * `clearedFields`,另記一筆稽核 `submission.copy-attachments-failed`(失敗紀錄放在交易外,TX-04)。
   * 交易回復則一個都不複製。窗口:提交後、複製完成前行程當掉,新單會指向不存在的物件(讀取網址時才發現)。
   */
  private async copyToDraftInTransaction(
    facts: FormOperatorFacts,
    input: CopySubmissionToDraftInput,
    clientRequestId: string,
    targetForm: { formKey: string | null },
  ): Promise<CopyOutcome> {
    const readable = await this.findReadable(facts, input.id, null);
    const source = readable.record;
    targetForm.formKey = source.formKey;
    if (readable.restriction !== null) {
      throw forbiddenError(
        `Submission ${input.id} cannot be copied by a reviewer`,
      );
    }
    if (source.status !== "voided") {
      throw conflictError(
        `Only voided submissions can be copied (status ${source.status})`,
        "STATUS_MISMATCH",
      );
    }
    const retried = await this.findRetried(
      facts,
      source.formKey,
      clientRequestId,
    );
    if (retried) {
      return { record: retried, cleared: null };
    }
    if (source.replacedById !== null) {
      throw conflictError(
        `Submission ${input.id} was already copied to ${String(source.replacedById)}`,
        "ALREADY_COPIED",
      );
    }
    const form = await this.access.requireAvailableForm(facts, source.formKey);
    this.access.assertCanCreateWithForm(facts, form.moduleKey, form.key);
    const target = await this.versions.findOne(facts.operator, {
      formKey: form.key,
      version: form.currentVersion,
      status: "published",
    });
    if (target?.version === null || target === null) {
      throw forbiddenError(
        `Form ${form.key} has no published version`,
        "FORM_NOT_AVAILABLE",
      );
    }
    const sourceVersion = await this.versionOf(facts.operator, source);
    const copies: AttachmentCopy[] = [];
    const { values, cleared } = await this.copiedValues(
      facts,
      source,
      sourceVersion.fields,
      target.fields,
      copies,
    );
    // 複製來的值 = 來源使用者填的值,視為碰過(預設值不覆蓋、填寫時也不跟著重算)
    const created = await this.insertDraft(
      facts,
      form,
      target,
      clientRequestId,
      { sent: values, touched: Object.keys(values) },
      source._id,
    );
    const isOwner =
      facts.operator.actorId !== null &&
      source.createdBy?.equals(facts.operator.actorId) === true;
    const link = { $set: { replacedById: created._id } };
    const linkFilter = { _id: source._id, replacedById: null };
    await (isOwner
      ? this.submissions.findOwnAndUpdate(facts.operator, linkFilter, link)
      : this.submissions.findOneAndUpdate(facts.operator, linkFilter, link));
    await this.audit.record(facts.operator, {
      action: SUBMISSION_AUDIT.copy,
      targetType: SUBMISSION_TARGET,
      targetId: created._id,
      before: { sourceId: String(source._id) },
      after: {
        sourceId: String(source._id),
        newId: String(created._id),
        clearedFields: cleared,
      },
    });
    const outcome: CopyOutcome = { record: created, cleared };
    if (copies.length > 0) {
      afterCommit(async () => {
        const failed = await this.copyAttachments(copies);
        if (failed.length > 0) {
          outcome.record =
            (await this.submissions.findOwnAndUpdate(
              facts.operator,
              { _id: created._id },
              {
                $unset: Object.fromEntries(
                  failed.map((key) => [`values.${key}`, ""]),
                ),
              },
            )) ?? created;
          cleared.push(...failed);
          await this.audit.record(facts.operator, {
            action: SUBMISSION_AUDIT.copyAttachmentsFailed,
            targetType: SUBMISSION_TARGET,
            targetId: created._id,
            after: { clearedFields: failed },
          });
        }
      });
    }
    return outcome;
  }

  // ---- 內部 ----

  /**
   * 新草稿的預設值(只含這次要填的欄位):使用者沒碰過、送來的值是空的、操作者改得動的「使用者填」欄位。
   * 公式引用到操作者讀不到的欄位(含依賴鏈)→ 不算、留空(引用受保護欄位的規則同計算欄位)。
   * 引用欄的預設值(填寫者 / 填寫者的組織)在這裡重驗來源可讀並取 label;讀不到就留空。
   */
  private async defaultsOf(
    facts: FormOperatorFacts,
    form: FormRecord,
    fields: readonly FieldDef[],
    sent: StoredValues,
    touched: readonly string[],
    ctx: ExpressionContext,
  ): Promise<StoredValues> {
    const gate = fieldGateOf(facts, form.moduleKey, form.key);
    const skipped = new Set(touched);
    const working: StoredValues = { ...sent };
    const defaults: StoredValues = {};
    for (const field of defaultOrder(fields)) {
      if (
        skipped.has(field.key) ||
        !isEmptyValue(working[field.key]) ||
        !gate.canEdit(fields, field)
      ) {
        continue;
      }
      const refs =
        field.default?.kind === "expression"
          ? referencedFieldKeys(field.default.expr)
          : [];
      if (refs.some((key) => !gate.canShow(fields, key))) {
        continue;
      }
      let value: unknown = defaultValueOf(field, fields, working, ctx) ?? null;
      if (field.type === "reference" && value !== null) {
        value = await this.referenceDefaultOf(facts, field, value);
      }
      if (value !== null) {
        defaults[field.key] = value;
        working[field.key] = value;
      }
    }
    return defaults;
  }

  /** 引用欄預設值 `{ id }` → 重驗來源可讀並補 label;讀不到回 null。 */
  private async referenceDefaultOf(
    facts: FormOperatorFacts,
    field: FieldDef,
    value: unknown,
  ): Promise<unknown> {
    const id = (value as { id?: unknown }).id;
    const source = field.source;
    if (typeof id !== "string" || !source) {
      return null;
    }
    // 預設值只驗讀得到;連動篩選在送出時以最後的值重驗
    const [record] = await this.lookups.findByValues(
      facts,
      withoutLookupFilterVars(source),
      "id",
      [id],
      lookupLabelFieldsOf(source),
      { publicOnly: true },
    );
    return record ? { id, label: lookupDisplayLabelOf(record, source) } : null;
  }

  private requireClientRequestId(raw: string): string {
    const clientRequestId = raw.trim();
    if (
      clientRequestId === "" ||
      clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH
    ) {
      throw validationError("clientRequestId must be 1-100 characters", [
        "clientRequestId",
      ]);
    }
    return clientRequestId;
  }

  /**
   * 複製為新單要帶過去的值(見 `copyToDraft`);回值與被清空的引用欄位。搬值規則與舊版資料升級共用
   * `upgradeValues`(同 key 同型別的使用者填欄位、明細逐子欄),再篩讀者對來源有 `show`、對目標有 `edit` 的欄位。
   */
  private async copiedValues(
    facts: FormOperatorFacts,
    source: SubmissionRecord,
    sourceFields: readonly FieldDef[],
    targetFields: readonly FieldDef[],
    copies: AttachmentCopy[],
  ): Promise<{ values: StoredValues; cleared: string[] }> {
    const gate = fieldGateOf(facts, source.moduleKey, source.formKey);
    const carried = upgradeValues(
      { fields: sourceFields },
      { fields: targetFields },
      source.values,
    );
    const values: StoredValues = {};
    const cleared: string[] = [];
    for (const field of targetFields) {
      const value = carried[field.key];
      if (
        value === undefined ||
        !gate.canShow(sourceFields, field.key) ||
        !gate.canEdit(targetFields, field)
      ) {
        continue;
      }
      if (field.type === "array") {
        const copiedRows = await this.copiedRowsOf(facts, field, value);
        values[field.key] = copiedRows.rows;
        if (copiedRows.hasCleared) {
          cleared.push(field.key);
        }
        continue;
      }
      const copied = await this.copiedValueOf(facts, field, value, copies);
      if (copied === undefined) {
        cleared.push(field.key);
      } else {
        values[field.key] = copied;
      }
    }
    return { values, cleared };
  }

  /**
   * 明細列的複製值:每一列換新的 `rowId`(新單的列與來源的列是不同的列;子欄已由 `upgradeValues` 篩過)。
   * 引用子欄同表單層引用欄重驗來源可讀(每個子欄的 id 去重後一次 `findByValues`,`publicOnly`),
   * 讀不到的格清成 null,`hasCleared` 讓呼叫端把明細欄列進 `clearedFields`;其他格照原值(不重新帶入)。
   */
  private async copiedRowsOf(
    facts: FormOperatorFacts,
    field: FieldDef,
    value: unknown,
  ): Promise<{ rows: ArrayRowValue[]; hasCleared: boolean }> {
    const rows: ArrayRowValue[] = arrayRowsOf(value).map((row) => ({
      ...row,
      rowId: randomUUID(),
    }));
    let hasCleared = false;
    for (const column of arrayColumnsOf(field)) {
      if (column.type !== "reference") {
        continue;
      }
      const filled = rows.filter(
        (row) => row[column.key] !== null && row[column.key] !== undefined,
      );
      const ids = [
        ...new Set(
          filled.flatMap((row) => {
            const id = referenceIdOf(row[column.key]);
            return id === null ? [] : [id];
          }),
        ),
      ];
      const source = column.source;
      const records =
        source && ids.length > 0
          ? await this.lookups.findByValues(
              facts,
              // 複製只重驗讀得到(保留值);連動篩選在送出時以最後的值重驗
              withoutLookupFilterVars(source),
              "id",
              ids,
              [source.labelField],
              { publicOnly: true },
            )
          : [];
      const readable = new Set(records.map((record) => record.id));
      for (const row of filled) {
        const id = referenceIdOf(row[column.key]);
        if (id === null || !readable.has(id)) {
          row[column.key] = null;
          hasCleared = true;
        }
      }
    }
    return { rows, hasCleared };
  }

  /**
   * 一欄的複製值(明細列見 `copiedRowsOf`):引用失效、附件不是本 API 簽出的路徑 → undefined(清空並列在 `clearedFields`)。
   * 附件只配新路徑並記進 `copies`,真的複製在交易成功之後(`copyAttachments`)。
   */
  private async copiedValueOf(
    facts: FormOperatorFacts,
    field: FieldDef,
    value: unknown,
    copies: AttachmentCopy[],
  ): Promise<unknown> {
    if (field.type === "reference") {
      const id = (value as { id?: unknown }).id;
      const source = field.source;
      if (typeof id !== "string" || !source) {
        return undefined;
      }
      const [record] = await this.lookups.findByValues(
        facts,
        withoutLookupFilterVars(source),
        "id",
        [id],
        [source.labelField],
        { publicOnly: true },
      );
      return record ? value : undefined;
    }
    if (field.type === "upload") {
      const upload = value as Record<string, unknown>;
      // 目標版本的欄位上限改窄了、舊附件不符 → 清空該欄(列進 clearedFields),不擋整張複製
      if (uploadLimitIssue(field, upload) !== null) {
        return undefined;
      }
      const from = typeof upload.path === "string" ? upload.path : null;
      const to = this.storage.privateCopyPathOf(from);
      if (from === null || to === null) {
        return undefined;
      }
      copies.push({ fieldKey: field.key, from, to });
      return { ...upload, path: to };
    }
    return value;
  }

  /**
   * 交易成功後真的複製附件;回複製不成的欄位 key(供應商端失敗:不擋整張新單,
   * 由呼叫端清空該欄並提示使用者重傳)。
   */
  private async copyAttachments(
    copies: readonly AttachmentCopy[],
  ): Promise<string[]> {
    const failed: string[] = [];
    for (const copy of copies) {
      try {
        const path = await this.storage.copyPrivateObject(copy.from, copy.to);
        if (path === null) {
          failed.push(copy.fieldKey);
        }
      } catch {
        failed.push(copy.fieldKey);
      }
    }
    return failed;
  }

  /**
   * 這筆對操作者允許的動作(含權限,業務模組那一種 `abilities`):
   * - 改:申請人改草稿 / 退回 / 撤回(`create`);不綁流程的已完成(`edit`);綁流程的已完成鎖定
   * - 刪:草稿 / 被退回 / 撤回 = 申請人本人(`create`);不綁流程的已完成 / 已駁回(`delete`)
   * - 撤回:申請人、審核中;作廢:綁流程的已完成、申請人或 `edit`;複製為新單:已作廢 + `create`
   */
  private abilitiesOf(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
    isOwner: boolean,
    allowDraft: boolean,
  ): {
    canEdit: boolean;
    canSaveDraft: boolean;
    canDelete: boolean;
    canWithdraw: boolean;
    canVoid: boolean;
    canCopy: boolean;
  } {
    const can = (action: "view" | "edit" | "delete"): boolean =>
      this.access.has(facts, formModulePermission(record.moduleKey, action));
    const canCreate = this.access.canCreateWithForm(
      facts,
      record.moduleKey,
      record.formKey,
    );
    const isBound = record.currentInstanceId !== null;
    const isApplicantEditable =
      isOwner && APPLICANT_EDITABLE.includes(record.status) && canCreate;
    const canEdit =
      isApplicantEditable ||
      (record.status === "completed" && !isBound && can("edit"));
    const canDelete =
      APPLICANT_EDITABLE.includes(record.status) && isOwner
        ? isApplicantEditable
        : isDeletableRecord(record) && can("delete");
    return {
      canEdit,
      canSaveDraft: isApplicantEditable && allowDraft,
      canDelete,
      canWithdraw: isOwner && record.status === "reviewing",
      canVoid:
        record.status === "completed" && isBound && (isOwner || can("edit")),
      canCopy: record.status === "voided" && canCreate,
    };
  }

  /** 重讀自己的一筆(寫入後回傳最新狀態)。 */
  private async reloadOwn(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
  ): Promise<SubmissionRecord> {
    return (
      (await this.submissions.findOwnById(facts.operator, record._id)) ?? record
    );
  }

  /**
   * 單筆讀取的範圍(`canReadSubmissionRevision`):
   *
   * 1. 一般路徑(可見範圍 + 資料範圍規則)或「自己建立的」路徑讀得到:建立者一律可讀(含所有修訂);
   *    別人的草稿一律不存在;其他人要模組 `view`
   * 2. 讀不到或沒有 `view`:以讀者的租戶為邊界找提交,任務持有者(現在或曾經)**只**讀他審過的那幾個修訂
   *    (`revision` 省略 = 其中最新的一個),摘要改用該修訂實例上的快照
   */
  private async findReadable(
    facts: FormOperatorFacts,
    id: string,
    revision: number | null,
    select: FindOptions["select"] = LATEST_REVISION_ONLY,
  ): Promise<ReadableSubmission> {
    const objectId = toObjectId(id, "id");
    const record = await this.findInScope(facts, objectId, select);
    const isOwner =
      record !== null &&
      facts.operator.actorId !== null &&
      record.createdBy?.equals(facts.operator.actorId) === true;
    if (record && (isOwner || this.canViewModule(facts, record))) {
      if (record.status === "draft" && !isOwner) {
        throw notFoundError(`Form submission not found: ${id}`);
      }
      record.revisions = await this.revisionsToView(
        facts,
        record,
        revision,
        select,
      );
      return { record, restriction: null, revision };
    }
    const stored = await this.readAccess.findInTenant(facts, objectId);
    const readable = stored
      ? await this.readAccess.readableRevisions(facts, stored)
      : ({ kind: "none" } as const);
    if (stored === null || readable.kind === "none") {
      if (record && record.status !== "draft") {
        throw forbiddenError(`Missing permission ${record.moduleKey}.view`);
      }
      throw notFoundError(`Form submission not found: ${id}`);
    }
    const asRecord = stored as unknown as SubmissionRecord;
    if (readable.kind === "all") {
      return { record: asRecord, restriction: null, revision };
    }
    const target = revision ?? Math.max(...readable.revisions);
    if (!readable.revisions.has(target)) {
      throw forbiddenError(
        `Revision ${String(target)} of submission ${id} is not readable by the operator`,
      );
    }
    return {
      record: asRecord,
      restriction: {
        revisions: readable.revisions,
        summary: await this.readAccess.revisionSummaryOf(stored._id, target),
      },
      revision: target,
    };
  }

  /**
   * 讀某個修訂時只多取那一筆快照(列表 / 詳情的投影只有最後一筆);讀目前、或呼叫端給了別的投影 → 照讀到的。
   */
  private async revisionsToView(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
    revision: number | null,
    select: FindOptions["select"],
  ): Promise<FormRevision[]> {
    if (revision === null || select !== LATEST_REVISION_ONLY) {
      return record.revisions;
    }
    const one = await this.findInScope(facts, record._id, {
      revisions: { $elemMatch: { revision } },
    });
    return one?.revisions ?? [];
  }

  /** 一般路徑(可見範圍 + 資料範圍規則)或「自己建立的」路徑找一筆(投影由呼叫端給)。 */
  private async findInScope(
    facts: FormOperatorFacts,
    id: Types.ObjectId,
    select: FindOptions["select"],
  ): Promise<SubmissionRecord | null> {
    return (
      (await this.submissions.findById(facts.operator, id, { select })) ??
      (await this.submissions.findOwnOne(
        facts.operator,
        { _id: id },
        { select },
      ))
    );
  }

  private canViewModule(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
  ): boolean {
    return this.access.has(
      facts,
      formModulePermission(record.moduleKey, "view"),
    );
  }

  /** 申請人改內容(存草稿):草稿 / 被退回 / 撤回;其他狀態 → 409,不是自己的 → 不存在。 */
  private async requireOwnEditable(
    facts: FormOperatorFacts,
    id: string,
  ): Promise<SubmissionRecord> {
    return this.requireOwnIn(facts, id, APPLICANT_EDITABLE);
  }

  /** 送出:可改內容的三種 + 審核中(同一次送出的重試,第 0 步接續)。 */
  private async requireOwnSubmittable(
    facts: FormOperatorFacts,
    id: string,
  ): Promise<SubmissionRecord> {
    return this.requireOwnIn(facts, id, [...APPLICANT_EDITABLE, "reviewing"]);
  }

  private async requireOwnIn(
    facts: FormOperatorFacts,
    id: string,
    statuses: readonly FormSubmissionStatus[],
  ): Promise<SubmissionRecord> {
    const record = await this.submissions.findOwnById(
      facts.operator,
      toObjectId(id, "id"),
    );
    if (!record) {
      throw notFoundError(`Form submission not found: ${id}`);
    }
    if (!statuses.includes(record.status)) {
      throw conflictError(
        `Submission ${id} cannot be changed in status ${record.status}`,
        "STATUS_MISMATCH",
      );
    }
    this.access.assertCanCreateWithForm(
      facts,
      record.moduleKey,
      record.formKey,
    );
    return record;
  }

  private assertEditVersion(record: SubmissionRecord, expected: number): void {
    if (record.editVersion !== expected) {
      throw conflictError(
        `Edit version mismatch: expected ${String(expected)}, actual ${String(record.editVersion)}`,
        "EDIT_VERSION_MISMATCH",
      );
    }
  }

  /**
   * 建新單的交易撞到 `clientRequestId` 唯一索引(同一次請求的重試同時到、另一個先提交了):
   * 交易已整個回復,在交易外查回贏的那一筆(TX-04:交易內不吞資料庫錯誤)。
   */
  private async orRetryWinner<T = SubmissionRecord>(
    facts: FormOperatorFacts,
    clientRequestId: string,
    formKeyOf: () => string | null,
    run: () => Promise<T>,
    fromWinner: (winner: SubmissionRecord) => T = (winner) =>
      winner as unknown as T,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const formKey = formKeyOf();
      if (isDuplicateKeyError(error) && formKey !== null) {
        // 與交易內的重試核對同一條契約:不同表單或已刪 → 409 `CLIENT_REQUEST_REUSED`
        const winner = await this.findRetried(facts, formKey, clientRequestId);
        if (winner) {
          return fromWinner(winner);
        }
      }
      throw error;
    }
  }

  /** `clientRequestId` 的重試:同一人同一個 id 已建過 → 回那一筆(不同表單或已刪 → 409)。 */
  private async findRetried(
    facts: FormOperatorFacts,
    formKey: string,
    clientRequestId: string,
  ): Promise<SubmissionRecord | null> {
    const existing = await this.submissions.findOwnOne(
      facts.operator,
      { clientRequestId },
      { includeDeleted: true },
    );
    if (!existing) {
      return null;
    }
    if (existing.formKey !== formKey || existing.deletedAt !== null) {
      throw conflictError(
        `clientRequestId ${clientRequestId} was already used`,
        "CLIENT_REQUEST_REUSED",
      );
    }
    return existing;
  }

  private async versionOf(
    operator: OperatorContext,
    record: Pick<SubmissionRecord, "_id" | "formKey" | "version">,
  ): Promise<FormVersionRecord> {
    const version = await this.versions.findOne(operator, {
      formKey: record.formKey,
      version: record.version,
    });
    if (!version) {
      throw new Error(
        `提交 ${String(record._id)} 綁的版本 ${record.formKey}@${String(record.version)} 不存在`,
      );
    }
    return version;
  }

  /**
   * **單號**:表單設了單號格式、這筆還沒有號 → 第一次送出時給號(`SerialService`,`form:<formKey>`,
   * 依提交歸屬組織的租戶計數、送出時點以租戶時區切期間);已經有號(退回 / 撤回後再送)或表單沒設格式 → null。
   * 在送出的交易內、**其他驗證與守門都通過之後**、這次送出的寫入之前才呼叫(取號會持有計數器的寫鎖到交易結束),
   * 號碼與送出 / 送審同一次寫入,`submitted` 事後動作讀得到;送出失敗,號碼一起回復。
   */
  private async serialNoToGive(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
    at: Date,
  ): Promise<string | null> {
    if ((record.serialNo ?? null) !== null) {
      return null;
    }
    const form = await this.forms.findOne(facts.operator, {
      key: record.formKey,
    });
    const format = normalizeSerialFormat(form?.serial ?? null);
    if (format === null) {
      return null;
    }
    return this.serials.next(facts.operator, `form:${record.formKey}`, format, {
      at,
      orgId: record.orgId,
    });
  }

  /** 這張表單允不允許存草稿(表單設定;缺席 = 開)。 */
  private async formAllowsDraft(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<boolean> {
    const form = await this.forms.findOne(facts.operator, { key: formKey });
    return form === null || allowsDraft(form);
  }

  /** 這筆提交所屬租戶的這張表單綁了流程嗎(修訂次數上限只對綁流程的表單)。 */
  private async isWorkflowBound(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
  ): Promise<boolean> {
    const form = await this.forms.findOne(facts.operator, {
      key: record.formKey,
    });
    return (
      form !== null &&
      (await this.access.hasWorkflowBinding(record.tenantId, form._id))
    );
  }

  /** 草稿的條件上下文:真正的現在與填寫者本人。 */
  private draftContext(facts: FormOperatorFacts): ExpressionContext {
    return expressionContextOf(this.revisionContext(facts, new Date()));
  }

  private revisionContext(
    facts: FormOperatorFacts,
    at: Date,
  ): FormRevision["ctx"] {
    return {
      at,
      timezone: facts.timezone,
      userId: facts.operator.actorId,
      orgId: facts.operator.currentOrgId,
      orgIds: [...facts.operator.memberOrgIds],
      tenantId: facts.tenantId,
    };
  }

  /**
   * 讀哪一個修訂的值、ctx 與渲染用的版本(`revisions[r].version ?? submission.version`);
   * `revision` 不存在 → `NOT_FOUND`。目前 = 提交的值與版本、最後一筆修訂的 ctx(草稿為 null)。
   */
  private viewedRevision(
    record: SubmissionRecord,
    revision: number | null,
  ): {
    revision: number;
    version: number;
    values: StoredValues;
    ctx: FormRevision["ctx"] | null;
  } {
    if (revision === null) {
      const latest = record.revisions.at(-1);
      return {
        revision: record.revision,
        version: record.version,
        values: record.values,
        ctx: latest?.ctx ?? null,
      };
    }
    const found = record.revisions.find((entry) => entry.revision === revision);
    if (!found) {
      throw notFoundError(
        `Revision ${String(revision)} of submission ${String(record._id)} not found`,
      );
    }
    return {
      revision,
      version: revisionVersionOf(record, found),
      values: found.values,
      ctx: found.ctx,
    };
  }

  private async single(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
  ): Promise<FormSubmissionModel> {
    const [model] = await this.toModels(facts, [record], null);
    if (!model) {
      throw notFoundError(`Form submission not found: ${String(record._id)}`);
    }
    return model;
  }

  /**
   * 對外形狀(整頁一次組):讀者沒有 `show` 的欄位投影成 `"[redacted]"`(看**現在的讀者**);
   * 條件用該修訂的 `ctx` 重算(草稿用現在與建立者);不重算、不清空存值;顯示名批次解析。
   */
  private async toModels(
    facts: FormOperatorFacts,
    records: readonly SubmissionRecord[],
    revision: number | null,
    restriction: RevisionRestriction | null = null,
  ): Promise<FormSubmissionModel[]> {
    const operator = facts.operator;
    const versionCache = new Map<string, FormVersionRecord>();
    const formsByKey = new Map<
      string,
      { name: string | null; allowDraft: boolean }
    >();
    for (const record of records) {
      // 目前的版本(能改哪些欄)與這次看的修訂自己的版本(渲染、投影);升級過的提交兩者可能不同
      const versions = new Set([
        record.version,
        this.viewedRevision(record, revision).version,
      ]);
      for (const version of versions) {
        const cacheKey = versionKeyOf(record.formKey, version);
        if (!versionCache.has(cacheKey)) {
          versionCache.set(
            cacheKey,
            await this.versionOf(operator, {
              _id: record._id,
              formKey: record.formKey,
              version,
            }),
          );
        }
      }
      if (!formsByKey.has(record.formKey)) {
        const form = await this.forms.findOne(operator, {
          key: record.formKey,
        });
        formsByKey.set(record.formKey, {
          name: form?.name ?? null,
          allowDraft: form === null || allowsDraft(form),
        });
      }
    }
    const names = await this.userNames.load(
      operator,
      records.map((record) => record.createdBy),
    );

    const prepared = records.map((record) => {
      const viewed = this.viewedRevision(record, revision);
      const fields: readonly FieldDef[] =
        versionCache.get(versionKeyOf(record.formKey, viewed.version))
          ?.fields ?? [];
      const currentFields: readonly FieldDef[] =
        versionCache.get(versionKeyOf(record.formKey, record.version))
          ?.fields ?? [];
      const gate = fieldGateOf(facts, record.moduleKey, record.formKey);
      const conditionCtx = viewed.ctx
        ? expressionContextOf(viewed.ctx)
        : expressionContextOf({
            at: new Date(),
            timezone: facts.timezone,
            userId: record.createdBy,
            orgId: record.orgId,
          });
      return {
        record,
        fields,
        currentFields,
        viewed,
        gate,
        projected: projectValues(fields, viewed.values, gate),
        fieldStates: fieldStatesOf(fields, viewed.values, conditionCtx, gate),
      };
    });
    const displays = await this.displayNames.resolve(
      facts,
      prepared.map((entry) => ({
        fields: entry.fields,
        values: entry.projected,
      })),
    );

    return prepared.map((entry, index): FormSubmissionModel => {
      const { record, currentFields, viewed, gate } = entry;
      const isOwner =
        facts.operator.actorId !== null &&
        record.createdBy?.equals(facts.operator.actorId) === true;
      const abilities =
        restriction === null
          ? this.abilitiesOf(
              facts,
              record,
              isOwner,
              formsByKey.get(record.formKey)?.allowDraft ?? true,
            )
          : {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canWithdraw: false,
              canVoid: false,
              canCopy: false,
            };
      return {
        id: String(record._id),
        moduleKey: record.moduleKey,
        formKey: record.formKey,
        formName: formsByKey.get(record.formKey)?.name ?? null,
        version: record.version,
        status: submissionStatusOf(record.status),
        revision: record.revision,
        viewedRevision: viewed.revision,
        values: entry.projected,
        fieldStates: entry.fieldStates,
        displayValues: displays[index] ?? [],
        summary: summaryModelOf(
          restriction === null ? record.summary : restriction.summary,
        ),
        ctx: viewed.ctx
          ? {
              at: viewed.ctx.at,
              timezone: viewed.ctx.timezone,
              userId: viewed.ctx.userId ? String(viewed.ctx.userId) : null,
              orgId: viewed.ctx.orgId ? String(viewed.ctx.orgId) : null,
              orgIds: (viewed.ctx.orgIds ?? []).map(String),
              tenantId: viewed.ctx.tenantId
                ? String(viewed.ctx.tenantId)
                : null,
            }
          : null,
        viewedVersion: viewed.version,
        editVersion: record.editVersion,
        orgId: String(record.orgId),
        createdBy: userRefOf(record.createdBy, names),
        serialNo: record.serialNo ?? null,
        submittedAt: record.submittedAt,
        touched: record.touched,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...workflowFieldsOf(record, restriction !== null),
        clearedFields: [],
        abilities: {
          ...abilities,
          canEditField: abilities.canEdit
            ? currentFields
                .filter((field) => gate.canEdit(currentFields, field))
                .map((field) => field.key)
            : [],
        },
      };
    });
  }
}
