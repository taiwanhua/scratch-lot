import { arrayColumnsOf } from "./array";
import type { DefinitionIssueLocation, IssueCollector } from "./issues";
import { isFilterVarCompatible, isLookupFilterVar } from "./lookup-filter";
import type { LookupProviderRegistry, LookupProviderSpec } from "./registry";
import type {
  ArrayColumnDef,
  FieldDef,
  FormDefinition,
  LookupSourceDescriptor,
} from "./types";

/**
 * 檢查器的連動篩選段:`filter` 值是 `{ var: "<欄位 key>" }` 的條件。
 *
 * - 只有引用欄位(表單層引用欄、明細引用子欄)能用;選項來源、帶入規則 → `LOOKUP_FILTER_VAR_INVALID`
 * - `var` 要是表單層欄位的 key(不能是自己、明細欄;明細子欄不能引用同一列的其他子欄)→ 否則 `LOOKUP_FILTER_VAR_INVALID`
 * - 篩選欄位要是 provider 可當 `filter` 的欄位 → 否則 `LOOKUP_FILTER_VAR_INVALID`(登錄表沒給篩選欄位就不驗)
 * - 被引用欄位的型別要能當篩選值、且與篩選欄位相符(`isFilterVarCompatible`)→ 否則 `LOOKUP_FILTER_VAR_TYPE`
 * - 引用欄「來源提供的預設」的條件(`default.filter`)同一套規則;條件只能是連動條件(固定條件寫在來源的
 *   `filter`)→ 否則 `LOOKUP_FILTER_VAR_INVALID`
 */
export function validateLookupFilters(
  definition: FormDefinition,
  providers: LookupProviderRegistry | undefined,
  collector: IssueCollector,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  for (const field of definition.fields) {
    if (field.options?.kind === "lookup") {
      rejectVars(field.options.source, collector, {
        fieldKey: field.key,
        property: "options.source",
      });
    }
    if (field.type === "reference" && field.source) {
      checkVars(field.source, providers, byKey, collector, {
        owner: field.key,
        siblings: [],
        location: { fieldKey: field.key, property: "source" },
      });
      checkProviderDefault(field, field.source, providers, byKey, collector);
    }
    if (field.type === "array") {
      for (const column of arrayColumnsOf(field)) {
        checkColumnVars(field, column, providers, byKey, collector);
      }
    }
  }
  for (const [prefillIndex, prefill] of definition.prefills.entries()) {
    rejectVars(prefill.source, collector, {
      prefillIndex,
      property: "source",
    });
  }
}

/** 來源提供的預設的條件:只收連動條件,每個條件照連動篩選的規則驗。 */
function checkProviderDefault(
  field: FieldDef,
  source: LookupSourceDescriptor,
  providers: LookupProviderRegistry | undefined,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  if (field.default?.kind !== "provider") {
    return;
  }
  const filter: unknown = field.default.filter;
  if (filter === undefined) {
    return;
  }
  const location = { fieldKey: field.key, property: "default" };
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    collector.error(
      "LOOKUP_FILTER_VAR_INVALID",
      `「${field.label}」的預設值條件必須是物件`,
      { ...location, property: "default.filter" },
    );
    return;
  }
  for (const [key, value] of Object.entries(filter)) {
    if (!isLookupFilterVar(value)) {
      collector.error(
        "LOOKUP_FILTER_VAR_INVALID",
        `「${field.label}」的預設值條件 ${key} 只能引用欄位(固定條件寫在來源的篩選條件)`,
        { ...location, property: `default.filter.${key}` },
      );
    }
  }
  checkVars(
    { ...source, filter: filter as Record<string, unknown> },
    providers,
    byKey,
    collector,
    { owner: field.key, siblings: [], location },
  );
}

function checkColumnVars(
  field: FieldDef,
  column: ArrayColumnDef,
  providers: LookupProviderRegistry | undefined,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
): void {
  if (column.type !== "reference" || !column.source) {
    return;
  }
  checkVars(column.source, providers, byKey, collector, {
    owner: field.key,
    siblings: arrayColumnsOf(field).map((candidate) => candidate.key),
    location: {
      fieldKey: field.key,
      columnKey: column.key,
      property: "source",
    },
  });
}

/** 選項來源、帶入規則不能用連動篩選(送出時沒有重驗的地方,只有引用欄位會)。 */
function rejectVars(
  source: LookupSourceDescriptor | undefined,
  collector: IssueCollector,
  location: DefinitionIssueLocation,
): void {
  for (const [key, value] of Object.entries(source?.filter ?? {})) {
    if (isLookupFilterVar(value)) {
      collector.error(
        "LOOKUP_FILTER_VAR_INVALID",
        `篩選條件 ${key} 不能引用欄位:只有引用欄位能用連動篩選`,
        { ...location, property: `${String(location.property)}.filter.${key}` },
      );
    }
  }
}

interface VarScope {
  /** 擁有這個來源的表單層欄位 key(引用欄自己、或明細欄):不能引用 */
  owner: string;
  /** 同一明細的子欄 key(明細子欄不能引用同一列的其他子欄) */
  siblings: readonly string[];
  location: DefinitionIssueLocation;
}

function checkVars(
  source: LookupSourceDescriptor,
  providers: LookupProviderRegistry | undefined,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
  scope: VarScope,
): void {
  const filterFields = providers?.[source.provider]?.filterFields;
  for (const [key, value] of Object.entries(source.filter ?? {})) {
    if (isLookupFilterVar(value)) {
      checkVar(
        { provider: source.provider, key, target: value.var, filterFields },
        byKey,
        collector,
        scope,
      );
    }
  }
}

interface VarCondition {
  provider: string;
  /** `filter` 的鍵(provider 的篩選欄位) */
  key: string;
  /** `{ var }` 的值(要是欄位 key) */
  target: unknown;
  filterFields: LookupProviderSpec["filterFields"];
}

/** 一個 `{ var }` 條件:篩選鍵、被引用欄位、型別依序驗,報第一個錯。 */
function checkVar(
  condition: VarCondition,
  byKey: ReadonlyMap<string, FieldDef>,
  collector: IssueCollector,
  scope: VarScope,
): void {
  const { key, filterFields } = condition;
  const location = {
    ...scope.location,
    property: `${String(scope.location.property)}.filter.${key}`,
  };
  if (filterFields !== undefined && !Object.hasOwn(filterFields, key)) {
    collector.error(
      "LOOKUP_FILTER_VAR_INVALID",
      `lookup 來源 ${condition.provider} 不能以 ${key} 篩選`,
      location,
    );
    return;
  }
  const target = typeof condition.target === "string" ? condition.target : null;
  const referenced = target === null ? undefined : byKey.get(target);
  if (
    referenced === undefined ||
    referenced.type === "array" ||
    target === scope.owner
  ) {
    const isSibling = target !== null && scope.siblings.includes(target);
    collector.error(
      "LOOKUP_FILTER_VAR_INVALID",
      isSibling
        ? `篩選條件 ${key} 不能引用同一列的子欄位 ${target}(只能引用表單層欄位)`
        : `篩選條件 ${key} 引用的欄位 ${String(target)} 不存在或不能引用`,
      location,
    );
    return;
  }
  const filterType = filterFields?.[key];
  if (!isFilterVarCompatible(filterType, referenced.type)) {
    const typeNote = filterType ? `(${filterType})` : "";
    collector.error(
      "LOOKUP_FILTER_VAR_TYPE",
      `篩選條件 ${key}${typeNote}不能引用 ${referenced.type} 欄位「${referenced.label}」`,
      location,
    );
  }
}
