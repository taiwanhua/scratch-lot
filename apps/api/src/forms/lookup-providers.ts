import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Types } from "mongoose";

import {
  FORM_SUBMISSION_PROVIDER,
  type FieldDef,
  type FieldType,
  type LookupProviderRegistry,
  type LookupSourceDescriptor,
  formatTemporal,
  hasLookupFilterVars,
  optionLabelOf,
  renderLookupLabel,
  semanticValueOf,
  temporalIsoOf,
} from "@repo/domain/form";

import {
  BaseRepository,
  type Persisted,
  type RepositoryDocument,
} from "../database/base.repository";
import {
  type FormSubmissionDocument,
  FormSubmissionsRepository,
  FormVersionsRepository,
  OrgsRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { sharedToOrgCondition } from "../database/plugins/tenant-scope.plugin";
import { PROJECT_LOOKUP_SOURCES } from "../database/project-lookup-sources";
import { RelationService } from "../database/relation.service";
import { tenantIdOfOrg } from "../database/tenant-id";
import { fieldGateOf, requiredShowKeys } from "./field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
  escapeRegex,
} from "./form-access.service";
import { formModulePermission } from "./form-permission-keys";
import {
  type LookupProviderDeclaration,
  type LookupProviderRegistration,
  type ResolvedLookupSource,
  resolveLookupRegistrations,
} from "./lookup-provider-registration";

/**
 * lookup 來源登錄表:帶入(prefill)、引用(reference)、
 * lookup 選項(`options.kind = "lookup"`)都用這一張。
 *
 * - **底座來源**(`user`、`org`、`form_submission`):宣告在 `LOOKUP_PROVIDERS`,實作在 `providerFor`。
 * - **專案來源**:專案在固定入口 `project/lookup-providers.ts` 列 `{ declaration, repositoryToken }`
 *   (契約見 `lookup-provider-registration.ts`),由 `DatabaseModule` 以 `PROJECT_LOOKUP_SOURCES` 提供;
 *   本服務啟動時驗證(撞名 → 起不來),查詢一律由這裡經 `BaseRepository` 組(`projectProvider`)。
 * - 新增來源後 `docs/modules/forms.md`「lookup 登錄表」補一列。
 *
 * 執行時的查詢一律**以版本定義為準**:前端只帶「哪一版的哪一欄 / 哪一條帶入規則」+ 關鍵字,
 * provider 與 `filter` 都從定義取,前端改不了(`form-runtime/form-lookup.service.ts`)。
 */

export type {
  LookupFieldSpec,
  LookupProviderDeclaration,
} from "./lookup-provider-registration";

/** 讀使用者的帳號 / Email 要能看使用者管理(與使用者清單同一條)。 */
const USER_MANAGER_VIEW = "system.user-manager.view";

const USER_PROVIDER: LookupProviderDeclaration = {
  name: "使用者",
  fields: {
    name: { type: "text" },
    account: { type: "text", permission: USER_MANAGER_VIEW },
    email: { type: "text", permission: USER_MANAGER_VIEW },
  },
  filterFields: ["enabled"],
  labelField: "name",
};

const ORG_PROVIDER: LookupProviderDeclaration = {
  name: "組織",
  fields: {
    name: { type: "text" },
    slug: { type: "text" },
  },
  filterFields: ["enabled"],
  labelField: "name",
};

const FORM_SUBMISSION_DECLARATION: LookupProviderDeclaration = {
  name: "其他表單提交",
  fields: {},
  filterFields: [],
  labelField: "title",
};

export const LOOKUP_PROVIDERS: Readonly<
  Record<string, LookupProviderDeclaration>
> = {
  user: USER_PROVIDER,
  org: ORG_PROVIDER,
  [FORM_SUBMISSION_PROVIDER]: FORM_SUBMISSION_DECLARATION,
};

/** 摘要槽也能當 `form_submission` 來源的欄位(設計時的欄位目錄 = 非受保護欄位 + 摘要槽)。 */
export const SUMMARY_SLOT_FIELDS: Readonly<Record<string, FieldType>> = {
  title: "text",
  date: "date",
  amount: "number",
};

/**
 * 一筆來源資料:`values` 只含操作者**讀得到**的欄位(讀不到的省略,不是 null);
 * `form_submission` 來源在「那筆的版本沒有這個欄位」時放 null。`labels` 是選項 / 引用欄的顯示名。
 */
export interface LookupRecord {
  id: string;
  values: Record<string, unknown>;
  labels: Record<string, string | null>;
}

export interface LookupSearch {
  keyword?: string | null;
  page: number;
  pageSize: number;
}

export interface LookupPage {
  items: LookupRecord[];
  totalCount: number;
}

/** 一個 provider 的執行面;`fields` = 定義要的欄位(`form_submission` 依每筆版本判斷它們)。 */
interface LookupProviderRuntime {
  search(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
    query: LookupSearch,
    fields: readonly string[],
  ): Promise<LookupPage>;
  /** 依某欄的值取回(`id` 或 `valueField`);讀不到的不回。 */
  findByValues(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
    field: string,
    values: readonly string[],
    fields: readonly string[],
    options: LookupReadOptions,
  ): Promise<LookupRecord[]>;
}

/**
 * `publicOnly`:只回**不受權限保護**的欄位(不看操作者有沒有權限)。寫進提交的快照(引用、lookup 選項的
 * label)用它 —— 快照存在非受保護欄位裡,來源欄位之後改成受保護時,持有 show 的人送出不能把值帶進來。
 */
export interface LookupReadOptions {
  publicOnly?: boolean;
}

/** 顯示名:`labels` 有就用,否則把值轉成字串;讀不到(被省略)→ null。 */
export function lookupLabelOf(
  record: LookupRecord,
  labelField: string,
): string | null {
  if (labelField === "id") {
    return record.id;
  }
  const label = record.labels[labelField];
  if (label !== undefined) {
    return label;
  }
  const value = record.values[labelField];
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item)).join("、");
  }
  return textOf(value);
}

/** 這一欄有沒有回來(`id` 一律有;受保護或無權時 provider 省略那一欄 → false;那版沒有的欄位是 null,算有回)。 */
export function hasLookupField(record: LookupRecord, field: string): boolean {
  return field === "id" || field in record.labels || field in record.values;
}

/**
 * 一筆的顯示名(`labelTemplate`):來源描述有顯示模板就套(每個佔位符取該欄的顯示名 / 值);
 * 模板引用的欄位**有任何一個讀不到**(依這次讀取的權限被省略)、沒模板或套出空的 → 整串用 `labelField`。
 * 三處一致:`formLookup`(操作者權限)、引用 / lookup 選項的快照(`publicOnly`)、現名解析(讀者權限)。
 * 讀取時要的欄位用 `@repo/domain/form` 的 `lookupLabelFieldsOf(source)`。
 */
export function lookupDisplayLabelOf(
  record: LookupRecord,
  source: LookupSourceDescriptor,
): string | null {
  return renderLookupLabel(source, (field) =>
    hasLookupField(record, field) ? lookupLabelOf(record, field) : undefined,
  );
}

/** 純量轉文字;物件(不該出現在顯示欄)回空字串。 */
function textOf(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

/** 某欄的值(`id` 或 `values` 裡的);讀不到回 undefined。 */
export function lookupValueOf(record: LookupRecord, field: string): unknown {
  return field === "id" ? record.id : record.values[field];
}

/**
 * 定義裡的 `filter` 只收 provider 允許的欄位(其餘忽略 —— 不認得的條件不套,也不放寬)。
 * 連動篩選換成的值若是 id 字串(引用欄的值),文件那一欄可能存 ObjectId 或字串:兩種都比。
 */
function allowedFilterOf(
  declaration: LookupProviderDeclaration,
  filter: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (declaration.filterFields.includes(key)) {
      allowed[key] =
        typeof value === "string" && Types.ObjectId.isValid(value)
          ? { $in: [value, new Types.ObjectId(value)] }
          : value;
    }
  }
  return allowed;
}

/** 篩選欄位的型別(連動篩選驗型別相符用):`enabled` 是是否;其餘照可回欄位的型別,不在可回欄位內為 null。 */
function filterFieldTypesOf(
  declaration: LookupProviderDeclaration,
): Record<string, FieldType | null> {
  return Object.fromEntries(
    declaration.filterFields.map((name) => [
      name,
      declaration.fields[name]?.type ?? (name === "enabled" ? "boolean" : null),
    ]),
  );
}

function objectIdsOf(values: readonly string[]): Types.ObjectId[] {
  return values
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));
}

/** 組織以**可見範圍**讀(lookup 是業務用途;`orgs` 本身掛的是管理範圍)。 */
function visibleOrgReader(operator: OperatorContext): OperatorContext {
  return { ...operator, managedOrgIds: operator.visibleOrgIds };
}

function orgRecord(org: {
  _id: Types.ObjectId;
  name: string;
  slug?: string | null;
}): LookupRecord {
  return {
    id: String(org._id),
    values: { name: org.name, slug: org.slug ?? null },
    labels: {},
  };
}

function labelTextOf(label: unknown): string | null {
  if (Array.isArray(label)) {
    return label.map(String).join("、");
  }
  return typeof label === "string" ? label : null;
}

/**
 * 表單欄位的顯示名:選項 / 引用 → label;日期 / 日期時間 → 以讀者的租戶時區格式化
 * (`YYYY-MM-DD` / `YYYY-MM-DD HH:mm`,值本身是 ISO 語意值);其他型別沒有(undefined)。
 */
function fieldLabelOf(
  field: FieldDef,
  stored: unknown,
  timezone: string,
): string | null | undefined {
  if (LABELLED_TYPES.has(field.type)) {
    return labelTextOf(optionLabelOf(field, stored));
  }
  if (field.type === "date" || field.type === "datetime") {
    return temporalIsoOf(stored) === null
      ? null
      : formatTemporal(stored, { type: field.type, timezone });
  }
  return undefined;
}

/** 摘要槽:`date` 存 `Date` → 值回 ISO(同日期欄的語意值)、顯示名印日期;其他槽照存、沒有顯示名。 */
function summarySlotOf(
  summary: Record<string, unknown>,
  name: string,
  timezone: string,
): { value: unknown; label?: string | null } {
  if (name !== "date") {
    return { value: summary[name] ?? null };
  }
  const value = temporalIsoOf(summary.date);
  return {
    value,
    label:
      value === null ? null : formatTemporal(value, { type: "date", timezone }),
  };
}

/** 設計器的來源清單一筆(`formLookupProviders`):宣告去掉權限與執行面。 */
export interface LookupProviderSummary {
  key: string;
  name: string;
  /** 底座來源(名稱與欄位名由前端 i18n 顯示);false = 專案登記的來源 */
  isBase: boolean;
  labelField: string;
  valueField: string;
  filterFields: readonly string[];
  fields: readonly { key: string; type: FieldType; label: string | null }[];
  /** 有沒有依操作者的預設值(引用欄的預設值能選「來源提供的預設」)。 */
  operatorDefault: boolean;
}

function summaryOf(
  key: string,
  declaration: LookupProviderDeclaration,
  isBase: boolean,
  operatorDefault = false,
): LookupProviderSummary {
  return {
    key,
    name: declaration.name,
    isBase,
    operatorDefault,
    labelField: declaration.labelField,
    valueField: declaration.valueField ?? "id",
    filterFields: declaration.filterFields,
    fields: Object.entries(declaration.fields).map(([name, spec]) => ({
      key: name,
      type: spec.type,
      label: spec.label ?? null,
    })),
  };
}

function fieldTypesOf(
  declaration: LookupProviderDeclaration,
): Record<string, FieldType> {
  return Object.fromEntries(
    Object.entries(declaration.fields).map(([name, spec]) => [name, spec.type]),
  );
}

/** 文件欄位原值 → lookup 值:ObjectId 轉字串、日期轉 ISO(同日期欄的語意值),陣列逐項轉。 */
function plainValueOf(value: unknown): unknown {
  if (value instanceof Types.ObjectId) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainValueOf(item));
  }
  return value ?? null;
}

type AnyRepository = BaseRepository<unknown, RepositoryDocument>;
type ProjectDocument = Persisted<RepositoryDocument>;

/** 固定呼叫 BaseRepository 本身的 `findMany`:子類覆寫不了查詢,範圍一定由 plugin 套。 */
function baseFindMany(
  repository: AnyRepository,
  ...args: Parameters<AnyRepository["findMany"]>
): Promise<ProjectDocument[]> {
  return BaseRepository.prototype.findMany.call(repository, ...args) as Promise<
    ProjectDocument[]
  >;
}

/** 同上,`count`。 */
function baseCount(
  repository: AnyRepository,
  ...args: Parameters<AnyRepository["count"]>
): Promise<number> {
  return BaseRepository.prototype.count.call(repository, ...args);
}

const EMPTY_PROVIDER: LookupProviderRuntime = {
  search: () => Promise.resolve({ items: [], totalCount: 0 }),
  findByValues: () => Promise.resolve([]),
};

type SubmissionRecord = Persisted<FormSubmissionDocument>;

/**
 * 一份欄位定義當 `form_submission` 來源時可挑的欄位:摘要槽 + 非受保護欄位(因引用而受保護的計算欄位也不列)。
 * 設計時的欄位目錄共用這一條:別的表單用它目前版本的欄位、自己(帶入來源可選自己)用草稿的欄位。
 */
export function submissionCatalogOfFields(
  fields: readonly FieldDef[],
): Record<string, FieldType> {
  const catalog: Record<string, FieldType> = { ...SUMMARY_SLOT_FIELDS };
  for (const field of fields) {
    // 明細欄(與它的子路徑)不能當引用 / 帶入 / 選項的來源欄位
    if (
      field.type !== "array" &&
      requiredShowKeys(fields, field.key).length === 0
    ) {
      catalog[field.key] = field.type;
    }
  }
  return catalog;
}

/** 回 label 的欄位型別(選項與引用)。 */
const LABELLED_TYPES: ReadonlySet<FieldType> = new Set([
  "select",
  "multiSelect",
  "reference",
]);

@Injectable()
export class LookupProvidersService implements OnModuleInit {
  /** 專案登記的來源(`project/lookup-providers.ts`);啟動時解析一次。 */
  private projectSources: ReadonlyMap<string, ResolvedLookupSource> = new Map();

  constructor(
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly submissions: FormSubmissionsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly moduleRef: ModuleRef,
    @Inject(PROJECT_LOOKUP_SOURCES)
    private readonly registrations: readonly LookupProviderRegistration[],
  ) {}

  /**
   * 解析專案來源:以 `ModuleRef` 取 repository 實例並驗證(撞名、格式、前綴、宣告、`BaseRepository`)。
   * 不合 → 丟 `LookupProviderRegistrationError`,app(與受管定義 CLI)起不來。
   */
  onModuleInit(): void {
    this.projectSources = resolveLookupRegistrations(
      this.registrations,
      Object.keys(LOOKUP_PROVIDERS),
      (token) => this.moduleRef.get<unknown>(token, { strict: false }),
    );
  }

  /** 是不是專案登記的來源(檢查器的專案來源規則用)。 */
  isProjectSource(key: string): boolean {
    return this.projectSources.has(key);
  }

  /** 設計器的來源清單:底座三種在前,專案來源依 key 排。 */
  summaries(): LookupProviderSummary[] {
    return [
      ...Object.entries(LOOKUP_PROVIDERS).map(([key, declaration]) =>
        summaryOf(key, declaration, true),
      ),
      ...[...this.projectSources.values()]
        .map(({ declaration }) =>
          summaryOf(
            declaration.key,
            declaration,
            false,
            declaration.defaultForOperator !== undefined,
          ),
        )
        .toSorted((a, b) => a.key.localeCompare(b.key, "zh-Hant")),
    ];
  }

  /**
   * 檢查器要的登錄表(`@repo/domain/form` 的 `LookupProviderRegistry`)。
   * `form_submission` 的欄位 = 定義裡用到的每張來源表單目前版本的非受保護欄位 + 摘要槽(聯集);
   * 精確到「哪張表單有哪些欄位」由 `formSubmissionCatalog` 另外檢查。
   */
  async registryFor(
    facts: FormOperatorFacts,
    formKeys: readonly string[],
  ): Promise<LookupProviderRegistry> {
    const registry: Record<
      string,
      {
        fields: Record<string, FieldType>;
        filterFields?: Record<string, FieldType | null>;
        operatorDefault?: boolean;
      }
    > = {};
    for (const [key, declaration] of Object.entries(LOOKUP_PROVIDERS)) {
      registry[key] = {
        fields: fieldTypesOf(declaration),
        filterFields: filterFieldTypesOf(declaration),
      };
    }
    for (const [key, { declaration }] of this.projectSources) {
      registry[key] = {
        fields: fieldTypesOf(declaration),
        filterFields: filterFieldTypesOf(declaration),
        operatorDefault: declaration.defaultForOperator !== undefined,
      };
    }
    const union: Record<string, FieldType> = { ...SUMMARY_SLOT_FIELDS };
    for (const formKey of new Set(formKeys)) {
      Object.assign(union, await this.formSubmissionCatalog(facts, formKey));
    }
    registry[FORM_SUBMISSION_PROVIDER] = { fields: union, filterFields: {} };
    return registry;
  }

  /** `form_submission` 來源在設計時可挑的欄位:該表單目前版本的非受保護欄位 + 摘要槽。 */
  async formSubmissionCatalog(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<Record<string, FieldType>> {
    const operator = facts.operator;
    const catalog: Record<string, FieldType> = { ...SUMMARY_SLOT_FIELDS };
    // 別租戶的客製表單當不存在:不透露它的欄位 key 與型別
    const form = await this.access.findRuntimeForm(facts, formKey);
    if (form?.currentVersion === null || form === null) {
      return catalog;
    }
    const version = await this.versions.findOne(operator, {
      formKey,
      version: form.currentVersion,
    });
    return submissionCatalogOfFields(version?.fields ?? []);
  }

  search(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
    query: LookupSearch,
    fields: readonly string[],
  ): Promise<LookupPage> {
    // 連動篩選沒換成值(呼叫端漏了 `resolveLookupSource`)→ 查無,不把 `{ var }` 當條件、也不放寬
    if (hasLookupFilterVars(source)) {
      return Promise.resolve({ items: [], totalCount: 0 });
    }
    return this.providerFor(source.provider).search(
      facts,
      source,
      query,
      fields,
    );
  }

  findByValues(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
    field: string,
    values: readonly string[],
    fields: readonly string[] = [],
    options: LookupReadOptions = {},
  ): Promise<LookupRecord[]> {
    if (values.length === 0 || hasLookupFilterVars(source)) {
      return Promise.resolve([]);
    }
    return this.providerFor(source.provider).findByValues(
      facts,
      source,
      field,
      values,
      fields,
      options,
    );
  }

  /**
   * 依操作者的預設值(引用欄的「來源提供的預設」):回那一筆的 id;來源沒宣告、讀不到來源、沒有操作者、
   * 連動條件還沒換成值、或查無 → null。`source` 是引用欄的來源描述,篩選與預設值條件都已換成目前的值
   * (`providerDefaultSourceOf`)。查詢照來源宣告(`defaultForOperator`)組、一律經 BaseRepository;
   * 呼叫端要的顯示名與篩選檢查再以 `findByValues` 取回(同一條讀取規則)。
   */
  async operatorDefaultId(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
  ): Promise<string | null> {
    const resolved = this.projectSources.get(source.provider);
    const declared = resolved?.declaration.defaultForOperator;
    const actorId = facts.operator.actorId;
    if (
      resolved === undefined ||
      declared === undefined ||
      actorId === null ||
      hasLookupFilterVars(source)
    ) {
      return null;
    }
    const { declaration, repository } = resolved;
    if (
      declaration.permission !== null &&
      !this.access.has(facts, declaration.permission)
    ) {
      return null;
    }
    const fixed = await this.projectFilterOf(facts, resolved, source.filter);
    const [found] = await baseFindMany(
      repository,
      facts.operator,
      {
        $and: [fixed, { ...declared.where, [declared.operatorField]: actorId }],
      },
      {
        sort:
          declared.latestBy === undefined
            ? { _id: -1 }
            : { [declared.latestBy]: -1, _id: -1 },
        limit: 1,
      },
    );
    return found === undefined
      ? null
      : String((found as unknown as { _id: Types.ObjectId })._id);
  }

  private providerFor(key: string): LookupProviderRuntime {
    switch (key) {
      case "user": {
        return this.userProvider;
      }
      case "org": {
        return this.orgProvider;
      }
      case FORM_SUBMISSION_PROVIDER: {
        return this.formSubmissionProvider;
      }
      default: {
        const source = this.projectSources.get(key);
        // 定義檢查器擋掉未登錄的來源;走到這裡是舊資料(或專案拿掉了登記),一律查無(fail-closed)
        return source === undefined
          ? EMPTY_PROVIDER
          : this.projectProvider(source);
      }
    }
  }

  // ---- 專案來源:一律經 BaseRepository(租戶隔離、可見範圍、資料範圍由 plugin 套)----

  private projectProvider(
    resolved: ResolvedLookupSource,
  ): LookupProviderRuntime {
    const { declaration, repository } = resolved;
    const canReadSource = (facts: FormOperatorFacts): boolean =>
      declaration.permission === null ||
      this.access.has(facts, declaration.permission);
    const canReadField = (
      facts: FormOperatorFacts,
      field: string,
      publicOnly: boolean,
    ): boolean => {
      const permission = declaration.fields[field]?.permission;
      return (
        permission === undefined ||
        (!publicOnly && this.access.has(facts, permission))
      );
    };
    const toRecord = (
      facts: FormOperatorFacts,
      document: object,
      publicOnly: boolean,
    ): LookupRecord => {
      const raw = document as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      for (const field of Object.keys(declaration.fields)) {
        if (canReadField(facts, field, publicOnly)) {
          values[field] = plainValueOf(raw[field]);
        }
      }
      return { id: String(raw._id), values, labels: {} };
    };

    return {
      search: async (facts, source, query) => {
        if (!canReadSource(facts)) {
          return { items: [], totalCount: 0 };
        }
        const fixed = await this.projectFilterOf(
          facts,
          resolved,
          source.filter,
        );
        const keyword = query.keyword?.trim();
        // 關鍵字只比對讀得到的欄位(不能拿受保護欄位試出值)
        const keywordFields = (
          declaration.keywordFields ??
          (declaration.labelField === "id" ? [] : [declaration.labelField])
        ).filter((field) => canReadField(facts, field, false));
        // 有關鍵字但沒有可比對的欄位(全受保護或顯示欄是 id)→ 查無,不退回列全部
        if (keyword && keywordFields.length === 0) {
          return { items: [], totalCount: 0 };
        }
        const condition = keyword
          ? {
              $and: [
                fixed,
                {
                  $or: keywordFields.map((field) => ({
                    [field]: { $regex: escapeRegex(keyword), $options: "i" },
                  })),
                },
              ],
            }
          : fixed;
        const sort: Record<string, 1 | -1> =
          declaration.labelField === "id"
            ? { _id: 1 }
            : { [declaration.labelField]: 1, _id: 1 };
        const [totalCount, found] = await Promise.all([
          baseCount(repository, facts.operator, condition),
          baseFindMany(repository, facts.operator, condition, {
            sort,
            skip: (query.page - 1) * query.pageSize,
            limit: query.pageSize,
          }),
        ]);
        return {
          items: found.map((document) => toRecord(facts, document, false)),
          totalCount,
        };
      },
      findByValues: async (facts, source, field, values, _fields, options) => {
        // 以受權限保護的欄位反查也要讀得到那一欄,否則可以拿它逐一試出值(同 user 的帳號 / Email)
        if (
          !canReadSource(facts) ||
          (field !== "id" && !Object.hasOwn(declaration.fields, field)) ||
          (field !== "id" && !canReadField(facts, field, false))
        ) {
          return [];
        }
        const fixed = await this.projectFilterOf(
          facts,
          resolved,
          source.filter,
        );
        const condition =
          field === "id"
            ? { ...fixed, _id: { $in: objectIdsOf(values) } }
            : { ...fixed, [field]: { $in: [...values] } };
        const found = await baseFindMany(repository, facts.operator, condition);
        return found.map((document) =>
          toRecord(facts, document, options.publicOnly === true),
        );
      },
    };
  }

  /**
   * 專案來源的固定條件:`filterFields` 的等值條件,加上共用篩選(`sharedToFilter`)換成的
   * 「給那個組織看得到」條件(`sharedToOrgCondition`)。組織以**可見範圍**讀(同 org 來源);
   * 值不合法或讀不到 → 條件命中不到任何資料(fail-closed)。
   */
  private async projectFilterOf(
    facts: FormOperatorFacts,
    resolved: ResolvedLookupSource,
    filter: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const { declaration, repository } = resolved;
    const sharedTo = declaration.sharedToFilter;
    const fixed = allowedFilterOf(declaration, filter);
    if (sharedTo === undefined || !Object.hasOwn(fixed, sharedTo)) {
      return fixed;
    }
    const rest = Object.fromEntries(
      Object.entries(fixed).filter(([key]) => key !== sharedTo),
    );
    const raw = filter?.[sharedTo];
    const orgId = typeof raw === "string" ? raw : null;
    const scope = repository.tenantScope;
    const org =
      orgId === null || !Types.ObjectId.isValid(orgId) || scope === undefined
        ? null
        : await this.orgs.findById(visibleOrgReader(facts.operator), orgId);
    if (org === null || scope === undefined) {
      return { ...rest, _id: { $in: [] } };
    }
    return {
      $and: [
        rest,
        sharedToOrgCondition(scope, {
          orgId: org._id,
          ancestorOrgIds: org.ancestors.slice(1),
          tenantId: tenantIdOfOrg(org),
        }),
      ],
    };
  }

  // ---- user:操作者可見範圍內組織的成員(org_user)----

  private readonly userProvider: LookupProviderRuntime = {
    search: async (facts, source, query) => {
      const filter = await this.userFilter(facts, source);
      if (filter === null) {
        return { items: [], totalCount: 0 };
      }
      const keyword = query.keyword?.trim();
      const condition = keyword
        ? {
            $and: [
              filter,
              {
                $or: [
                  { name: { $regex: escapeRegex(keyword), $options: "i" } },
                  { account: { $regex: escapeRegex(keyword), $options: "i" } },
                ],
              },
            ],
          }
        : filter;
      const [totalCount, found] = await Promise.all([
        this.users.count(facts.operator, condition),
        this.users.findMany(facts.operator, condition, {
          sort: { name: 1, _id: 1 },
          skip: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      return {
        items: found.map((user) => this.userRecord(facts, user)),
        totalCount,
      };
    },
    findByValues: async (facts, source, field, values, _fields, options) => {
      const filter = await this.userFilter(facts, source);
      // 以帳號 / Email 反查也要讀得到那一欄,否則可以拿它們逐一試出誰是誰
      const fieldPermission = USER_PROVIDER.fields[field]?.permission;
      if (
        filter === null ||
        !["id", "name", "account", "email"].includes(field) ||
        (fieldPermission !== undefined &&
          !this.access.has(facts, fieldPermission))
      ) {
        return [];
      }
      const byValue =
        field === "id"
          ? { _id: { $in: objectIdsOf(values) } }
          : { [field]: { $in: [...values] } };
      const found = await this.users.findMany(facts.operator, {
        $and: [filter, byValue],
      });
      return found.map((user) =>
        this.userRecord(facts, user, options.publicOnly === true),
      );
    },
  };

  /** 可見範圍內組織的成員;根組織(可見全部)不限。`filter` 只收 `enabled`。 */
  private async userFilter(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
  ): Promise<Record<string, unknown> | null> {
    const fixed = allowedFilterOf(USER_PROVIDER, source.filter);
    if (facts.operator.visibleOrgIds === "all") {
      return fixed;
    }
    const links = await this.relations.listLinks("org_user", {
      firstIds: facts.operator.visibleOrgIds,
    });
    if (links.length === 0) {
      return null;
    }
    return { ...fixed, _id: { $in: links.map((link) => link.secondId) } };
  }

  private userRecord(
    facts: FormOperatorFacts,
    user: { _id: Types.ObjectId; name: string; account: string; email: string },
    publicOnly = false,
  ): LookupRecord {
    const canRead = (field: string): boolean => {
      const permission = USER_PROVIDER.fields[field]?.permission;
      return (
        permission === undefined ||
        (!publicOnly && this.access.has(facts, permission))
      );
    };
    const values: Record<string, unknown> = { name: user.name };
    if (canRead("account")) {
      values.account = user.account;
    }
    if (canRead("email")) {
      values.email = user.email;
    }
    return { id: String(user._id), values, labels: {} };
  }

  // ---- org:操作者可見範圍內的組織 ----

  private readonly orgProvider: LookupProviderRuntime = {
    search: async (facts, source, query) => {
      const reader = visibleOrgReader(facts.operator);
      const fixed = allowedFilterOf(ORG_PROVIDER, source.filter);
      const keyword = query.keyword?.trim();
      const condition = keyword
        ? { ...fixed, name: { $regex: escapeRegex(keyword), $options: "i" } }
        : fixed;
      const [totalCount, found] = await Promise.all([
        this.orgs.count(reader, condition),
        this.orgs.findMany(reader, condition, {
          sort: { name: 1, _id: 1 },
          skip: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      return { items: found.map((org) => orgRecord(org)), totalCount };
    },
    findByValues: async (facts, source, field, values) => {
      if (!["id", "name", "slug"].includes(field)) {
        return [];
      }
      const fixed = allowedFilterOf(ORG_PROVIDER, source.filter);
      const condition =
        field === "id"
          ? { ...fixed, _id: { $in: objectIdsOf(values) } }
          : { ...fixed, [field]: { $in: [...values] } };
      const found = await this.orgs.findMany(
        visibleOrgReader(facts.operator),
        condition,
      );
      return found.map((org) => orgRecord(org));
    },
  };

  // ---- form_submission:依每筆**自己綁的版本**判斷欄位 ----

  private readonly formSubmissionProvider: LookupProviderRuntime = {
    search: async (facts, source, query, fields) => {
      const scope = await this.submissionScope(facts, source);
      if (scope === null) {
        return { items: [], totalCount: 0 };
      }
      const keyword = query.keyword?.trim();
      // 關鍵字只比對摘要標題(受保護欄位不可當摘要槽,所以不會拿它試出受保護的值)
      const filter = keyword
        ? {
            ...scope.filter,
            "summary.title": { $regex: escapeRegex(keyword), $options: "i" },
          }
        : scope.filter;
      const [totalCount, found] = await Promise.all([
        this.submissions.count(facts.operator, filter),
        this.submissions.findMany(facts.operator, filter, {
          sort: { submittedAt: -1, _id: -1 },
          skip: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      return {
        items: await this.submissionRecords(facts, scope, found, fields),
        totalCount,
      };
    },
    findByValues: async (facts, source, field, values, fields, options) => {
      const scope = await this.submissionScope(facts, source);
      // 表單提交只能以 id 取回(欄位值不是唯一鍵,也可能受保護)
      if (scope === null || field !== "id") {
        return [];
      }
      const found = await this.submissions.findMany(facts.operator, {
        ...scope.filter,
        _id: { $in: objectIdsOf(values) },
      });
      return this.submissionRecords(facts, scope, found, fields, options);
    },
  };

  /** 來源表單的提交:要有該表單所屬模組的 `view`;可見範圍 / 資料範圍由插件自動套。 */
  private async submissionScope(
    facts: FormOperatorFacts,
    source: LookupSourceDescriptor,
  ): Promise<{
    formKey: string;
    moduleKey: string;
    filter: Record<string, unknown>;
  } | null> {
    if (!source.formKey) {
      return null;
    }
    const form = await this.access.findRuntimeForm(facts, source.formKey);
    if (
      !form ||
      !this.access.has(facts, formModulePermission(form.moduleKey, "view"))
    ) {
      return null;
    }
    return {
      formKey: form.key,
      moduleKey: form.moduleKey,
      filter: {
        formKey: form.key,
        moduleKey: form.moduleKey,
        ...(source.completedOnly === false ? {} : { status: "completed" }),
      },
    };
  }

  /**
   * 每一筆依**它自己綁的版本**決定要的欄位能不能給:
   * 存在且非受保護 → 語意值(+ 選項 / 引用的 label);存在但受保護且沒有 show → **省略**;
   * 那一版沒有這個欄位 → null。摘要槽照回。
   */
  private async submissionRecords(
    facts: FormOperatorFacts,
    scope: { formKey: string; moduleKey: string },
    found: readonly SubmissionRecord[],
    requested: readonly string[],
    options: LookupReadOptions = {},
  ): Promise<LookupRecord[]> {
    const fieldsByVersion = await this.fieldsByVersion(
      facts.operator,
      scope.formKey,
      found.map((record) => record.version),
    );
    const gate = fieldGateOf(facts, scope.moduleKey, scope.formKey);
    return found.map((record) => {
      const fields = fieldsByVersion.get(record.version) ?? [];
      const byKey = new Map(fields.map((field) => [field.key, field]));
      const values: Record<string, unknown> = {};
      const labels: Record<string, string | null> = {};
      const summary = (record.summary ?? {}) as Record<string, unknown>;
      for (const name of new Set(requested)) {
        if (name === "id") {
          continue;
        }
        if (name in SUMMARY_SLOT_FIELDS) {
          const slot = summarySlotOf(summary, name, facts.timezone);
          values[name] = slot.value;
          if (slot.label !== undefined) {
            labels[name] = slot.label;
          }
          continue;
        }
        const field = byKey.get(name);
        if (!field || field.type === "array") {
          values[name] = null;
          continue;
        }
        const isProtected = requiredShowKeys(fields, name).length > 0;
        if (
          (isProtected && options.publicOnly === true) ||
          !gate.canShow(fields, name)
        ) {
          continue;
        }
        const stored = record.values[name];
        values[name] = semanticValueOf(field, stored);
        const label = fieldLabelOf(field, stored, facts.timezone);
        if (label !== undefined) {
          labels[name] = label;
        }
      }
      return { id: String(record._id), values, labels };
    });
  }

  private async fieldsByVersion(
    operator: OperatorContext,
    formKey: string,
    versions: readonly number[],
  ): Promise<Map<number, FieldDef[]>> {
    const unique = [...new Set(versions)];
    const result = new Map<number, FieldDef[]>();
    if (unique.length === 0) {
      return result;
    }
    const docs = await this.versions.findMany(operator, {
      formKey,
      version: { $in: unique },
    });
    for (const doc of docs) {
      if (doc.version !== null) {
        result.set(doc.version, doc.fields);
      }
    }
    return result;
  }
}
