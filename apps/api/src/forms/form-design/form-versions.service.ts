import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type ExpressionContext,
  type FormDefinition,
  computeSummary,
  temporalIsoOf,
} from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import {
  FormVersionsRepository,
  FormsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { TransactionService } from "../../database/transaction";
import { retireCurrentVersion } from "../../versioning/version-lifecycle";
import type { FieldGate } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
} from "../form-access.service";
import {
  FormUserNames,
  type FormVersionRecord,
  toFormVersionModel,
  toValidationReport,
} from "../form-mapper";
import { fieldStatesOf } from "../form-values/field-states";
import { SubmissionValuesService } from "../form-values/submission-values.service";
import {
  conflictError,
  definitionInvalidError,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "../forms-error";
import type {
  FormValidationReport,
  FormVersionModel,
  FormVersionPayload,
} from "../models/form-common.model";
import type {
  CreateFormVersionDraftInput,
  DeleteFormVersionDraftInput,
  PreviewFormVersionInput,
  RetireCurrentVersionInput,
  SaveFormVersionDraftInput,
  ValidateFormVersionInput,
} from "./dto/form-design.input";
import { FormDefinitionChecker, definitionOf } from "./form-definition-checker";
import {
  FORM_VERSION_AUDIT,
  FORM_VERSION_TARGET,
  FormPublishService,
} from "./form-publish.service";
import type {
  FormPreviewPayload,
  FormVersionsPayload,
} from "./models/form.model";

/** 存草稿時就要擋的錯(Spec §5「正則」:存草稿與發布時驗過 ReDoS 才收);其餘錯誤草稿可以先存。 */
const DRAFT_BLOCKING_CODES = new Set(["PATTERN_INVALID", "PATTERN_UNSAFE"]);

const EMPTY_DEFINITION: FormDefinition = {
  fields: [],
  layout: { sections: [] },
  summaryMap: {},
  prefills: [],
};

/**
 * 表單版本(設計端):讀、開草稿、存草稿、檢查器、預覽、退役目前版本;發布在 `FormPublishService`。
 * 草稿一張表單同時只有一份(部分唯一索引);`draftRevision` 是存草稿與發布的樂觀鎖。
 */
@Injectable()
export class FormVersionsService {
  constructor(
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly checker: FormDefinitionChecker,
    private readonly publisher: FormPublishService,
    private readonly values: SubmissionValuesService,
    private readonly userNames: FormUserNames,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 某一版;`version` 省略 = 草稿(附檢查器結果)。 */
  async get(
    facts: FormOperatorFacts,
    formKey: string,
    version: number | null | undefined,
  ): Promise<FormVersionPayload> {
    const form = await this.access.requireReadableForm(facts, formKey);
    const record =
      version === null || version === undefined
        ? await this.versions.findOne(facts.operator, {
            formKey: form.key,
            status: "draft",
          })
        : await this.versions.findOne(facts.operator, {
            formKey: form.key,
            version,
          });
    if (!record) {
      throw notFoundError(
        `Form version not found: ${formKey}@${String(version ?? "draft")}`,
      );
    }
    return this.payloadOf(facts, form, record);
  }

  /** 版本面板:全部版本(草稿在最前,其餘新到舊)。 */
  async list(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormVersionsPayload> {
    const form = await this.access.requireReadableForm(facts, formKey);
    const records = await this.versions.findMany(
      facts.operator,
      { formKey: form.key },
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
      items: ordered.map((record) => toFormVersionModel(record, names)),
      totalCount: ordered.length,
    };
  }

  /**
   * 以任一版(已發布 / 退役)為基底開草稿;已有草稿 / 發布中 → 409。
   * `internal.draftId`:預先配好的草稿 id,只給內部的受管定義安裝用(GraphQL input 不收)。
   */
  async createDraft(
    facts: FormOperatorFacts,
    input: CreateFormVersionDraftInput,
    internal: { draftId?: Types.ObjectId } = {},
  ): Promise<FormVersionPayload> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    const existing = await this.versions.findOne(operator, {
      formKey: form.key,
      status: "draft",
    });
    if (existing) {
      throw conflictError(
        `Form ${form.key} already has a draft`,
        "DRAFT_EXISTS",
      );
    }
    const base = await this.baseDefinitionOf(operator, form, input.baseVersion);
    let created: FormVersionRecord;
    try {
      created = await this.versions.create(operator, {
        ...(internal.draftId === undefined ? {} : { _id: internal.draftId }),
        formKey: form.key,
        version: null,
        status: "draft",
        draftRevision: 0,
        baseVersion: input.baseVersion ?? null,
        ...base,
        changelog: null,
        publishedAt: null,
        publishedBy: null,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw conflictError(
          `Form ${form.key} already has a draft`,
          "DRAFT_EXISTS",
        );
      }
      throw error;
    }
    await this.audit.record(operator, {
      action: FORM_VERSION_AUDIT.createDraft,
      targetType: FORM_VERSION_TARGET,
      targetId: created._id,
      after: { formKey: form.key, baseVersion: input.baseVersion ?? null },
    });
    return this.payloadOf(facts, form, created);
  }

  /** 基底版本的定義(複製欄位、版面、摘要槽、帶入規則);不給 = 空白。 */
  async baseDefinitionOf(
    operator: OperatorContext,
    form: FormRecord,
    baseVersion: number | null | undefined,
  ): Promise<FormDefinition> {
    if (baseVersion === null || baseVersion === undefined) {
      return { ...EMPTY_DEFINITION, layout: { sections: [] } };
    }
    const source = await this.versions.findOne(operator, {
      formKey: form.key,
      version: baseVersion,
      status: { $in: ["published", "retired"] },
    });
    if (!source) {
      throw validationError(
        `Version ${String(baseVersion)} of ${form.key} cannot be a base`,
        ["baseVersion"],
      );
    }
    return {
      fields: source.fields,
      layout: source.layout,
      summaryMap: source.summaryMap,
      prefills: source.prefills,
    };
  }

  /**
   * 存草稿(`expectedDraftRevision` 樂觀鎖);檢查器的錯草稿可以先存,但正則不安全不收。
   * `internal.draftId`:只給內部的受管定義安裝用 —— 只存**那一份**草稿(id 在更新條件裡);
   * 它已被刪掉、現在的草稿是別人另開的 → `DRAFT_MISSING`,不會因為 revision 剛好相同而改到別人的草稿。
   */
  async saveDraft(
    facts: FormOperatorFacts,
    input: SaveFormVersionDraftInput,
    internal: { draftId?: Types.ObjectId } = {},
  ): Promise<FormVersionPayload> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    const definition = definitionOf(input);
    const report = await this.checker.check(facts, form, definition);
    const blocking = report.errors.filter((issue) =>
      DRAFT_BLOCKING_CODES.has(issue.code),
    );
    if (blocking.length > 0) {
      throw definitionInvalidError(
        "Draft has an invalid or unsafe regular expression",
        blocking,
      );
    }
    const ownDraft =
      internal.draftId === undefined ? {} : { _id: internal.draftId };
    const updated = await this.versions.findOneAndUpdate(
      operator,
      {
        ...ownDraft,
        formKey: form.key,
        status: "draft",
        draftRevision: input.expectedDraftRevision,
      },
      {
        $set: {
          fields: definition.fields,
          layout: definition.layout,
          summaryMap: definition.summaryMap,
          prefills: definition.prefills,
        },
        $inc: { draftRevision: 1 },
      },
    );
    if (!updated) {
      const draft = await this.versions.findOne(operator, {
        ...ownDraft,
        formKey: form.key,
        status: "draft",
      });
      throw draft
        ? conflictError(
            `Draft revision mismatch: expected ${String(input.expectedDraftRevision)}, actual ${String(draft.draftRevision)}`,
            "DRAFT_REVISION_MISMATCH",
          )
        : conflictError(`Form ${form.key} has no draft`, "DRAFT_MISSING");
    }
    await this.audit.record(operator, {
      action: FORM_VERSION_AUDIT.saveDraft,
      targetType: FORM_VERSION_TARGET,
      targetId: updated._id,
      after: {
        formKey: form.key,
        draftRevision: updated.draftRevision,
        fieldCount: definition.fields.length,
      },
    });
    return {
      formVersion: await this.modelOf(operator, updated),
      validation: toValidationReport(report),
    };
  }

  /**
   * 刪除草稿(`deleteFormVersionDraft`):條件 = 還是草稿、`draftRevision` 是讀到的那一份;
   * 刪掉後可以再以任一版本為基底開新草稿。
   *
   * **硬刪**(`hardDeleteDraft`,ADR-0007 第三種):草稿從未發布、沒有提交綁它;軟刪除會佔住
   * `(formKey, status)` 的部分唯一索引,讓這張表單永遠開不了新草稿。單一條件刪除
   * (`draftRevision` 也在條件裡),同時來的存草稿與刪除只有一個成立;沒刪到再查草稿分辨是
   * revision 不符還是沒有草稿。刪掉的整份定義寫進稽核的 `before`(刪除後寫,用回傳的文件)。
   */
  async deleteDraft(
    facts: FormOperatorFacts,
    input: DeleteFormVersionDraftInput,
  ): Promise<FormRecord> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    const deleted = await this.versions.hardDeleteDraft(operator, {
      formKey: form.key,
      status: "draft",
      version: null,
      draftRevision: input.expectedDraftRevision,
    });
    if (!deleted) {
      const draft = await this.versions.findOne(operator, {
        formKey: form.key,
        status: "draft",
      });
      throw draft
        ? conflictError(
            `Draft revision mismatch: expected ${String(input.expectedDraftRevision)}, actual ${String(draft.draftRevision)}`,
            "DRAFT_REVISION_MISMATCH",
          )
        : conflictError(`Form ${form.key} has no draft`, "DRAFT_MISSING");
    }
    await this.audit.record(operator, {
      action: FORM_VERSION_AUDIT.deleteDraft,
      targetType: FORM_VERSION_TARGET,
      targetId: deleted._id,
      // 刪掉的整份定義留在稽核(硬刪後唯一的紀錄;定義不含提交的值)
      before: {
        formKey: form.key,
        draftRevision: deleted.draftRevision,
        baseVersion: deleted.baseVersion,
        fields: deleted.fields,
        layout: deleted.layout,
        summaryMap: deleted.summaryMap,
        prefills: deleted.prefills,
      },
    });
    return form;
  }

  /** 設計器即時檢查,不落庫。 */
  async validate(
    facts: FormOperatorFacts,
    input: ValidateFormVersionInput,
  ): Promise<FormValidationReport> {
    const form = await this.access.requireReadableForm(facts, input.formKey);
    return toValidationReport(
      await this.checker.check(facts, form, definitionOf(input)),
    );
  }

  /**
   * 退役目前版本(帶當時看到的 `expectedVersion`,一個交易):`published → retired`,再 `currentVersion → null`,
   * 連同稽核一起提交或一起回復;同一版再退役一次什麼都不改;`currentVersion` 已指向別的版本 → 409。
   */
  async retireCurrent(
    facts: FormOperatorFacts,
    input: RetireCurrentVersionInput,
  ): Promise<FormRecord> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    return this.transactions.withTransaction(async () => {
      const retired = await retireCurrentVersion(
        this.publisher.lifecycle(operator),
        { key: form.key, currentVersion: form.currentVersion },
        input.expectedVersion,
      );
      const updated = await this.forms.findById(operator, form._id);
      if (!updated) {
        throw notFoundError(`Form not found: ${input.formKey}`);
      }
      // 重複退役(兩步都已是目標狀態、什麼都沒改)不寫稽核
      if (retired || form.currentVersion !== null) {
        await this.audit.record(operator, {
          action: FORM_VERSION_AUDIT.retire,
          targetType: FORM_VERSION_TARGET,
          ...(retired ? { targetId: retired._id } : {}),
          before: { formKey: form.key, currentVersion: form.currentVersion },
          after: { currentVersion: null },
        });
      }
      return updated;
    });
  }

  /**
   * 設計器「預覽」:對**草稿**(`version` 缺席)或**指定的已發布 / 已退役版本**跑計算與條件
   * (以真正的現在與操作者本人為 `ctx`),不建提交。版本面板檢視歷史版本時的預覽走後者。
   * 預覽不套欄位級權限(設計者看得到整張表單);「以某角色檢視」留給前端切換。
   */
  async preview(
    facts: FormOperatorFacts,
    input: PreviewFormVersionInput,
  ): Promise<FormPreviewPayload> {
    const form = await this.access.requireReadableForm(facts, input.formKey);
    const isDraft = input.version === null || input.version === undefined;
    const target = await this.versions.findOne(
      facts.operator,
      isDraft
        ? { formKey: form.key, status: "draft" }
        : {
            formKey: form.key,
            version: input.version,
            status: { $in: ["published", "retired"] },
          },
    );
    if (!target) {
      throw notFoundError(
        `Form version not found: ${form.key}@${String(input.version ?? "draft")}`,
      );
    }
    // 「不套欄位級權限」只指**本表單**的欄位:閘門只對本表單全開;lookup / 引用的來源
    // 照樣用操作者真實的權限(否則設計者可以用預覽讀出別張表單的受保護欄位)
    const designerGate: FieldGate = {
      canShow: () => true,
      canEdit: (_fields, field) => field.valueSource.kind === "input",
    };
    const ctx = contextOf(facts);
    const { values, issues } = await this.values.evaluate({
      facts,
      gate: designerGate,
      moduleKey: form.moduleKey,
      formKey: form.key,
      fields: target.fields,
      base: {},
      sent: input.values ?? {},
      previous: null,
      ctx,
      mode: "complete",
    });
    const summary = computeSummary(target, values, { submittedAt: ctx.now });
    return {
      values,
      fieldStates: fieldStatesOf(target.fields, values, ctx, designerGate),
      summary: {
        title: summary.title,
        date: temporalIsoOf(summary.date),
        amount: summary.amount ?? null,
      },
      fieldErrors: issues,
    };
  }

  private async payloadOf(
    facts: FormOperatorFacts,
    form: FormRecord,
    record: FormVersionRecord,
  ): Promise<FormVersionPayload> {
    const validation =
      record.status === "draft"
        ? toValidationReport(
            await this.checker.check(facts, form, {
              fields: record.fields,
              layout: record.layout,
              summaryMap: record.summaryMap,
              prefills: record.prefills,
            }),
          )
        : null;
    return {
      formVersion: await this.modelOf(facts.operator, record),
      validation,
    };
  }

  private async modelOf(
    operator: OperatorContext,
    record: FormVersionRecord,
  ): Promise<FormVersionModel> {
    const names = await this.userNames.load(operator, [record.publishedBy]);
    return toFormVersionModel(record, names);
  }
}

/** 草稿 / 預覽用真正的現在與操作者本人(Spec §5「歷史檢視的上下文」的草稿那一半)。 */
export function contextOf(facts: FormOperatorFacts): ExpressionContext {
  return {
    now: new Date().toISOString(),
    timezone: facts.timezone,
    user: {
      id: facts.operator.actorId ? String(facts.operator.actorId) : null,
      orgId: facts.operator.currentOrgId
        ? String(facts.operator.currentOrgId)
        : null,
      orgIds: facts.operator.memberOrgIds.map(String),
    },
    tenant: { id: facts.tenantId ? String(facts.tenantId) : null },
  };
}
