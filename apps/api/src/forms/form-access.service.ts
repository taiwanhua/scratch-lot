import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import { BusinessRelationshipsRepository } from "../database/business-relationships.repository";
import {
  type FormDocument,
  FormsRepository,
  ModulesRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type { Module as ModuleEntity } from "../database/schemas/module.schema";
import { tenantIdOfOrg } from "../database/tenant-id";
import {
  tenantTimezoneOf,
  tenantTimezoneOfOrg,
} from "../database/tenant-timezone";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import {
  type FormCreateModule,
  canCreateInFormModule,
  formCreateKeyOf,
} from "./form-create-access";
import {
  type FormModuleAction,
  formModulePermission,
} from "./form-permission-keys";
import { forbiddenError, notFoundError, validationError } from "./forms-error";

export type FormRecord = Persisted<FormDocument>;

/**
 * 一位操作者在這次請求裡、表單引擎要用的事實(一次算好,各 service 共用):
 * - `permissionKeys`:有效權限集合(`PermissionResolver`,wildcard 已展開成具體 key)
 * - `foreignPermissionKeys`:被濾掉的別租戶表單動態權限(`has` 用它讓 `*` 也蓋不到)
 * - `isSuperAdmin`:持超級管理員(欄位級權限列被刪時「只有 root 看得到」的 root)
 * - `isRoot`:當前組織是根組織(`parentId === null`;管共用表單、分派的判準)
 * - `tenantId`:當前組織的租戶頂層(根組織 = null → 看全部共用表單)
 * - `timezone`:租戶時區(`ctx.timezone`)
 * - `perFormCreateModuleKeys`:宣告 `perFormCreate: true`(依表單分開新增權限)的表單模組 key
 */
export interface FormOperatorFacts {
  operator: OperatorContext;
  permissionKeys: ReadonlySet<string>;
  foreignPermissionKeys: ReadonlySet<string>;
  isSuperAdmin: boolean;
  isRoot: boolean;
  tenantId: Types.ObjectId | null;
  timezone: string;
  perFormCreateModuleKeys: ReadonlySet<string>;
}

/** 讀組織只取判斷用欄位,不受管理範圍影響(同 `OwnerProtectionService` 的 fail-closed 讀法)。 */
function orgReader(operator: OperatorContext): OperatorContext {
  return {
    ...operator,
    visibleOrgIds: "all",
    managedOrgIds: "all",
  };
}

/**
 * 表單的「誰看得到、誰改得動、誰能新增」。設計端與執行端共用同一份判準:
 *
 * | 操作者       | 設計端看得到                         | 設計端改得動          | 新增(`moduleForms`)                    |
 * | ------------ | ------------------------------------ | --------------------- | -------------------------------------- |
 * | 站在根組織   | 共用表單(客製表單只有該租戶看得到)  | 共用表單(owner null) | 全部共用表單(有發布版本)              |
 * | 站在租戶內   | 分派來的(有 `org_form`)+ 自己的客製 | 自己的客製表單        | `org_form.enabled` 的表單(有發布版本) |
 *
 * `org_form` 以租戶為邊界讀(`BusinessRelationshipsRepository`),所以部門使用者也查得到本租戶的列。
 */
@Injectable()
export class FormAccessService {
  private readonly factsCache = new WeakMap<
    OperatorContext,
    Promise<FormOperatorFacts>
  >();

  constructor(
    private readonly permissions: PermissionResolver,
    private readonly orgs: OrgsRepository,
    private readonly forms: FormsRepository,
    private readonly modules: ModulesRepository,
    private readonly relations: BusinessRelationshipsRepository,
  ) {}

  /** 同一個操作者上下文(同一個請求)只算一次。 */
  factsOf(operator: OperatorContext): Promise<FormOperatorFacts> {
    const cached = this.factsCache.get(operator);
    if (cached) {
      return cached;
    }
    const computed = this.computeFacts(operator);
    this.factsCache.set(operator, computed);
    return computed;
  }

  private async computeFacts(
    operator: OperatorContext,
  ): Promise<FormOperatorFacts> {
    const resolution = operator.actorId
      ? await this.permissions.resolve(operator.actorId, operator.currentOrgId)
      : {
          isSuperAdmin: false,
          modules: [],
          permissionKeys: new Set<string>(),
          foreignPermissionKeys: new Set<string>(),
        };
    const current = operator.currentOrgId
      ? await this.orgs.findById(orgReader(operator), operator.currentOrgId)
      : null;
    const tenantId = current
      ? tenantIdOfOrg({ _id: current._id, ancestors: current.ancestors })
      : null;
    return {
      operator,
      permissionKeys: resolution.permissionKeys,
      foreignPermissionKeys: resolution.foreignPermissionKeys,
      isSuperAdmin: resolution.isSuperAdmin,
      isRoot: current?.parentId === null,
      tenantId,
      timezone: await tenantTimezoneOf(this.orgs, operator, tenantId),
      // 權限解析已帶出模組事實;看不到的模組本來就沒有它的任何權限,不必知道開關
      perFormCreateModuleKeys: new Set(
        resolution.modules
          .filter((module) => module.perFormCreate)
          .map((module) => module.key),
      ),
    };
  }

  /** 某個組織所屬租戶的時區(`me.currentOrg.timezone`);組織讀不到 → 預設。 */
  timezoneOfOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<string> {
    return tenantTimezoneOfOrg(this.orgs, operator, orgId);
  }

  /**
   * 某個組織所屬的租戶頂層 id(`me.currentOrg.tenantId`;表達式的 `ctx.tenant.id`,送出時快照的
   * `revisions[].ctx.tenantId` 同一條規則):根組織 / 讀不到 → null。
   */
  async tenantIdOfOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const org = await this.orgs.findById(orgReader(operator), orgId);
    return org
      ? tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors })
      : null;
  }

  /**
   * 某組織與它全部下層的 id(列表的組織篩選)。只讀組織樹、不判斷範圍:回來的 id 只拿來**收窄**
   * 業務查詢,可見範圍由業務資料表的插件照套。組織不存在 = 只有它自己(查不到資料 = 空清單)。
   */
  async orgSubtreeIds(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const descendants = await this.orgs.findMany(
      orgReader(operator),
      { ancestors: orgId },
      { select: "_id" },
    );
    return [orgId, ...descendants.map((org) => org._id)];
  }

  /** 持有某權限(含同層 wildcard;權限不存在或被停用 → 不持有;別租戶表單的動態權限 → 不持有)。 */
  has(facts: FormOperatorFacts, key: string): boolean {
    return holdsPermission(facts, key);
  }

  /** 表單模組的個別權限;沒有 → `FORBIDDEN`(與 `@RequirePermission` 同一種錯誤,無 reason)。 */
  assertModulePermission(
    facts: FormOperatorFacts,
    moduleKey: string,
    action: FormModuleAction,
  ): void {
    const key = formModulePermission(moduleKey, action);
    if (!this.has(facts, key)) {
      throw forbiddenError(`Missing permission ${key}`);
    }
  }

  /**
   * **新增資格的唯一判斷**(依表單分開新增權限):操作者能不能用這張表單在這個模組新增。
   * 模組開啟依表單分開新增權限(`perFormCreate`)→ 看 `<模組>.create-<formKey>`(模組 `create` 不算);否則看模組 `create`。
   * 入口(新增 API、`moduleForms` 的 `canCreate`、abilities、複製為新單、`formLookup` 版本存取、申請中心新申請、
   * 申請人改 / 送 / 刪自己的單)一律呼叫這裡,不自己拼 key。
   */
  canCreateWithForm(
    facts: FormOperatorFacts,
    moduleKey: string,
    formKey: string,
  ): boolean {
    return this.has(facts, this.createKeyOf(facts, moduleKey, formKey));
  }

  /** `canCreateWithForm` 的守門版;沒有 → `FORBIDDEN`(與 `@RequirePermission` 同一種錯誤,無 reason)。 */
  assertCanCreateWithForm(
    facts: FormOperatorFacts,
    moduleKey: string,
    formKey: string,
  ): void {
    const key = this.createKeyOf(facts, moduleKey, formKey);
    if (!this.has(facts, key)) {
      throw forbiddenError(`Missing permission ${key}`);
    }
  }

  private createKeyOf(
    facts: FormOperatorFacts,
    moduleKey: string,
    formKey: string,
  ): string {
    return formCreateKeyOf(this.createModuleOf(facts, moduleKey), formKey);
  }

  private createModuleOf(
    facts: FormOperatorFacts,
    moduleKey: string,
  ): FormCreateModule {
    return {
      key: moduleKey,
      perFormCreate: facts.perFormCreateModuleKeys.has(moduleKey),
    };
  }

  /**
   * 在這個模組有沒有任何新增資格(不指定表單時用,例:執行端讀模組層資料)。
   * 開啟依表單分開新增權限的模組:持有任一張表單的 `create-<formKey>`(或模組 `*`);否則看模組 `create`。
   */
  canCreateInModule(facts: FormOperatorFacts, moduleKey: string): boolean {
    return canCreateInFormModule(facts, this.createModuleOf(facts, moduleKey));
  }

  /** `modules.engine = "form"` 的模組;不存在或不是表單模組 → `VALIDATION_FAILED`(`moduleKey`)。 */
  async requireFormModule(
    operator: OperatorContext,
    moduleKey: string,
  ): Promise<Persisted<ModuleEntity & { _id: Types.ObjectId }>> {
    const module = await this.modules.findOne(operator, { key: moduleKey });
    if (module?.engine !== "form") {
      throw validationError(`Module ${moduleKey} is not a form module`, [
        "moduleKey",
      ]);
    }
    return module;
  }

  async findForm(
    operator: OperatorContext,
    formKey: string,
  ): Promise<FormRecord | null> {
    return this.forms.findOne(operator, { key: formKey });
  }

  // ---- 設計端 ----

  /** 設計端看得到的表單 id 條件(清單查詢用);root 回 null = 不限。 */
  async designVisibilityFilter(
    facts: FormOperatorFacts,
  ): Promise<Record<string, unknown> | null> {
    if (facts.isRoot) {
      // 客製表單只有擁有它的租戶看得到,root 也不例外
      return { ownerOrgId: null };
    }
    if (facts.tenantId === null) {
      return { _id: { $in: [] } };
    }
    const links = await this.relations.findMany(facts.tenantId, {
      type: "org_form",
    });
    return {
      $or: [
        { ownerOrgId: facts.tenantId },
        { _id: { $in: links.map((link) => link.secondId) } },
      ],
    };
  }

  /** 設計端讀得到這張表單嗎(見 class 註解的表)。 */
  async canReadDesign(
    facts: FormOperatorFacts,
    form: FormRecord,
  ): Promise<boolean> {
    if (facts.isRoot) {
      return form.ownerOrgId === null;
    }
    if (facts.tenantId === null) {
      return false;
    }
    if (form.ownerOrgId?.equals(facts.tenantId)) {
      return true;
    }
    const link = await this.relations.findOne(facts.tenantId, {
      type: "org_form",
      secondId: form._id,
    });
    return link !== null;
  }

  /**
   * 執行端(填寫、渲染、lookup、欄位目錄)能不能碰這張表單的**定義**:共用表單,或自己租戶的客製表單。
   * 別租戶的客製表單一律當不存在 —— 它的 key 猜得到(`<來源 key>_<租戶短碼>`),
   * 只看模組權限會讓 A 讀到 B 的欄位定義。根組織(租戶 = null)只碰得到共用表單。
   */
  isRuntimeVisible(facts: FormOperatorFacts, form: FormRecord): boolean {
    return (
      form.ownerOrgId === null ||
      (facts.tenantId !== null && form.ownerOrgId.equals(facts.tenantId))
    );
  }

  /** 找執行端看得到的表單;別租戶的客製表單回 null。 */
  async findRuntimeForm(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormRecord | null> {
    const form = await this.findForm(facts.operator, formKey);
    return form && this.isRuntimeVisible(facts, form) ? form : null;
  }

  /** 改得動這張表單嗎:root 只改共用表單;租戶只改自己的客製表單。 */
  canWriteDesign(facts: FormOperatorFacts, form: FormRecord): boolean {
    if (facts.isRoot) {
      return form.ownerOrgId === null;
    }
    return (
      facts.tenantId !== null &&
      form.ownerOrgId?.equals(facts.tenantId) === true
    );
  }

  /** 設計端讀:讀不到一律 `NOT_FOUND`(不透露別的租戶有這張表單)。 */
  async requireReadableForm(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormRecord> {
    const form = await this.findForm(facts.operator, formKey);
    if (!form || !(await this.canReadDesign(facts, form))) {
      throw notFoundError(`Form not found: ${formKey}`);
    }
    return form;
  }

  /** 設計端寫:讀得到但不是自己的 → `FORBIDDEN`(`NOT_FORM_OWNER`)。 */
  async requireWritableForm(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormRecord> {
    const form = await this.requireReadableForm(facts, formKey);
    if (!this.canWriteDesign(facts, form)) {
      throw forbiddenError(
        `Form ${formKey} is not owned by the operator`,
        "NOT_FORM_OWNER",
      );
    }
    return form;
  }

  // ---- 執行端 ----

  /**
   * 操作者在某模組**可以新增**的表單:有發布版本(`currentVersion` 非 null)且
   * - 根組織使用者:全部共用表單
   * - 租戶內:本租戶 `org_form` 且 `meta.enabled = true` 的表單
   */
  async availableForms(
    facts: FormOperatorFacts,
    moduleKey: string,
  ): Promise<FormRecord[]> {
    const base = { moduleKey, currentVersion: { $ne: null } };
    if (facts.tenantId === null) {
      return this.forms.findMany(
        facts.operator,
        { ...base, ownerOrgId: null },
        { sort: { name: 1, key: 1 } },
      );
    }
    const links = await this.relations.findMany(facts.tenantId, {
      type: "org_form",
      meta: { enabled: true },
    });
    if (links.length === 0) {
      return [];
    }
    return this.forms.findMany(
      facts.operator,
      { ...base, _id: { $in: links.map((link) => link.secondId) } },
      { sort: { name: 1, key: 1 } },
    );
  }

  /** 這張表單現在可以新增嗎;不行 → `FORBIDDEN`(`FORM_NOT_AVAILABLE`)。 */
  async requireAvailableForm(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormRecord> {
    const form = await this.findRuntimeForm(facts, formKey);
    if (!form) {
      throw notFoundError(`Form not found: ${formKey}`);
    }
    const available = await this.availableForms(facts, form.moduleKey);
    if (!available.some((candidate) => candidate._id.equals(form._id))) {
      throw forbiddenError(
        `Form ${formKey} is not available for new submissions`,
        "FORM_NOT_AVAILABLE",
      );
    }
    return form;
  }

  /**
   * 這個租戶的這張表單綁了流程嗎(`org_form_workflow`,以租戶為邊界讀)。根組織(租戶 = null)沒有流程綁定。
   * 用途:修訂次數上限只對綁流程的表單、舊版資料升級只限沒綁流程的表單。
   */
  async hasWorkflowBinding(
    tenantId: Types.ObjectId | null,
    formId: Types.ObjectId,
  ): Promise<boolean> {
    if (tenantId === null) {
      return false;
    }
    const link = await this.relations.findOne(tenantId, {
      type: "org_form_workflow",
      firstId: tenantId,
      secondId: formId,
    });
    return link !== null;
  }

  /**
   * 執行端讀表單定義:持有該模組的 `view` / `edit`,或有新增資格即可(看得到提交的人要能渲染它)。
   * 新增資格:給了 `formKey` → `canCreateWithForm`;沒給(模組層)→ 這個模組任一張表單的新增資格。
   */
  assertRuntimeAccess(
    facts: FormOperatorFacts,
    moduleKey: string,
    formKey?: string,
  ): void {
    const actions: FormModuleAction[] = ["view", "edit"];
    const canCreate =
      formKey === undefined
        ? this.canCreateInModule(facts, moduleKey)
        : this.canCreateWithForm(facts, moduleKey, formKey);
    if (
      !canCreate &&
      !actions.some((action) =>
        this.has(facts, formModulePermission(moduleKey, action)),
      )
    ) {
      throw forbiddenError(`Missing permission ${moduleKey}.view`);
    }
  }
}

/** 字串 id → ObjectId;不合法 → `VALIDATION_FAILED`。 */
export function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值。 */
export function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
