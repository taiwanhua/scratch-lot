import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { isValidFormKey } from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import { BusinessRelationshipsRepository } from "../../database/business-relationships.repository";
import {
  FormVersionsRepository,
  FormsRepository,
  ModulesRepository,
  OrgsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { allowsDraft } from "../../database/schemas/form.schema";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
  escapeRegex,
  toObjectId,
} from "../form-access.service";
import { FORMS_PERMISSIONS } from "../form-permission-keys";
import {
  conflictError,
  forbiddenError,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "../forms-error";
import {
  type AssignFormToTenantsInput,
  type CreateFormInput,
  DEFAULT_PAGE_SIZE,
  type ForkFormInput,
  type FormsInput,
  MAX_PAGE_SIZE,
  type RevokeFormFromTenantInput,
  type SetTenantFormEnabledInput,
  type UpdateFormInput,
} from "./dto/form-design.input";
import { FormVersionsService } from "./form-versions.service";
import type {
  FormAssignment,
  FormModel,
  FormsPayload,
} from "./models/form.model";

/** 稽核動作名(`docs/modules/forms.md`「稽核」)。 */
export const FORM_AUDIT = {
  create: "form.create",
  update: "form.update",
  fork: "form.fork",
  assign: "form.assign",
  revoke: "form.revoke",
  setEnabled: "form.set-enabled",
} as const;

const FORM_TARGET = "form";

/**
 * 只給內部呼叫端(受管定義的安裝,`seed/`)的選項;GraphQL input 不收這些。
 * `definitionId`:預先配好的表單 id(安裝紀錄先記下 id 再建立,中斷後認得出自己建的那一筆)。
 */
export interface CreateFormInternalOptions {
  definitionId?: Types.ObjectId;
}

/**
 * 只給內部呼叫端的條件更新(CAS):還是同一筆表單(`definitionId`)、`currentVersion`、名稱、頁籤模板與允許存草稿
 * 都還是 `expected` 才寫(條件與寫入在同一次更新裡判斷)。比對之後被別人改名、發布 / 退役了別的版本、
 * 或表單被刪掉重建 → `CONFLICT`(`METADATA_CHANGED`),不蓋掉現場的值。
 */
export interface UpdateFormInternalOptions {
  expected?: {
    definitionId: Types.ObjectId;
    currentVersion: number | null;
    name: string;
    tabLabelTemplate: string | null;
    /** 允許存草稿(缺席的舊資料 = 開) */
    allowDraft: boolean;
  };
}

/** 讀組織只取名稱等判斷用欄位,不受管理範圍影響。 */
function orgReader(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

function requireName(value: string, field = "name"): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw validationError(`${field} is required`, [field]);
  }
  return trimmed;
}

/**
 * 表單(設計端):清單、建立、改名、以某版本為基底建新表單、分派 / 收回、租戶啟用。
 * 誰看得到 / 改得動哪一張的判準在 `FormAccessService`(一份,設計端與執行端共用)。
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly modules: ModulesRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: BusinessRelationshipsRepository,
    private readonly access: FormAccessService,
    private readonly versionsService: FormVersionsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    facts: FormOperatorFacts,
    input: FormsInput,
  ): Promise<FormsPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const visibility = await this.access.designVisibilityFilter(facts);
    const keyword = input.keyword?.trim();
    const conditions: Record<string, unknown>[] = [
      ...(visibility ? [visibility] : []),
      ...(input.moduleKey ? [{ moduleKey: input.moduleKey }] : []),
      ...(keyword
        ? [
            {
              $or: [
                { key: { $regex: escapeRegex(keyword), $options: "i" } },
                { name: { $regex: escapeRegex(keyword), $options: "i" } },
              ],
            },
          ]
        : []),
    ];
    const filter = conditions.length > 0 ? { $and: conditions } : {};
    const [totalCount, records] = await Promise.all([
      this.forms.count(facts.operator, filter),
      this.forms.findMany(facts.operator, filter, {
        sort: { moduleKey: 1, key: 1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    ]);
    const items: FormModel[] = [];
    for (const record of records) {
      items.push(await this.toModel(facts, record));
    }
    return { items, totalCount, page, pageSize };
  }

  async get(facts: FormOperatorFacts, key: string): Promise<FormModel> {
    return this.toModel(
      facts,
      await this.access.requireReadableForm(facts, key),
    );
  }

  /** 建共用表單:只有站在根組織才能建(租戶的表單一律以某共用表單為基底 fork)。 */
  async create(
    facts: FormOperatorFacts,
    input: CreateFormInput,
    internal: CreateFormInternalOptions = {},
  ): Promise<FormModel> {
    if (!facts.isRoot) {
      throw forbiddenError(
        "Only the root org can create shared forms; tenants fork one",
        "ROOT_ONLY",
      );
    }
    const key = this.requireFormKey(input.key);
    const name = requireName(input.name);
    await this.access.requireFormModule(facts.operator, input.moduleKey);
    const created = await this.insertForm(
      facts.operator,
      {
        key,
        moduleKey: input.moduleKey,
        name,
        ownerOrgId: null,
        forkedFrom: null,
      },
      internal.definitionId,
    );
    await this.audit.record(facts.operator, {
      action: FORM_AUDIT.create,
      targetType: FORM_TARGET,
      targetId: created._id,
      after: { key, moduleKey: input.moduleKey, name },
    });
    return this.toModel(facts, created);
  }

  /** 改名稱 / 頁籤模板(key 建立後不可改;欄位級權限的 `name` 在下次發布時跟著更新)。 */
  async update(
    facts: FormOperatorFacts,
    input: UpdateFormInput,
    internal: UpdateFormInternalOptions = {},
  ): Promise<FormModel> {
    const form = await this.access.requireWritableForm(facts, input.key);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== null) {
      set.name = requireName(input.name);
    }
    if (input.tabLabelTemplate !== undefined) {
      const template = input.tabLabelTemplate?.trim() ?? "";
      set.tabLabelTemplate = template === "" ? null : template;
    }
    if (input.allowDraft !== undefined && input.allowDraft !== null) {
      set.allowDraft = input.allowDraft;
    }
    if (Object.keys(set).length === 0) {
      return this.toModel(facts, form);
    }
    const { expected } = internal;
    const updated = await this.forms.findOneAndUpdate(
      facts.operator,
      expected === undefined
        ? { _id: form._id }
        : {
            _id: expected.definitionId,
            key: form.key,
            currentVersion: expected.currentVersion,
            name: expected.name,
            tabLabelTemplate: expected.tabLabelTemplate,
            // 缺席 = 開:預期開時「不是 false」都算
            allowDraft: expected.allowDraft ? { $ne: false } : false,
          },
      { $set: set },
    );
    if (!updated) {
      throw expected === undefined
        ? notFoundError(`Form not found: ${input.key}`)
        : conflictError(
            `Form ${input.key} identity, current version, name, tab label template or allow-draft changed`,
            "METADATA_CHANGED",
          );
    }
    await this.audit.record(facts.operator, {
      action: FORM_AUDIT.update,
      targetType: FORM_TARGET,
      targetId: form._id,
      before: {
        name: form.name,
        tabLabelTemplate: form.tabLabelTemplate,
        ...("allowDraft" in set ? { allowDraft: allowsDraft(form) } : {}),
      },
      after: set,
    });
    return this.toModel(facts, updated);
  }

  /**
   * 以某表單的某一版為基底建新表單(同模組)+ 一份草稿:
   * - 站在根組織 → 共用表單(`ownerOrgId = null`,之後再分派)
   * - 站在租戶內 → 客製表單(`ownerOrgId = 租戶頂層`),**自動建本租戶的 `org_form`**(預設啟用)
   * 來源必須讀得到(租戶只能以分派來的或自己的表單為基底),版本必須已發布或已退役。
   */
  async fork(
    facts: FormOperatorFacts,
    input: ForkFormInput,
  ): Promise<FormModel> {
    const operator = facts.operator;
    const source = await this.access.requireReadableForm(
      facts,
      input.sourceKey,
    );
    const key = this.requireFormKey(input.key);
    const name = requireName(input.name);
    const definition = await this.versionsService.baseDefinitionOf(
      operator,
      source,
      input.sourceVersion,
    );
    const ownerOrgId = facts.isRoot ? null : facts.tenantId;
    if (!facts.isRoot && ownerOrgId === null) {
      throw forbiddenError("Operator is not inside a tenant", "NOT_FORM_OWNER");
    }
    const created = await this.insertForm(operator, {
      key,
      moduleKey: source.moduleKey,
      name,
      ownerOrgId,
      forkedFrom: { formKey: source.key, version: input.sourceVersion },
    });
    // 以下兩筆寫入失敗時,表單已建好但缺草稿 / 分派:都可再補(開草稿、root 分派),不做補償刪除
    await this.versions.create(operator, {
      formKey: key,
      version: null,
      status: "draft",
      draftRevision: 0,
      baseVersion: null,
      ...definition,
      changelog: null,
      publishedAt: null,
      publishedBy: null,
    });
    if (ownerOrgId !== null) {
      await this.relations.create(operator, ownerOrgId, {
        type: "org_form",
        firstId: ownerOrgId,
        secondId: created._id,
        meta: { enabled: true },
      });
    }
    await this.audit.record(operator, {
      action: FORM_AUDIT.fork,
      targetType: FORM_TARGET,
      targetId: created._id,
      after: {
        key,
        name,
        forkedFrom: { formKey: source.key, version: input.sourceVersion },
      },
    });
    return this.toModel(facts, created);
  }

  /** root 分派共用表單給租戶(建 `org_form`,預設啟用);已分派的略過(冪等)。 */
  async assign(
    facts: FormOperatorFacts,
    input: AssignFormToTenantsInput,
  ): Promise<FormModel> {
    const form = await this.requireAssignable(facts, input.formKey);
    const added: string[] = [];
    for (const raw of input.tenantOrgIds) {
      const tenantId = await this.relations.tenantIdFor(
        facts.operator,
        toObjectId(raw, "tenantOrgIds"),
      );
      const existing = await this.relations.findOne(tenantId, {
        type: "org_form",
        secondId: form._id,
      });
      if (existing) {
        continue;
      }
      try {
        await this.relations.create(facts.operator, tenantId, {
          type: "org_form",
          firstId: tenantId,
          secondId: form._id,
          meta: { enabled: true },
        });
        added.push(String(tenantId));
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }
    }
    if (added.length > 0) {
      await this.audit.record(facts.operator, {
        action: FORM_AUDIT.assign,
        targetType: FORM_TARGET,
        targetId: form._id,
        after: { tenantOrgIds: added },
      });
    }
    return this.toModel(facts, form);
  }

  /** root 收回分派(刪 `org_form`):租戶不能再新增,歷史提交照常看。 */
  async revoke(
    facts: FormOperatorFacts,
    input: RevokeFormFromTenantInput,
  ): Promise<FormModel> {
    const form = await this.requireAssignable(facts, input.formKey);
    const tenantId = await this.relations.tenantIdFor(
      facts.operator,
      toObjectId(input.tenantOrgId, "tenantOrgId"),
    );
    const removed = await this.relations.deleteMany(tenantId, {
      type: "org_form",
      secondId: form._id,
    });
    if (removed > 0) {
      await this.audit.record(facts.operator, {
        action: FORM_AUDIT.revoke,
        targetType: FORM_TARGET,
        targetId: form._id,
        before: { tenantOrgId: String(tenantId) },
      });
    }
    return this.toModel(facts, form);
  }

  /** 租戶管理員開關本租戶的表單(`org_form.meta.enabled`);關了不能新增,歷史照看。 */
  async setTenantEnabled(
    facts: FormOperatorFacts,
    input: SetTenantFormEnabledInput,
  ): Promise<FormModel> {
    const form = await this.access.requireReadableForm(facts, input.formKey);
    if (facts.tenantId === null) {
      throw forbiddenError(
        "Tenant form switches are set from inside the tenant",
        "NOT_FORM_OWNER",
      );
    }
    const before = await this.relations.findOne(facts.tenantId, {
      type: "org_form",
      secondId: form._id,
    });
    const updated = await this.relations.setMeta(
      facts.operator,
      facts.tenantId,
      { type: "org_form", secondId: form._id },
      { ...before?.meta, enabled: input.enabled },
    );
    if (!updated) {
      throw notFoundError(`Form ${form.key} is not assigned to this tenant`);
    }
    await this.audit.record(facts.operator, {
      action: FORM_AUDIT.setEnabled,
      targetType: FORM_TARGET,
      targetId: form._id,
      before: { enabled: before?.meta?.enabled ?? null },
      after: { enabled: input.enabled },
    });
    return this.toModel(facts, form);
  }

  // ---- 內部 ----

  /** 分派 / 收回:站在根組織 + 共用表單。 */
  private async requireAssignable(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormRecord> {
    if (!facts.isRoot) {
      throw forbiddenError("Only the root org can assign forms", "ROOT_ONLY");
    }
    const form = await this.access.requireReadableForm(facts, formKey);
    if (form.ownerOrgId !== null) {
      throw forbiddenError(
        `Form ${formKey} is a tenant's own form and cannot be assigned`,
        "NOT_FORM_OWNER",
      );
    }
    return form;
  }

  private requireFormKey(key: string): string {
    if (!isValidFormKey(key)) {
      throw validationError(`Invalid form key: ${key}`, ["key"]);
    }
    return key;
  }

  /** 建表單;key 撞名(唯一索引)→ `VALIDATION_FAILED`(`fields: ["key"]`)。 */
  private async insertForm(
    operator: OperatorContext,
    data: {
      key: string;
      moduleKey: string;
      name: string;
      ownerOrgId: Types.ObjectId | null;
      forkedFrom: { formKey: string; version: number } | null;
    },
    definitionId?: Types.ObjectId,
  ): Promise<FormRecord> {
    try {
      return await this.forms.create(operator, {
        ...(definitionId === undefined ? {} : { _id: definitionId }),
        ...data,
        currentVersion: null,
        tabLabelTemplate: null,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw validationError(`Form key already exists: ${data.key}`, ["key"]);
      }
      throw error;
    }
  }

  private async toModel(
    facts: FormOperatorFacts,
    form: FormRecord,
  ): Promise<FormModel> {
    const operator = facts.operator;
    const [module, owner, draft] = await Promise.all([
      this.modules.findOne(operator, { key: form.moduleKey }),
      form.ownerOrgId
        ? this.orgs.findById(orgReader(operator), form.ownerOrgId)
        : null,
      this.versions.findOne(operator, { formKey: form.key, status: "draft" }),
    ]);
    const tenantLink =
      facts.tenantId === null
        ? null
        : await this.relations.findOne(facts.tenantId, {
            type: "org_form",
            secondId: form._id,
          });
    const assignments =
      facts.isRoot && form.ownerOrgId === null
        ? await this.assignmentsOf(operator, form)
        : [];
    const canWrite = this.access.canWriteDesign(facts, form);
    return {
      id: String(form._id),
      key: form.key,
      moduleKey: form.moduleKey,
      moduleName: module?.name ?? null,
      name: form.name,
      isShared: form.ownerOrgId === null,
      ownerOrgId: form.ownerOrgId ? String(form.ownerOrgId) : null,
      ownerOrgName: owner?.name ?? null,
      forkedFrom: form.forkedFrom,
      currentVersion: form.currentVersion,
      tabLabelTemplate: form.tabLabelTemplate,
      allowDraft: allowsDraft(form),
      hasDraft: draft !== null,
      tenantEnabled:
        tenantLink === null ? null : tenantLink.meta?.enabled === true,
      assignments,
      abilities: {
        canEdit: canWrite && this.access.has(facts, FORMS_PERMISSIONS.edit),
        canAssign:
          facts.isRoot &&
          form.ownerOrgId === null &&
          this.access.has(facts, FORMS_PERMISSIONS.assign),
        canSetEnabled:
          tenantLink !== null &&
          this.access.has(facts, FORMS_PERMISSIONS.setEnabled),
        canFork: this.access.has(facts, FORMS_PERMISSIONS.create),
      },
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }

  /** root 視角:共用表單分派到哪些租戶(`org_form` 以各租戶為邊界各讀一次)。 */
  private async assignmentsOf(
    operator: OperatorContext,
    form: FormRecord,
  ): Promise<FormAssignment[]> {
    const tenants = await this.orgs.findMany(orgReader(operator), {
      "ancestors.0": { $exists: true },
      "ancestors.1": { $exists: false },
    });
    const assignments: FormAssignment[] = [];
    for (const tenant of tenants) {
      const link = await this.relations.findOne(tenant._id, {
        type: "org_form",
        secondId: form._id,
      });
      if (link) {
        assignments.push({
          tenantOrgId: String(tenant._id),
          tenantName: tenant.name,
          enabled: link.meta?.enabled === true,
        });
      }
    }
    return assignments;
  }
}
