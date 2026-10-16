/**
 * 可攜性規則的唯一正本:UI 匯出、CLI 與種子組裝都呼叫 `validatePortableDefinition(seed, catalog)`。
 * 這是既有定義檢查之上的**交付檢查**:確認一份共用定義不夾帶只在來源環境有意義的資料
 * (使用者 / 組織 / 角色 / 提交 / 上傳物件的固定 id 或值),不改寫 runtime schema、也不限制一般 UI 自建定義。
 * 不符就整份失敗並指出位置;不確定語意的位置報「不支援」,不默默略過。
 *
 * | 位置 | 允許 | 拒絕 |
 * | --- | --- | --- |
 * | lookup provider / filter | `user`、`org`:沒有 filter 或只有 boolean 的 `enabled`;`form_submission`:沒有 filter,`formKey` 指向可解析的共用定義 | 未知 provider、未知 filter、本地 id 條件 |
 * | reference / upload 固定值 | 缺席、null、空集合;reference 的 `ctx.user.id` / `ctx.user.orgId` 預設表達式 | 非空的 constant / default |
 * | lookup 選項的固定預設 | 缺席、null、空集合(選項在執行期查) | 任何非空固定值(改用 account / slug 當值也一樣),多選逐項驗 |
 * | 靜態選項 / 欄位類別 | 靜態 values;受管類別 key 與它的種子選項 | 不在同一計畫的類別或選項 |
 * | 共用流程 assignee | `manager`、可解析的 `formKey` / `fieldKey`、只用權限與非指定組織來源的人員條件 | 人員條件的使用者 / 角色 / 指定組織、指向租戶客製表單 |
 *
 * 表達式(default、computed、rules.custom、visibleWhen、readonlyWhen、skipWhen)另驗 ID 語意,見
 * `portable-expression.ts`:ID 只能與另一個動態 ID 或 null 比較、`in` 只能對動態 ID 集合或空陣列、
 * `if` 的 ID 分支不能混入寫死的值、其餘運算子不收 ID。
 */
import { arrayColumnsOf } from "../form/array";
import { scanExpression } from "../form/expression-shape";
import {
  ARRAY_COLUMN_TYPES,
  type ArrayColumnDef,
  type Expression,
  FIELD_TYPES,
  type FieldDef,
  type FormDefinition,
  type Prefill,
} from "../form/types";
import type { WorkflowIssue } from "../workflow/issues";
import { validateWorkflowDefinition } from "../workflow/validate-definition";
import { isPlainRecord, joinSeedPath } from "./canonical";
import type {
  DefinitionSeedSet,
  FormDefinitionSeedSet,
  WorkflowDefinitionSeedSet,
} from "./declaration";
import { definitionSeedShapeIssues } from "./definition-shape";
import {
  type IdFinding,
  type IdScope,
  ORIGIN,
  analyzeIdFlow,
  hasIdOrigin,
  idTagOf,
  isPureId,
  isPureIdList,
} from "./portable-expression";

/** 同一計畫(同一次交付)可解析的穩定 key;由呼叫端從 registry 或資料庫組出來。 */
export interface PortableCatalog {
  /** 表單模組(`modules.engine = "form"`)的 key。 */
  formModuleKeys: ReadonlySet<string>;
  /** 受管欄位類別 key → 它的受管(種子)選項 value。 */
  fieldCategories: ReadonlyMap<string, ReadonlySet<string>>;
  /** 可解析的共用表單:key → 這個計畫要交付(或已受管)的定義。 */
  sharedForms: ReadonlyMap<string, FormDefinition>;
  /** 已知存在、但屬於租戶客製的表單 key;只用來把錯誤講清楚。 */
  tenantFormKeys?: ReadonlySet<string>;
}

export const PORTABLE_ERROR_CODES = [
  "SEED_SHAPE",
  "DEPENDENCY_UNRESOLVED",
  "LOOKUP_PROVIDER_UNSUPPORTED",
  "LOOKUP_FILTER_UNSUPPORTED",
  "LOOKUP_SOURCE_UNSUPPORTED",
  "FIXED_ENVIRONMENT_VALUE",
  "FIELD_UNSUPPORTED",
  "EXPRESSION_UNSUPPORTED",
  "ID_COMPARISON",
  "ID_FIXED_MIX",
  "ID_OPERATOR",
  "ASSIGNEE_NOT_PORTABLE",
  "WORKFLOW_INVALID",
] as const;

export const PORTABLE_WARNING_CODES = ["WORKFLOW_WARNING"] as const;

export type PortableErrorCode = (typeof PORTABLE_ERROR_CODES)[number];

export type PortableWarningCode = (typeof PORTABLE_WARNING_CODES)[number];

/** 一筆可攜性問題;`path` 是宣告內的精確位置(如 `definition.fields.3.default.value`)。 */
export interface PortableIssue {
  code: PortableErrorCode | PortableWarningCode;
  /** 給設計者 / 操作者看的繁中說明(含修正原因)。 */
  message: string;
  path: string;
}

/** 與既有定義檢查器同形:有 `errors` 就不能交付,`warnings` 只提醒。 */
export interface PortableValidationReport {
  errors: PortableIssue[];
  warnings: PortableIssue[];
}

/** 可攜定義認得的 lookup 來源與各自可用的固定條件(其餘 provider / 條件一律拒絕)。 */
const FORM_SUBMISSION = "form_submission";

const PORTABLE_LOOKUP_FILTERS: Readonly<Record<string, readonly string[]>> = {
  user: ["enabled"],
  org: ["enabled"],
  [FORM_SUBMISSION]: [],
};

const LOOKUP_SOURCE_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "labelField",
  "labelTemplate",
  "valueField",
  "filter",
  "formKey",
  "completedOnly",
]);

/** 引用欄預設值只能是這兩個系統值(與既有檢查器同一份清單)。 */
const REFERENCE_DEFAULT_PATHS: ReadonlySet<string> = new Set([
  "ctx.user.id",
  "ctx.user.orgId",
]);

/** 共用流程不可攜的審核者來源(既有檢查器的錯誤碼)。 */
const ASSIGNEE_CODES: ReadonlySet<string> = new Set([
  "AUDIENCE_IN_SHARED",
  "FIELD_FORM_MISSING",
  "FIELD_MISSING",
  "FIELD_NOT_USER_REFERENCE",
  "FIELD_NOT_ORG_REFERENCE",
]);

class PortableCollector {
  readonly errors: PortableIssue[] = [];
  readonly warnings: PortableIssue[] = [];

  error(code: PortableErrorCode, path: string, message: string): void {
    if (
      !this.errors.some((issue) => issue.code === code && issue.path === path)
    ) {
      this.errors.push({ code, message, path });
    }
  }

  warn(code: PortableWarningCode, path: string, message: string): void {
    this.warnings.push({ code, message, path });
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

/** 固定值的「空」:缺席、null 或空集合。 */
function isEmptyFixedValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** 選項欄的一個固定值的識別(靜態存 value 字串;類別 / lookup 存 `{ value, label }`)。 */
function optionValueOf(item: unknown): unknown {
  return isPlainRecord(item) ? item.value : item;
}

function expressionPath(base: string, exprPath: string): string {
  return exprPath === "" ? base : `${base}.${exprPath}`;
}

// ---- 表單:欄位的 ID 語意 ----

type FormResolver = (formKey: string) => FormDefinition | undefined;

/** `form_submission` 來源的摘要槽名稱(執行端先認槽,再認同名欄位)。 */
const SUMMARY_SLOTS: ReadonlySet<string> = new Set(["title", "date", "amount"]);

function columnId(arrayKey: string, columnKey: string): string {
  return `${arrayKey}.${columnKey}`;
}

/** 欄位型別本身帶的 ID 語意:引用欄與 lookup 選項的值是 ID(多選是 ID 集合)。 */
function baseOriginsOf(field: FieldDef | ArrayColumnDef): number {
  if ((field as FieldDef).type === "reference") {
    return ORIGIN.id;
  }
  if (field.options?.kind === "lookup") {
    return (field as FieldDef).type === "multiSelect"
      ? ORIGIN.idList
      : ORIGIN.id;
  }
  return ORIGIN.dynamic;
}

function fieldsOf(definition: FormDefinition): FieldDef[] {
  return Array.isArray(definition.fields)
    ? definition.fields.filter((field) => isPlainRecord(field))
    : [];
}

function prefillsOf(definition: FormDefinition): Prefill[] {
  return Array.isArray(definition.prefills)
    ? definition.prefills.filter((prefill) => isPlainRecord(prefill))
    : [];
}

function computedExprOf(
  field: FieldDef | ArrayColumnDef,
): Expression | undefined {
  const source = recordOf(field.valueSource);
  return source?.kind === "computed" && source.expr !== undefined
    ? (source.expr as Expression)
    : undefined;
}

function defaultExprOf(field: FieldDef): Expression | undefined {
  const fallback = recordOf(field.default);
  return fallback?.kind === "expression" && fallback.expr !== undefined
    ? (fallback.expr as Expression)
    : undefined;
}

/**
 * 一張表單每個欄位(與明細子欄 `<明細>.<子欄>`)的值來源:型別本身的 ID、由來源 id 帶入的目標、
 * 預設值公式與計算公式沿依賴鏈傳下去的 ID。跨表單(`form_submission` 帶入)由 `resolve` 找來源表單。
 */
class FormOrigins {
  /** 已納入計算的表單:定義與目前算到的來源(同一張圖一起收斂,自己帶入自己、互相帶入都算得到)。 */
  private readonly forms = new Map<
    string,
    { definition: FormDefinition; origins: Map<string, number> }
  >();

  constructor(private readonly resolve: FormResolver) {}

  of(formKey: string): ReadonlyMap<string, number> | undefined {
    if (this.ensure(formKey) === undefined) {
      return undefined;
    }
    this.settle();
    return this.forms.get(formKey)?.origins;
  }

  /** 把表單納入計算(起點是型別本身的 ID);解不到回 undefined。不在這裡遞迴,由 `settle` 一起收斂。 */
  private ensure(formKey: string): Map<string, number> | undefined {
    const known = this.forms.get(formKey);
    if (known !== undefined) {
      return known.origins;
    }
    const definition = this.resolve(formKey);
    if (definition === undefined) {
      return undefined;
    }
    const origins = new Map<string, number>();
    for (const field of fieldsOf(definition)) {
      origins.set(field.key, baseOriginsOf(field));
      for (const column of arrayColumnsOf(field)) {
        origins.set(columnId(field.key, column.key), baseOriginsOf(column));
      }
    }
    this.forms.set(formKey, { definition, origins });
    return origins;
  }

  /**
   * 傳播到不再變化為止。標記只會從「不是 ID」變成「是 ID」、表單數量有限,所以一定收斂;
   * 過程中新納入的表單(被帶入的來源)也要再跑一輪。
   */
  private settle(): void {
    let hasChanged = true;
    while (hasChanged) {
      hasChanged = false;
      const formCount = this.forms.size;
      for (const { definition, origins } of this.forms.values()) {
        for (const [id, flow] of this.flowsOf(definition, origins)) {
          if (hasIdOrigin(flow) && !hasIdOrigin(origins.get(id) ?? 0)) {
            origins.set(id, idTagOf(flow));
            hasChanged = true;
          }
        }
      }
      hasChanged ||= this.forms.size !== formCount;
    }
  }

  /** 這一輪每個「會寫進某欄位」的值來源:帶入、計算公式、預設值公式、列內公式。 */
  private flowsOf(
    definition: FormDefinition,
    origins: ReadonlyMap<string, number>,
  ): [string, number][] {
    const flows: [string, number][] = [];
    for (const prefill of prefillsOf(definition)) {
      const mappings = Array.isArray(prefill.mapping) ? prefill.mapping : [];
      for (const mapping of mappings) {
        flows.push([
          mapping.fieldKey,
          this.prefillSourceOrigins(prefill, mapping),
        ]);
      }
    }
    for (const field of fieldsOf(definition)) {
      flows.push(...fieldFlowsOf(field, origins));
    }
    return flows;
  }

  /**
   * 帶入來源欄位的值來源:provider 的 `id` 是 ID;表單提交的欄位照來源表單的欄位。
   * 摘要槽(`title` / `date` / `amount`)優先於同名欄位,讀的是該槽對到的欄位 ——
   * 與執行端 lookup 的解析順序一致(槽沒對到欄位時讀到的是 null,不帶 ID)。
   */
  private prefillSourceOrigins(
    prefill: Prefill,
    mapping: { sourceField?: unknown },
  ): number {
    const { sourceField } = mapping;
    if (sourceField === "id") {
      return ORIGIN.id;
    }
    const source = recordOf(prefill.source);
    if (
      source?.provider !== FORM_SUBMISSION ||
      typeof source.formKey !== "string" ||
      typeof sourceField !== "string"
    ) {
      return ORIGIN.dynamic;
    }
    const origins = this.ensure(source.formKey);
    if (origins === undefined) {
      return ORIGIN.dynamic;
    }
    if (!SUMMARY_SLOTS.has(sourceField)) {
      return origins.get(sourceField) ?? ORIGIN.dynamic;
    }
    const summaryMap = recordOf(
      this.forms.get(source.formKey)?.definition.summaryMap,
    );
    const slotField = summaryMap?.[sourceField];
    return typeof slotField === "string"
      ? (origins.get(slotField) ?? ORIGIN.dynamic)
      : ORIGIN.dynamic;
  }
}

/** 一個欄位(與它的明細子欄)的公式算出來的值來源。 */
function fieldFlowsOf(
  field: FieldDef,
  origins: ReadonlyMap<string, number>,
): [string, number][] {
  const flows: [string, number][] = [];
  for (const expr of [computedExprOf(field), defaultExprOf(field)]) {
    if (expr !== undefined) {
      flows.push([field.key, quietOriginsOf(expr, formScope(origins))]);
    }
  }
  for (const column of arrayColumnsOf(field)) {
    const expr = computedExprOf(column);
    if (expr !== undefined) {
      flows.push([
        columnId(field.key, column.key),
        quietOriginsOf(expr, formScope(origins, field.key)),
      ]);
    }
  }
  return flows;
}

function formScope(
  origins: ReadonlyMap<string, number>,
  arrayKey?: string,
): IdScope {
  const scope: IdScope = {
    field: (key) => origins.get(key),
    aggregateColumn: (array, column) => origins.get(columnId(array, column)),
  };
  if (arrayKey !== undefined) {
    scope.column = (key) => origins.get(columnId(arrayKey, key));
  }
  return scope;
}

/** 傳播用:只取來源,不收問題;形狀不合法的公式當成一般動態值(問題在正式檢查時報)。 */
function quietOriginsOf(expr: Expression, scope: IdScope): number {
  return scanExpression(expr).issues.length > 0
    ? ORIGIN.dynamic
    : analyzeIdFlow(expr, scope).origins;
}

// ---- 表單:逐項檢查 ----

interface FormCheckContext {
  seed: FormDefinitionSeedSet;
  catalog: PortableCatalog;
  origins: ReadonlyMap<string, number>;
  collector: PortableCollector;
}

function resolveSharedForm(
  seed: DefinitionSeedSet,
  catalog: PortableCatalog,
  formKey: string,
): FormDefinition | undefined {
  // 帶入與引用可以指向自己:自己就是這次要交付的定義
  return seed.kind === "form-definition" && seed.key === formKey
    ? seed.definition
    : catalog.sharedForms.get(formKey);
}

function unresolvedFormMessage(
  catalog: PortableCatalog,
  formKey: string,
): string {
  return catalog.tenantFormKeys?.has(formKey) === true
    ? `表單 ${formKey} 是租戶客製表單,共用定義不能引用它`
    : `表單 ${formKey} 不在這次交付可解析的共用定義裡;請一併登記它,或改掉這個引用`;
}

function checkLookupFilter(
  provider: string,
  filter: unknown,
  path: string,
  collector: PortableCollector,
): void {
  if (filter === undefined || filter === null) {
    return;
  }
  if (!isPlainRecord(filter)) {
    collector.error(
      "LOOKUP_FILTER_UNSUPPORTED",
      path,
      "lookup 的 filter 必須是物件",
    );
    return;
  }
  const allowed = PORTABLE_LOOKUP_FILTERS[provider] ?? [];
  for (const [key, value] of Object.entries(filter)) {
    if (!allowed.includes(key)) {
      collector.error(
        "LOOKUP_FILTER_UNSUPPORTED",
        joinSeedPath(path, key),
        `lookup 來源 ${provider} 的固定條件 ${key} 不可攜(本地 id 或未知條件);可用的只有:${allowed.join("、") || "無"}`,
      );
    } else if (typeof value !== "boolean") {
      collector.error(
        "LOOKUP_FILTER_UNSUPPORTED",
        joinSeedPath(path, key),
        `lookup 來源 ${provider} 的固定條件 ${key} 只能是 true / false`,
      );
    }
  }
}

function checkLookupSource(
  source: unknown,
  path: string,
  context: Pick<FormCheckContext, "seed" | "catalog" | "collector">,
): void {
  const { catalog, collector, seed } = context;
  if (!isPlainRecord(source)) {
    collector.error(
      "LOOKUP_SOURCE_UNSUPPORTED",
      path,
      "lookup 來源描述必須是物件",
    );
    return;
  }
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined && !LOOKUP_SOURCE_KEYS.has(key)) {
      collector.error(
        "LOOKUP_SOURCE_UNSUPPORTED",
        joinSeedPath(path, key),
        `lookup 來源描述的 ${key} 不是已知設定,無法判定能不能跨環境交付`,
      );
    }
  }
  const provider = source.provider;
  if (
    typeof provider !== "string" ||
    !Object.hasOwn(PORTABLE_LOOKUP_FILTERS, provider)
  ) {
    collector.error(
      "LOOKUP_PROVIDER_UNSUPPORTED",
      joinSeedPath(path, "provider"),
      `lookup 來源 ${String(provider)} 不在可攜範圍(只支援 ${Object.keys(PORTABLE_LOOKUP_FILTERS).join("、")})`,
    );
    return;
  }
  checkLookupFilter(
    provider,
    source.filter,
    joinSeedPath(path, "filter"),
    collector,
  );
  if (provider !== FORM_SUBMISSION) {
    return;
  }
  const formKey = source.formKey;
  if (typeof formKey !== "string" || formKey === "") {
    collector.error(
      "DEPENDENCY_UNRESOLVED",
      joinSeedPath(path, "formKey"),
      "「其他表單提交」來源要指定 formKey(查哪張共用表單的提交)",
    );
  } else if (resolveSharedForm(seed, catalog, formKey) === undefined) {
    collector.error(
      "DEPENDENCY_UNRESOLVED",
      joinSeedPath(path, "formKey"),
      unresolvedFormMessage(catalog, formKey),
    );
  }
}

/** 欄位類別:類別 key 要受管。 */
function checkFieldCategory(
  options: Record<string, unknown>,
  path: string,
  context: FormCheckContext,
): void {
  const key = options.key;
  if (typeof key !== "string" || !context.catalog.fieldCategories.has(key)) {
    context.collector.error(
      "DEPENDENCY_UNRESOLVED",
      joinSeedPath(path, "key"),
      `欄位類別 ${String(key)} 不是這次交付受管的類別;請在普通種子登記它`,
    );
  }
}

/** 選項來源:靜態照收;類別要受管;lookup 驗來源描述(`allowLookup` = 表單層才有 lookup)。 */
function checkOptions(
  field: FieldDef | ArrayColumnDef,
  path: string,
  allowLookup: boolean,
  context: FormCheckContext,
): void {
  const options = recordOf(field.options);
  if (options === null) {
    return;
  }
  const optionsPath = joinSeedPath(path, "options");
  switch (options.kind) {
    case "static": {
      return;
    }
    case "fieldCategory": {
      checkFieldCategory(options, optionsPath, context);
      return;
    }
    case "lookup": {
      if (allowLookup) {
        checkLookupSource(
          options.source,
          joinSeedPath(optionsPath, "source"),
          context,
        );
        return;
      }
      context.collector.error(
        "FIELD_UNSUPPORTED",
        optionsPath,
        "明細子欄不支援 lookup 選項,無法判定可攜性",
      );
      return;
    }
    default: {
      context.collector.error(
        "FIELD_UNSUPPORTED",
        joinSeedPath(optionsPath, "kind"),
        `選項來源 ${String(options.kind)} 不是已知種類,無法判定可攜性`,
      );
    }
  }
}

/** 一個固定值(固定值來源或固定預設)依欄位語意能不能帶走。 */
function checkFixedValue(
  field: FieldDef,
  value: unknown,
  path: string,
  context: FormCheckContext,
): void {
  if (isEmptyFixedValue(value)) {
    return;
  }
  const { collector } = context;
  if (field.type === "reference" || field.type === "upload") {
    collector.error(
      "FIXED_ENVIRONMENT_VALUE",
      path,
      field.type === "reference"
        ? `引用欄位「${field.label}」不能帶固定值:它指向來源環境的資料,換環境後對不到`
        : `上傳欄位「${field.label}」不能帶固定值:物件路徑只存在來源環境`,
    );
    return;
  }
  const options = recordOf(field.options);
  // 型別本身不是 ID,但值是由來源 id 帶入或由 ID 算出來的欄位:同樣不能帶寫死的值
  if (
    options?.kind !== "lookup" &&
    hasIdOrigin(context.origins.get(field.key) ?? 0)
  ) {
    collector.error(
      "FIXED_ENVIRONMENT_VALUE",
      path,
      `「${field.label}」的值是 ID(由來源帶入或由 ID 欄位算出),不能帶固定值`,
    );
    return;
  }
  if (field.type === "select" || field.type === "multiSelect") {
    checkFixedOptionValue(field, options, value, path, context);
  }
}

/** 選項欄的固定值:lookup 選項一律不行;欄位類別要是受管的種子選項;靜態選項照收。 */
function checkFixedOptionValue(
  field: FieldDef,
  options: Record<string, unknown> | null,
  value: unknown,
  path: string,
  { collector, catalog }: FormCheckContext,
): void {
  const picked = Array.isArray(value) ? (value as unknown[]) : [value];
  const pathOf = (index: number): string =>
    Array.isArray(value) ? joinSeedPath(path, index) : path;
  if (options?.kind === "lookup") {
    for (const index of picked.keys()) {
      collector.error(
        "FIXED_ENVIRONMENT_VALUE",
        pathOf(index),
        `「${field.label}」的選項來自 lookup(使用者 / 組織 / 表單提交),不能帶固定值;選項一律在執行期查`,
      );
    }
    return;
  }
  if (options?.kind !== "fieldCategory" || typeof options.key !== "string") {
    return;
  }
  const managed = catalog.fieldCategories.get(options.key);
  if (managed === undefined) {
    return;
  }
  for (const [index, item] of picked.entries()) {
    const optionValue = optionValueOf(item);
    if (typeof optionValue !== "string" || !managed.has(optionValue)) {
      collector.error(
        "DEPENDENCY_UNRESOLVED",
        pathOf(index),
        `「${field.label}」的固定值 ${String(optionValue)} 不是類別 ${options.key} 的受管種子選項`,
      );
    }
  }
}

function isReferenceDefault(expr: Expression): boolean {
  if (!isPlainRecord(expr) || Object.keys(expr).length !== 1) {
    return false;
  }
  const argument: unknown = expr.var;
  const target: unknown = Array.isArray(argument)
    ? (argument as unknown[])[0]
    : argument;
  // `[路徑, null]` 的 null 預設值不帶任何環境資料,與只寫路徑等價;非空的預設值就是寫死的值
  const hasFixedFallback =
    Array.isArray(argument) &&
    (argument.length > 2 ||
      (argument.length === 2 && (argument as unknown[])[1] !== null));
  return (
    !hasFixedFallback &&
    typeof target === "string" &&
    REFERENCE_DEFAULT_PATHS.has(target)
  );
}

const FINDING_HINT: Readonly<Record<IdFinding["code"], string>> = {
  ID_COMPARISON: "請改成與另一個動態 ID 欄位 / 系統值比較,或判斷是否為空",
  ID_FIXED_MIX: "請不要把寫死的值放進會被當成 ID 的位置",
  ID_OPERATOR: "ID 只能拿來比較相等、判空或原樣傳遞",
  EXPRESSION_UNSUPPORTED: "請修正表達式後再匯出",
};

interface ExpressionSlot {
  expr: Expression;
  /** 宣告內的位置(到表達式根)。 */
  path: string;
  label: string;
  scope: IdScope;
  /**
   * 這個表達式的結果會不會變成欄位值:`value` = 會(帶 ID 就不能混入寫死的值);
   * `idValue` / `idListValue` = 欄位型別本身是 ID / ID 集合(結果只能是動態 ID、null,集合另可為空陣列);
   * `derivedIdValue` = 欄位的值由別處帶入或算出 ID(結果不能含寫死的值);`condition` = 只看真假。
   */
  usage: "condition" | "value" | "idValue" | "idListValue" | "derivedIdValue";
}

const EMPTY_ID_VALUE = ORIGIN.nil | ORIGIN.emptyList;

/** 公式結果要寫進 ID 欄位時能不能收。 */
function isAcceptedIdValue(
  usage: ExpressionSlot["usage"],
  origins: number,
): boolean {
  if (usage === "idValue") {
    return isPureId(origins) || origins === ORIGIN.nil;
  }
  // 空集合(與 null)是合法的「沒有選」
  return isPureIdList(origins) || (origins & ~EMPTY_ID_VALUE) === 0;
}

function checkExpression(
  slot: ExpressionSlot,
  collector: PortableCollector,
  reportShape = true,
): void {
  const scan = scanExpression(slot.expr);
  if (scan.issues.length > 0) {
    if (reportShape) {
      for (const issue of scan.issues) {
        collector.error(
          "EXPRESSION_UNSUPPORTED",
          expressionPath(slot.path, issue.path),
          `${slot.label}:${issue.detail};無法判定語意。${FINDING_HINT.EXPRESSION_UNSUPPORTED}`,
        );
      }
    }
    return;
  }
  const flow = analyzeIdFlow(slot.expr, slot.scope);
  for (const finding of flow.findings) {
    collector.error(
      finding.code,
      expressionPath(slot.path, finding.path),
      `${slot.label}:${finding.detail}。${FINDING_HINT[finding.code]}`,
    );
  }
  if (slot.usage === "condition") {
    return;
  }
  if (
    (slot.usage === "idValue" || slot.usage === "idListValue") &&
    !isAcceptedIdValue(slot.usage, flow.origins)
  ) {
    collector.error(
      "ID_FIXED_MIX",
      slot.path,
      `${slot.label}:這個欄位存的是 ID,公式的結果只能是動態 ID。${FINDING_HINT.ID_FIXED_MIX}`,
    );
    return;
  }
  const hasFixed = (flow.origins & ORIGIN.fixed) !== 0;
  if (slot.usage === "derivedIdValue" && hasFixed) {
    collector.error(
      "ID_FIXED_MIX",
      slot.path,
      `${slot.label}:這個欄位的值是 ID(由來源帶入或由 ID 欄位算出),公式不能產生寫死的值。${FINDING_HINT.ID_FIXED_MIX}`,
    );
    return;
  }
  if (hasIdOrigin(flow.origins) && hasFixed) {
    collector.error(
      "ID_FIXED_MIX",
      slot.path,
      `${slot.label}:結果可能是 ID、也可能是寫死的值。${FINDING_HINT.ID_FIXED_MIX}`,
    );
  }
}

/** 欄位存的是不是 ID:先看型別本身,再看傳播後的最終來源(帶入、公式算出的 ID)。 */
function valueUsageOf(
  field: FieldDef,
  origins: ReadonlyMap<string, number>,
): ExpressionSlot["usage"] {
  const base = baseOriginsOf(field);
  if (base === ORIGIN.id) {
    return "idValue";
  }
  if (base === ORIGIN.idList) {
    return "idListValue";
  }
  return hasIdOrigin(origins.get(field.key) ?? 0) ? "derivedIdValue" : "value";
}

function checkFieldExpressions(
  field: FieldDef,
  path: string,
  context: FormCheckContext,
): void {
  const { collector, origins } = context;
  const scope = formScope(origins);
  const label = `「${field.label}」`;
  const computed = computedExprOf(field);
  if (computed !== undefined) {
    checkExpression(
      {
        expr: computed,
        path: joinSeedPath(path, "valueSource.expr"),
        label: `${label}的公式`,
        scope,
        usage: valueUsageOf(field, origins),
      },
      collector,
    );
  }
  const fallback = defaultExprOf(field);
  if (fallback !== undefined) {
    const defaultPath = joinSeedPath(path, "default.expr");
    if (field.type === "reference" && !isReferenceDefault(fallback)) {
      collector.error(
        "FIXED_ENVIRONMENT_VALUE",
        defaultPath,
        `引用欄位${label}的預設值只能是「填寫者」或「填寫者的組織」(ctx.user.id / ctx.user.orgId)`,
      );
    } else {
      checkExpression(
        {
          expr: fallback,
          path: defaultPath,
          label: `${label}的預設值公式`,
          scope,
          usage: valueUsageOf(field, origins),
        },
        collector,
      );
    }
  }
  const conditions: [string, string, Expression | null | undefined][] = [
    ["visibleWhen", "顯示條件", field.visibleWhen],
    ["readonlyWhen", "唯讀條件", field.readonlyWhen],
    ["rules.custom", "自訂驗證", recordOf(field.rules)?.custom as Expression],
  ];
  for (const [property, name, expr] of conditions) {
    if (expr !== undefined && expr !== null) {
      checkExpression(
        {
          expr,
          path: joinSeedPath(path, property),
          label: `${label}的${name}`,
          scope,
          usage: "condition",
        },
        collector,
      );
    }
  }
}

function checkColumns(
  field: FieldDef,
  path: string,
  context: FormCheckContext,
): void {
  if (field.type !== "array" || !Array.isArray(field.columns)) {
    return;
  }
  for (const [index, column] of (field.columns as unknown[]).entries()) {
    checkColumn(
      field,
      column,
      joinSeedPath(path, `columns.${String(index)}`),
      context,
    );
  }
}

function checkColumn(
  field: FieldDef,
  column: unknown,
  columnPath: string,
  context: FormCheckContext,
): void {
  const { collector, origins } = context;
  if (!isPlainRecord(column)) {
    collector.error("FIELD_UNSUPPORTED", columnPath, "明細子欄必須是物件");
    return;
  }
  if (!(ARRAY_COLUMN_TYPES as readonly unknown[]).includes(column.type)) {
    collector.error(
      "FIELD_UNSUPPORTED",
      joinSeedPath(columnPath, "type"),
      `明細子欄型別 ${String(column.type)} 不在支援範圍,無法判定可攜性`,
    );
    return;
  }
  for (const property of ["default", "source", "columns"]) {
    if (!isEmptyFixedValue(column[property])) {
      collector.error(
        "FIELD_UNSUPPORTED",
        joinSeedPath(columnPath, property),
        `明細子欄不支援 ${property},無法判定可攜性`,
      );
    }
  }
  const sourceKind = recordOf(column.valueSource)?.kind;
  if (sourceKind !== "input" && sourceKind !== "computed") {
    collector.error(
      "FIELD_UNSUPPORTED",
      joinSeedPath(columnPath, "valueSource"),
      "明細子欄的值來源只能是使用者填或列內公式",
    );
  }
  const definition = column as unknown as ArrayColumnDef;
  checkOptions(definition, columnPath, false, context);
  const computed = computedExprOf(definition);
  if (computed !== undefined) {
    checkExpression(
      {
        expr: computed,
        path: joinSeedPath(columnPath, "valueSource.expr"),
        label: `「${field.label}」子欄位「${definition.label}」的公式`,
        scope: formScope(origins, field.key),
        usage: "value",
      },
      collector,
    );
  }
}

function checkField(
  raw: unknown,
  path: string,
  context: FormCheckContext,
): void {
  const { collector } = context;
  if (!isPlainRecord(raw)) {
    collector.error("FIELD_UNSUPPORTED", path, "欄位定義必須是物件");
    return;
  }
  const field = raw as unknown as FieldDef;
  if (raw.redacted === true) {
    collector.error(
      "FIELD_UNSUPPORTED",
      path,
      `欄位 ${String(raw.key)} 是執行端省略內容後的骨架,不是完整定義,不能匯出`,
    );
    return;
  }
  if (!(FIELD_TYPES as readonly unknown[]).includes(raw.type)) {
    collector.error(
      "FIELD_UNSUPPORTED",
      joinSeedPath(path, "type"),
      `欄位型別 ${String(raw.type)} 不是已知型別,無法判定可攜性`,
    );
    return;
  }
  checkOptions(field, path, true, context);
  if (field.type === "reference" && !isEmptyFixedValue(raw.source)) {
    checkLookupSource(raw.source, joinSeedPath(path, "source"), context);
  }
  const valueSource = recordOf(raw.valueSource);
  if (valueSource?.kind === "constant") {
    checkFixedValue(
      field,
      valueSource.value,
      joinSeedPath(path, "valueSource.value"),
      context,
    );
  }
  const fallback = recordOf(raw.default);
  if (fallback?.kind === "constant") {
    checkFixedValue(
      field,
      fallback.value,
      joinSeedPath(path, "default.value"),
      context,
    );
  }
  checkFieldExpressions(field, path, context);
  checkColumns(field, path, context);
}

function validateForm(
  seed: FormDefinitionSeedSet,
  catalog: PortableCatalog,
  collector: PortableCollector,
): void {
  if (!catalog.formModuleKeys.has(seed.moduleKey)) {
    collector.error(
      "DEPENDENCY_UNRESOLVED",
      "moduleKey",
      `表單模組 ${seed.moduleKey} 不在這次交付可解析的模組裡(需要 engine = form 的模組宣告)`,
    );
  }
  const forms = new FormOrigins((formKey) =>
    resolveSharedForm(seed, catalog, formKey),
  );
  const context: FormCheckContext = {
    seed,
    catalog,
    origins: forms.of(seed.key) ?? new Map<string, number>(),
    collector,
  };
  for (const [index, field] of (
    seed.definition.fields as unknown[]
  ).entries()) {
    checkField(field, `definition.fields.${String(index)}`, context);
  }
  for (const [index, prefill] of (
    seed.definition.prefills as unknown[]
  ).entries()) {
    const path = `definition.prefills.${String(index)}`;
    if (isPlainRecord(prefill)) {
      checkLookupSource(prefill.source, joinSeedPath(path, "source"), context);
    } else {
      collector.error("FIELD_UNSUPPORTED", path, "帶入規則必須是物件");
    }
  }
}

// ---- 流程 ----

function workflowIssuePath(issue: WorkflowIssue): string {
  const { location } = issue;
  let path = "definition";
  if (location.stepIndex !== undefined) {
    path = `definition.steps.${String(location.stepIndex)}`;
  } else if (location.edgeIndex !== undefined) {
    path = `definition.edges.${String(location.edgeIndex)}`;
  } else if (location.property === "checkFormKey") {
    return "checkFormKey";
  }
  if (location.property !== undefined) {
    path = joinSeedPath(path, location.property);
  }
  return expressionPath(path, location.exprPath ?? "");
}

/** `skipWhen` 對照的表單:檢查用表單優先,否則第一個 `field` 來源的表單(與既有檢查器同一套選法)。 */
function skipWhenFormKeyOf(seed: WorkflowDefinitionSeedSet): string | null {
  if (seed.checkFormKey !== null) {
    return seed.checkFormKey;
  }
  for (const step of seed.definition.steps) {
    const assignee = recordOf((step as { assignee?: unknown }).assignee);
    if (assignee?.kind === "field" && typeof assignee.formKey === "string") {
      return assignee.formKey;
    }
  }
  return null;
}

function checkSkipConditions(
  seed: WorkflowDefinitionSeedSet,
  catalog: PortableCatalog,
  collector: PortableCollector,
): void {
  const formKey = skipWhenFormKeyOf(seed);
  const forms = new FormOrigins((key) => catalog.sharedForms.get(key));
  const origins = formKey === null ? undefined : forms.of(formKey);
  for (const [index, step] of seed.definition.steps.entries()) {
    const skipWhen = (step as { skipWhen?: Expression | null }).skipWhen;
    if (skipWhen === undefined || skipWhen === null) {
      continue;
    }
    const path = `definition.steps.${String(index)}.skipWhen`;
    const label = `關卡 ${step.key} 的跳過條件`;
    const scan = scanExpression(skipWhen);
    if (
      origins === undefined &&
      (scan.refs.length > 0 || scan.rowRefs.length > 0)
    ) {
      collector.error(
        "EXPRESSION_UNSUPPORTED",
        path,
        `${label}引用了表單欄位,但沒有可解析的檢查用表單,無法判定欄位是不是 ID;請指定 checkFormKey 並一併登記該表單`,
      );
      continue;
    }
    // 形狀問題既有檢查器已報(SKIP_INVALID / SKIP_UNKNOWN_OPERATOR),這裡不重複
    checkExpression(
      {
        expr: skipWhen,
        path,
        label,
        scope: formScope(origins ?? new Map<string, number>()),
        usage: "condition",
      },
      collector,
      false,
    );
  }
}

/** 關卡的外框:既有檢查器假設每一關是物件、審核關卡有 assignee;不是就先擋,不往下跑。 */
function hasMalformedStep(
  steps: readonly unknown[],
  collector: PortableCollector,
): boolean {
  let isMalformed = false;
  for (const [index, step] of steps.entries()) {
    const record = recordOf(step);
    const isReview = record !== null && record.kind !== "join";
    if (
      record === null ||
      typeof record.key !== "string" ||
      (isReview && recordOf(record.assignee) === null)
    ) {
      isMalformed = true;
      collector.error(
        "WORKFLOW_INVALID",
        `definition.steps.${String(index)}`,
        "關卡必須是物件、有 key,審核關卡要有 assignee",
      );
    }
  }
  return isMalformed;
}

/** 既有檢查器報「審核者欄位所屬表單不存在」時,那一關指到的 formKey(用來講清楚是缺登記還是租戶客製)。 */
function missingAssigneeFormKeyOf(
  seed: WorkflowDefinitionSeedSet,
  issue: WorkflowIssue,
): string | null {
  const { stepIndex } = issue.location;
  if (issue.code !== "FIELD_FORM_MISSING" || stepIndex === undefined) {
    return null;
  }
  const step = seed.definition.steps[stepIndex] as
    { assignee?: unknown } | undefined;
  const formKey = recordOf(step?.assignee)?.formKey;
  return typeof formKey === "string" ? formKey : null;
}

function validateWorkflow(
  seed: WorkflowDefinitionSeedSet,
  catalog: PortableCatalog,
  collector: PortableCollector,
): void {
  if (hasMalformedStep(seed.definition.steps, collector)) {
    return;
  }
  const checkForm =
    seed.checkFormKey === null
      ? undefined
      : catalog.sharedForms.get(seed.checkFormKey);
  if (seed.checkFormKey !== null && checkForm === undefined) {
    collector.error(
      "DEPENDENCY_UNRESOLVED",
      "checkFormKey",
      unresolvedFormMessage(catalog, seed.checkFormKey),
    );
  }
  const report = validateWorkflowDefinition(seed.definition, {
    isShared: true,
    forms: new Map(
      [...catalog.sharedForms].map(([key, definition]) => [
        key,
        fieldsOf(definition),
      ]),
    ),
    ...(checkForm !== undefined && { checkFormFields: fieldsOf(checkForm) }),
  });
  for (const issue of report.errors) {
    const formKey = missingAssigneeFormKeyOf(seed, issue);
    collector.error(
      ASSIGNEE_CODES.has(issue.code)
        ? "ASSIGNEE_NOT_PORTABLE"
        : "WORKFLOW_INVALID",
      workflowIssuePath(issue),
      formKey === null
        ? `${issue.message}(${issue.code})`
        : `${issue.message}:${unresolvedFormMessage(catalog, formKey)}`,
    );
  }
  for (const issue of report.warnings) {
    collector.warn(
      "WORKFLOW_WARNING",
      workflowIssuePath(issue),
      `${issue.message}(${issue.code})`,
    );
  }
  checkSkipConditions(seed, catalog, collector);
}

/**
 * 一份定義宣告能不能跨環境交付。`seed` 可能來自匯出、手改的檔案或跨程序 JSON,先驗形狀;
 * 形狀不對就只回形狀問題(內容無從判斷)。
 */
export function validatePortableDefinition(
  seed: DefinitionSeedSet,
  catalog: PortableCatalog,
): PortableValidationReport {
  const collector = new PortableCollector();
  const shapeIssues = definitionSeedShapeIssues(seed);
  if (shapeIssues.length > 0) {
    for (const issue of shapeIssues) {
      collector.error("SEED_SHAPE", issue.path, issue.detail);
    }
    return { errors: collector.errors, warnings: collector.warnings };
  }
  if (seed.kind === "form-definition") {
    validateForm(seed, catalog, collector);
  } else {
    validateWorkflow(seed, catalog, collector);
  }
  return { errors: collector.errors, warnings: collector.warnings };
}
