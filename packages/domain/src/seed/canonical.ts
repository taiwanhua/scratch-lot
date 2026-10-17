/**
 * 定義種子的穩定正規化與兩種 hash 的來源字串。
 *
 * - `contentHash`:kind / key、受管 metadata 與 definition;不含 revision / changelog / desiredStatus。
 *   兩個環境的歷史版號不同,只要目標內容相同這個值就相同。
 * - `snapshotHash`:整份宣告;用來驗「同一個 revision 不可改內容」。
 *
 * 本套件不依賴 Node 或瀏覽器的 crypto:這裡只產生**正規化字串**,雜湊函式由上層注入
 * (`hashDefinitionSeed` 的 `sha256Hex`),所以各層算出的值只取決於同一份字串。
 *
 * 正規化規則:物件鍵依碼位排序、陣列順序保留、值為 `undefined` 的鍵視同缺席。
 * 缺席與空值只在既有契約明訂等價的位置收斂(`?: T | null` 的未設定、流程的 `edges` / `kind` /
 * `allowReturn`、lookup 來源的 `labelTemplate` / `valueField` / `completedOnly` 預設),其餘差異一律保留。
 */
import type {
  ArrayColumnDef,
  FieldDef,
  FieldOptions,
  FormDefinition,
  LookupSourceDescriptor,
  Prefill,
} from "../form/types";
import type { StepDef, WorkflowDefinition } from "../workflow/types";
import type { DefinitionSeedSet } from "./declaration";

/** 兩種 hash 共用的演算法與前綴;值的格式固定為 `sha256:<64 位小寫十六進位>`。 */
export const SEED_HASH_ALGORITHM = "sha256";
export const SEED_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** 上層注入的雜湊函式:UTF-8 字串 → SHA-256 的小寫十六進位(64 字)。 */
export type Sha256Hex = (text: string) => string;

export interface DefinitionSeedHashes {
  contentHash: string;
  snapshotHash: string;
}

/** 值不是純 JSON(函式、非有限數字、類別實例…)時丟出;`path` 指出位置。 */
export class SeedSerializationError extends Error {
  override name = "SeedSerializationError";

  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${path === "" ? "(root)" : path}:${detail}`);
  }
}

type PlainRecord = Record<string, unknown>;

export function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function joinSeedPath(base: string, segment: string | number): string {
  return base === "" ? String(segment) : `${base}.${String(segment)}`;
}

function compareKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** 純量:字串、布林、null、有限數字;其餘(undefined、函式、symbol、bigint、NaN…)不是純資料。 */
function assertPureScalar(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SeedSerializationError(path, "數字必須是有限值");
    }
    return;
  }
  throw new SeedSerializationError(
    path,
    `不是純 JSON 值(${value === undefined ? "undefined" : typeof value})`,
  );
}

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * 檢查容器的**每一個**自有屬性(含不可列舉與 symbol 鍵),過濾之前就看 descriptor,不執行任何 accessor:
 *
 * - getter / setter 一律拒絕(每次讀到的值可能不同,hash 與匯出就不是同一份內容)—— 不可列舉的也一樣,
 *   因為正規化會直接以屬性名讀值
 * - 不可列舉的資料屬性、symbol 鍵拒絕:列舉時看不到、直接讀又讀得到,兩種讀法結果不同
 * - 陣列只能有索引與 `length`:自有的 `map` 之類會蓋掉內建方法,讓輸出的內容被換掉
 */
function assertOwnPropertiesArePure(container: object, path: string): void {
  const isArray = Array.isArray(container);
  for (const key of Reflect.ownKeys(container)) {
    const at = joinSeedPath(path, String(key));
    if (typeof key === "symbol") {
      throw new SeedSerializationError(at, "不收 symbol 鍵,只收資料屬性");
    }
    if (isArray && key === "length") {
      continue;
    }
    if (isArray && !ARRAY_INDEX.test(key)) {
      throw new SeedSerializationError(
        at,
        "陣列只能有索引元素,不收其他自有屬性",
      );
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(container, key);
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
      throw new SeedSerializationError(at, "不收 getter / setter,只收資料屬性");
    }
    if (descriptor?.enumerable !== true) {
      throw new SeedSerializationError(at, "不收不可列舉的屬性");
    }
  }
}

/**
 * 逐一讀出容器的自有屬性值(先過 `assertOwnPropertiesArePure`,所以讀到的都是資料屬性)。
 * 陣列逐索引檢查,hole 不會被跳過。
 */
function pureEntriesOf(
  container: object,
  path: string,
): [string | number, unknown][] {
  assertOwnPropertiesArePure(container, path);
  const keys: (string | number)[] = Array.isArray(container)
    ? Array.from({ length: container.length }, (_, index) => index)
    : Object.keys(container);
  return keys.map((key) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(container, key);
    if (descriptor === undefined) {
      throw new SeedSerializationError(
        joinSeedPath(path, key),
        "陣列有空洞(hole),不是純 JSON 值",
      );
    }
    return [key, descriptor.value];
  });
}

function assertPureNode(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (typeof value !== "object" || value === null) {
    assertPureScalar(value, path);
    return;
  }
  const isPlainContainer = Array.isArray(value)
    ? Object.getPrototypeOf(value) === Array.prototype
    : isPlainRecord(value);
  if (!isPlainContainer) {
    // 陣列的原型被換掉也算:之後呼叫的就不是內建方法
    throw new SeedSerializationError(path, "不是純 JSON 值(類別實例)");
  }
  if (ancestors.has(value)) {
    throw new SeedSerializationError(path, "循環引用,不是純 JSON 值");
  }
  ancestors.add(value);
  for (const [key, item] of pureEntriesOf(value, path)) {
    // 物件裡值為 undefined 的鍵視同缺席;陣列元素不行
    if (item !== undefined || Array.isArray(value)) {
      assertPureNode(item, joinSeedPath(path, key), ancestors);
    }
  }
  // 只記「目前這條路徑上」的容器:同一個子物件被引用兩次(不成圈)是合法的
  ancestors.delete(value);
}

/**
 * 種子的純資料邊界:只收字串、有限數字、布林、null、陣列與純物件。
 * 類別實例、函式、accessor、陣列空洞、循環引用都丟 `SeedSerializationError` 並指出位置;
 * 正規化、hash 與匯出在讀任何值之前先過這一關,之後讀到的就是同一份資料。
 */
export function assertPureSeedData(value: unknown, path = ""): void {
  assertPureNode(value, path, new Set());
}

/** 已確認是純資料的值 → 排好鍵序的 JSON。 */
function renderCanonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => renderCanonical(item)).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .toSorted(compareKeys)
      .map((key) => `${JSON.stringify(key)}:${renderCanonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 排好鍵序的 JSON;只收純資料(見 `assertPureSeedData`),物件裡 `undefined` 的鍵略過。 */
export function canonicalJson(value: unknown): string {
  assertPureSeedData(value);
  return renderCanonical(value);
}

/** 拿掉值為 `null` / `undefined` 的指定鍵(契約明訂「未設定」的位置)。 */
function withoutUnset(
  record: PlainRecord,
  keys: readonly string[],
): PlainRecord {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) =>
        !(keys.includes(key) && (value === null || value === undefined)),
    ),
  );
}

/** lookup 來源:顯示模板缺席 / null / 空字串等價、`valueField` 預設 `id`、`completedOnly` 預設 true、空 filter = 沒有條件。 */
function normalizeLookupSource(source: LookupSourceDescriptor): PlainRecord {
  const result = withoutUnset({ ...source }, ["labelTemplate", "filter"]);
  if (result.labelTemplate === "") {
    delete result.labelTemplate;
  }
  if (result.valueField === "id") {
    delete result.valueField;
  }
  if (result.completedOnly === true) {
    delete result.completedOnly;
  }
  if (isPlainRecord(result.filter) && Object.keys(result.filter).length === 0) {
    delete result.filter;
  }
  return result;
}

function normalizeOptions(options: FieldOptions): unknown {
  return options.kind === "lookup" && isPlainRecord(options.source)
    ? { ...options, source: normalizeLookupSource(options.source) }
    : options;
}

/** 欄位與明細子欄共用:`?: T | null` 的未設定收斂成缺席。 */
const UNSET_FIELD_KEYS = [
  "options",
  "rules",
  "default",
  "permission",
  "help",
  "source",
  "prefill",
  "columns",
  "width",
  "visibleWhen",
  "readonlyWhen",
] as const;

function normalizeRules(rules: unknown): unknown {
  return isPlainRecord(rules) ? withoutUnset(rules, ["custom"]) : rules;
}

function normalizeField(field: FieldDef | ArrayColumnDef): PlainRecord {
  const result = withoutUnset({ ...field }, UNSET_FIELD_KEYS);
  if (isPlainRecord(result.options)) {
    result.options = normalizeOptions(result.options as FieldOptions);
  }
  if ("rules" in result) {
    result.rules = normalizeRules(result.rules);
  }
  if (isPlainRecord(result.source)) {
    result.source = normalizeLookupSource(
      result.source as unknown as LookupSourceDescriptor,
    );
  }
  if (Array.isArray(result.columns)) {
    result.columns = (result.columns as ArrayColumnDef[]).map((column) =>
      isPlainRecord(column) ? normalizeField(column) : column,
    );
  }
  return result;
}

function normalizePrefill(prefill: Prefill): unknown {
  return isPlainRecord(prefill) && isPlainRecord(prefill.source)
    ? { ...prefill, source: normalizeLookupSource(prefill.source) }
    : prefill;
}

function normalizeFormDefinition(definition: FormDefinition): unknown {
  if (!isPlainRecord(definition)) {
    return definition;
  }
  const result: PlainRecord = { ...definition };
  if (Array.isArray(definition.fields)) {
    result.fields = definition.fields.map((field) =>
      isPlainRecord(field) ? normalizeField(field) : field,
    );
  }
  if (isPlainRecord(definition.summaryMap)) {
    result.summaryMap = withoutUnset(definition.summaryMap, [
      "title",
      "date",
      "amount",
    ]);
  }
  if (Array.isArray(definition.prefills)) {
    result.prefills = definition.prefills.map((prefill) =>
      normalizePrefill(prefill),
    );
  }
  return result;
}

/** 關卡:`kind` 省略 = `review`;審核關卡的 `skipWhen` 未設定 = 缺席、`allowReturn` 省略 = true。 */
/** 省略、null 或空物件。 */
function isUnset(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isPlainRecord(value) && Object.keys(value).length === 0)
  );
}

function normalizeStep(step: StepDef): unknown {
  if (!isPlainRecord(step)) {
    return step;
  }
  const result: PlainRecord = { ...step };
  if (result.kind === undefined) {
    result.kind = "review";
  }
  if (result.kind !== "review") {
    return result;
  }
  if (result.skipWhen === null || result.skipWhen === undefined) {
    delete result.skipWhen;
  }
  // 指定組織跳過、自動通過:省略 / null / `{}` 都是「沒設」;自動通過的 `false` 與省略同義(照常審核)
  if (isUnset(result.skipOrgs)) {
    delete result.skipOrgs;
  }
  if (isPlainRecord(result.autoApprove)) {
    const kept = Object.fromEntries(
      Object.entries(result.autoApprove).filter(([, value]) => value !== false),
    );
    result.autoApprove = kept;
  }
  if (isUnset(result.autoApprove)) {
    delete result.autoApprove;
  }
  if (result.allowReturn === undefined) {
    result.allowReturn = true;
  }
  // 逾時提醒、知會:省略 / null 都是「沒設」
  if (result.overdue === null) {
    delete result.overdue;
  }
  if (result.cc === null) {
    delete result.cc;
  }
  return result;
}

/**
 * 流程:沒有 `edges`、`null` 與空陣列都是直線。只收斂這三種明訂等價的寫法;
 * 其他值(例如誤寫成物件)原樣留著,不會在驗證之前悄悄變成「沒有連線」。
 */
function normalizeWorkflowDefinition(definition: WorkflowDefinition): unknown {
  if (!isPlainRecord(definition)) {
    return definition;
  }
  const result: PlainRecord = { ...definition };
  if (Array.isArray(definition.steps)) {
    result.steps = definition.steps.map((step) => normalizeStep(step));
  }
  const { edges } = result;
  if (
    edges === undefined ||
    edges === null ||
    (Array.isArray(edges) && edges.length === 0)
  ) {
    delete result.edges;
  }
  // 整個流程的知會:省略 / null 都是「沒設」
  if (result.cc === null) {
    delete result.cc;
  }
  return result;
}

function normalizedDefinitionOf(seed: DefinitionSeedSet): unknown {
  return seed.kind === "form-definition"
    ? normalizeFormDefinition(seed.definition)
    : normalizeWorkflowDefinition(seed.definition);
}

/** 受管 metadata:顯示名與各種類自己的那幾欄(與 `DefinitionSeedSet` 的型別一一對應)。 */
function managedMetadataOf(seed: DefinitionSeedSet): PlainRecord {
  return seed.kind === "form-definition"
    ? {
        name: seed.name,
        moduleKey: seed.moduleKey,
        tabLabelTemplate: seed.tabLabelTemplate,
        // 允許存草稿:只有關掉才進 hash(缺席 = 開,開著的宣告與這個欄位出現之前的 hash 相同)
        ...(seed.allowDraft === false ? { allowDraft: false } : {}),
      }
    : { name: seed.name, checkFormKey: seed.checkFormKey };
}

/** `contentHash` 的來源字串。 */
export function definitionContentCanonical(seed: DefinitionSeedSet): string {
  assertPureSeedData(seed);
  return canonicalJson({
    kind: seed.kind,
    key: seed.key,
    ...managedMetadataOf(seed),
    definition: normalizedDefinitionOf(seed),
  });
}

/** `snapshotHash` 的來源字串(整份宣告)。 */
export function definitionSnapshotCanonical(seed: DefinitionSeedSet): string {
  assertPureSeedData(seed);
  return canonicalJson({
    kind: seed.kind,
    key: seed.key,
    revision: seed.revision,
    changelog: seed.changelog,
    desiredStatus: seed.desiredStatus,
    ...managedMetadataOf(seed),
    definition: normalizedDefinitionOf(seed),
  });
}

function prefixedHash(text: string, sha256Hex: Sha256Hex): string {
  const hash = `${SEED_HASH_ALGORITHM}:${sha256Hex(text)}`;
  if (!SEED_HASH_PATTERN.test(hash)) {
    throw new TypeError(
      "sha256Hex 必須回傳 64 位小寫十六進位字串(SHA-256 of UTF-8)",
    );
  }
  return hash;
}

/** 一份定義宣告的兩個 hash;`sha256Hex` 由上層提供(Node:`createHash("sha256")`)。 */
export function hashDefinitionSeed(
  seed: DefinitionSeedSet,
  sha256Hex: Sha256Hex,
): DefinitionSeedHashes {
  return {
    contentHash: prefixedHash(definitionContentCanonical(seed), sha256Hex),
    snapshotHash: prefixedHash(definitionSnapshotCanonical(seed), sha256Hex),
  };
}
