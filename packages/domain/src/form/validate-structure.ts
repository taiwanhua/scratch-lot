import { type FieldProtection, isProtected } from "./dependencies";
import type { DefinitionIssueLocation, IssueCollector } from "./issues";
import { LAYOUT_COLUMNS } from "./layout";
import type { LookupProviderRegistry, LookupProviderSpec } from "./registry";
import type {
  FieldDef,
  FormDefinition,
  LayoutCol,
  LayoutSection,
  PrefillMapping,
  SummarySlot,
} from "./types";
import { isPrefillCompatible, validateLookupSource } from "./validate-fields";

/**
 * 檢查器的結構段(Spec §5「定義檢查器」):版面、摘要槽、帶入,以及警告清單。
 */

export function validateLayout(
  definition: FormDefinition,
  collector: IssueCollector,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  const placed = new Map<string, string>();
  const sectionKeys = new Set<string>();
  for (const [sectionIndex, section] of definition.layout.sections.entries()) {
    const sectionPath = `sections.${String(sectionIndex)}`;
    if (sectionKeys.has(section.key)) {
      collector.error(
        "LAYOUT_SECTION_DUPLICATE",
        `分區 key ${section.key} 重複`,
        {
          layoutPath: sectionPath,
        },
      );
    }
    sectionKeys.add(section.key);
    const cols = section.rows.flatMap((row, rowIndex) =>
      row.cols.map((col, colIndex) => ({
        col,
        path: `${sectionPath}.rows.${String(rowIndex)}.cols.${String(colIndex)}`,
      })),
    );
    if (cols.length === 0) {
      collector.warn("SECTION_EMPTY", `分區「${section.title}」沒有任何欄位`, {
        layoutPath: sectionPath,
      });
    }
    for (const { col, path } of cols) {
      checkLayoutCol(col, path, byKey, placed, collector);
    }
    checkSectionCollapse(
      section,
      cols.map(({ col }) => col.fieldKey),
      byKey,
      sectionPath,
      collector,
    );
  }
  for (const field of definition.fields) {
    if (field.valueSource.kind !== "constant" && !placed.has(field.key)) {
      collector.error(
        "LAYOUT_MISSING_FIELD",
        `欄位「${field.label}」沒有放進版面`,
        {
          fieldKey: field.key,
        },
      );
    }
  }
}

/**
 * 分區的收合設定(選填,沒有 = 不可收合):`collapsible` / `defaultCollapsed` 要是布林、`summaryFieldKeys` 要是字串陣列;
 * 收合時標題列顯示的欄位須放在**本分區**、不能是明細欄(標題列只放得下單值)、不能重複。
 */
function checkSectionCollapse(
  section: LayoutSection,
  sectionFieldKeys: readonly string[],
  byKey: ReadonlyMap<string, FieldDef>,
  sectionPath: string,
  collector: IssueCollector,
): void {
  const { collapsible, defaultCollapsed, summaryFieldKeys } = section as {
    collapsible?: unknown;
    defaultCollapsed?: unknown;
    summaryFieldKeys?: unknown;
  };
  for (const [property, value] of [
    ["collapsible", collapsible],
    ["defaultCollapsed", defaultCollapsed],
  ] as const) {
    if (value !== undefined && typeof value !== "boolean") {
      collector.error(
        "SECTION_COLLAPSE_INVALID",
        `分區「${section.title}」的 ${property} 須為布林值`,
        { layoutPath: sectionPath, property },
      );
    }
  }
  if (summaryFieldKeys === undefined) {
    return;
  }
  if (
    !Array.isArray(summaryFieldKeys) ||
    !summaryFieldKeys.every((key) => typeof key === "string")
  ) {
    collector.error(
      "SECTION_COLLAPSE_INVALID",
      `分區「${section.title}」的 summaryFieldKeys 須為欄位 key 陣列`,
      { layoutPath: sectionPath, property: "summaryFieldKeys" },
    );
    return;
  }
  const inSection = new Set(sectionFieldKeys);
  const seen = new Set<string>();
  for (const [index, key] of summaryFieldKeys.entries()) {
    const location = {
      layoutPath: sectionPath,
      fieldKey: key,
      property: `summaryFieldKeys.${String(index)}`,
    };
    if (seen.has(key)) {
      collector.error(
        "SECTION_SUMMARY_FIELD_INVALID",
        `分區「${section.title}」收合時顯示的欄位 ${key} 重複`,
        location,
      );
    } else if (!inSection.has(key) || !byKey.has(key)) {
      collector.error(
        "SECTION_SUMMARY_FIELD_INVALID",
        `分區「${section.title}」收合時顯示的欄位 ${key} 不在這個分區`,
        location,
      );
    } else if (byKey.get(key)?.type === "array") {
      collector.error(
        "SECTION_SUMMARY_FIELD_INVALID",
        `分區「${section.title}」收合時不能顯示明細欄 ${key}`,
        location,
      );
    }
    seen.add(key);
  }
}

function checkLayoutCol(
  col: LayoutCol,
  path: string,
  byKey: ReadonlyMap<string, FieldDef>,
  placed: Map<string, string>,
  collector: IssueCollector,
): void {
  const location = { fieldKey: col.fieldKey, layoutPath: path };
  if (
    !Number.isInteger(col.span) ||
    col.span < 1 ||
    col.span > LAYOUT_COLUMNS
  ) {
    collector.error(
      "LAYOUT_SPAN_INVALID",
      `寬度須為 1–${String(LAYOUT_COLUMNS)} 格`,
      location,
    );
  }
  if (
    byKey.get(col.fieldKey)?.type === "array" &&
    col.span !== LAYOUT_COLUMNS
  ) {
    collector.error(
      "ARRAY_SPAN",
      `明細欄固定占滿 ${String(LAYOUT_COLUMNS)} 格`,
      location,
    );
  }
  if (!byKey.has(col.fieldKey)) {
    collector.error(
      "LAYOUT_UNKNOWN_FIELD",
      `版面放了不存在的欄位 ${col.fieldKey}`,
      location,
    );
    return;
  }
  if (placed.has(col.fieldKey)) {
    collector.error(
      "LAYOUT_DUPLICATE_FIELD",
      `欄位 ${col.fieldKey} 在版面出現兩次`,
      location,
    );
  }
  placed.set(col.fieldKey, path);
}

/** 摘要槽可對的欄位型別:`title` 只能文字或靜態選項;`date` 只能日期或日期時間;`amount` 只能數字。 */
function isSummaryCompatible(slot: SummarySlot, field: FieldDef): boolean {
  switch (slot) {
    case "title": {
      return (
        field.type === "text" ||
        (field.type === "select" && field.options?.kind === "static")
      );
    }
    case "date": {
      return field.type === "date" || field.type === "datetime";
    }
    case "amount": {
      return field.type === "number";
    }
  }
}

export function validateSummary(
  definition: FormDefinition,
  protections: ReadonlyMap<string, FieldProtection>,
  collector: IssueCollector,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  const slots: SummarySlot[] = ["title", "date", "amount"];
  for (const slot of slots) {
    const key = definition.summaryMap[slot];
    const location = { summarySlot: slot };
    if (!key) {
      // `date` 不對 = 用送出時間,`amount` 選填;只有 `title` 必對
      if (slot === "title") {
        collector.error(
          "SUMMARY_UNMAPPED",
          "摘要槽「標題」沒有對到欄位",
          location,
        );
      }
      continue;
    }
    const field = byKey.get(key);
    if (!field) {
      collector.error(
        "SUMMARY_UNMAPPED",
        `摘要槽 ${slot} 對到不存在的欄位 ${key}`,
        location,
      );
      continue;
    }
    checkSummaryField(slot, field, protections, collector);
  }
}

/** 摘要槽對到的欄位:不能是明細欄、受保護欄位,型別要合;計算欄位有顯示條件給警告。 */
function checkSummaryField(
  slot: SummarySlot,
  field: FieldDef,
  protections: ReadonlyMap<string, FieldProtection>,
  collector: IssueCollector,
): void {
  const key = field.key;
  const fieldLocation = { summarySlot: slot, fieldKey: key };
  if (field.type === "array") {
    collector.error(
      "ARRAY_NOT_ALLOWED",
      `摘要槽 ${slot} 不能對明細欄「${field.label}」(可改對彙總出來的計算欄位)`,
      fieldLocation,
    );
    return;
  }
  if (isProtected(protections.get(key))) {
    collector.error(
      "SUMMARY_PROTECTED",
      `摘要槽 ${slot} 不可對受保護欄位「${field.label}」`,
      fieldLocation,
    );
  }
  if (!isSummaryCompatible(slot, field)) {
    collector.error(
      "SUMMARY_TYPE",
      `摘要槽 ${slot} 不能對 ${field.type} 型別的欄位「${field.label}」`,
      fieldLocation,
    );
  }
  if (
    field.valueSource.kind === "computed" &&
    hasCondition(field.visibleWhen)
  ) {
    collector.warn(
      "COMPUTED_HIDDEN",
      `摘要槽對到的計算欄位「${field.label}」有顯示條件,隱藏時會算成空值`,
      fieldLocation,
    );
  }
}

function hasCondition(expr: unknown): boolean {
  return expr !== undefined && expr !== null;
}

export function validatePrefills(
  definition: FormDefinition,
  providers: LookupProviderRegistry | undefined,
  collector: IssueCollector,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  for (const [prefillIndex, prefill] of definition.prefills.entries()) {
    validateLookupSource(prefill.source, providers, collector, {
      prefillIndex,
      property: "source",
    });
    const provider = providers?.[prefill.source.provider];
    for (const [mappingIndex, mapping] of prefill.mapping.entries()) {
      checkPrefillMapping(
        mapping,
        byKey.get(mapping.fieldKey),
        provider,
        {
          prefillIndex,
          fieldKey: mapping.fieldKey,
          property: `mapping.${String(mappingIndex)}`,
        },
        collector,
      );
    }
  }
}

function checkPrefillMapping(
  mapping: PrefillMapping,
  target: FieldDef | undefined,
  provider: LookupProviderSpec | undefined,
  location: DefinitionIssueLocation,
  collector: IssueCollector,
): void {
  if (target?.type === "array") {
    collector.error(
      "ARRAY_NOT_ALLOWED",
      `帶入目標 ${mapping.fieldKey} 是明細欄,不能帶入`,
      location,
    );
    return;
  }
  checkPrefillEntry(
    mapping,
    target,
    provider,
    {
      location,
      targetMessage: `帶入目標 ${mapping.fieldKey} 必須是使用者填寫的欄位(不能是計算、固定值或引用欄位)`,
    },
    collector,
  );
}

/**
 * 帶入對應表的一列(表單層帶入規則與明細引用子欄的列內帶入共用,STRUCT-13):目標要是使用者填、不是引用的
 * 欄位 / 子欄(找不到也算)→ `PREFILL_TARGET_NOT_INPUT`;來源欄位要在 provider 可回欄位內
 * → `PREFILL_UNKNOWN_SOURCE_FIELD`;型別要相容(`isPrefillCompatible`)→ `PREFILL_TYPE_INCOMPATIBLE`。
 * 沒注入登錄表就只驗目標。目標不合時表單層仍接著驗來源,子欄(`stopOnBadTarget`)報一個就停。
 */
export function checkPrefillEntry(
  mapping: PrefillMapping,
  target: Pick<FieldDef, "type" | "label" | "valueSource"> | undefined,
  provider: LookupProviderSpec | undefined,
  options: {
    location: DefinitionIssueLocation;
    targetMessage: string;
    stopOnBadTarget?: boolean;
  },
  collector: IssueCollector,
): void {
  const { location } = options;
  if (target?.valueSource.kind !== "input" || target.type === "reference") {
    collector.error(
      "PREFILL_TARGET_NOT_INPUT",
      options.targetMessage,
      location,
    );
    if (options.stopOnBadTarget === true) {
      return;
    }
  }
  if (!provider) {
    return;
  }
  const sourceType = provider.fields[mapping.sourceField];
  if (sourceType === undefined) {
    collector.error(
      "PREFILL_UNKNOWN_SOURCE_FIELD",
      `來源沒有欄位 ${mapping.sourceField}`,
      location,
    );
    return;
  }
  if (target && !isPrefillCompatible(sourceType, target.type)) {
    collector.error(
      "PREFILL_TYPE_INCOMPATIBLE",
      `來源欄位 ${mapping.sourceField}(${sourceType})不能帶入 ${target.type} 欄位「${target.label}」`,
      location,
    );
  }
}

/** 其餘警告:受保護 + 必填、必填計算欄位有顯示條件、列表欄位配置引用這版沒有的欄位。 */
export function collectFieldWarnings(
  definition: FormDefinition,
  listColumnFieldKeys: readonly string[] | undefined,
  collector: IssueCollector,
): void {
  const summaryKeys = new Set(Object.values(definition.summaryMap));
  for (const field of definition.fields) {
    const isRequired = field.rules?.required === true;
    if (isRequired && field.permission?.show === true) {
      collector.warn(
        "PROTECTED_REQUIRED",
        `受保護欄位「${field.label}」設了必填:沒有編輯資格的人可留空送出`,
        { fieldKey: field.key },
      );
    }
    if (
      isRequired &&
      !summaryKeys.has(field.key) &&
      field.valueSource.kind === "computed" &&
      hasCondition(field.visibleWhen)
    ) {
      collector.warn(
        "COMPUTED_HIDDEN",
        `必填的計算欄位「${field.label}」有顯示條件,隱藏時會算成空值`,
        { fieldKey: field.key },
      );
    }
  }
  collectListColumnWarnings(definition, listColumnFieldKeys, collector);
}

function collectListColumnWarnings(
  definition: FormDefinition,
  listColumnFieldKeys: readonly string[] | undefined,
  collector: IssueCollector,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  for (const key of listColumnFieldKeys ?? []) {
    if (byKey.get(key)?.type === "array") {
      collector.warn(
        "LIST_COLUMN_ARRAY",
        `列表欄位配置引用了明細欄 ${key},列表不顯示明細(請 root 在模組管理調整)`,
        { fieldKey: key },
      );
    }
    if (!byKey.has(key)) {
      collector.warn(
        "LIST_COLUMN_MISSING",
        `列表欄位配置引用了這一版沒有的欄位 ${key}(請 root 在模組管理調整)`,
        { fieldKey: key },
      );
    }
  }
}
