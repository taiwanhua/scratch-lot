/**
 * 種子宣告的型別(正本:ADR-0002)。純契約,不碰資料庫:db-migrator 的執行器、api 的發布適配
 * 與匯出、admin 的匯出面板都吃同一份。
 *
 * 種子資料以穩定 kebab-case `key` 在各環境冪等 upsert;id 各環境各自生成。
 * 宣告只描述「要同步的欄位」— `key`、`isSystem`、時間戳由 runner 補上。
 */
import type { FormDefinition } from "../form/types";
import type { WorkflowDefinition } from "../workflow/types";

/** 一筆以 key 識別的種子文件:`data` 是要同步到資料庫的欄位。 */
export interface SeedDocument {
  key: string;
  data: Record<string, unknown>;
}

/** 同一 collection 的一組種子文件(每模組/每類一檔)。 */
export interface SeedDocumentSet {
  kind: "documents";
  collection: string;
  /**
   * 存放 `entry.key` 的欄位名,預設 `key`。schema 以別的欄位當識別鍵時指定
   * (如 data_scope_targets 以 `collection` unique),避免多掛一個 schema 沒有的欄位。
   * 注意:seedRef 只以 `key` 欄位解析,改用其他欄位的 set 不可被引用。
   */
  keyField?: string;
  /**
   * 「初始 seed 值的欄位」:建立時寫入宣告值,之後**有值就永不覆寫**(由人在系統內管理,如 enabled 開關)。
   * 唯一例外:既有文件上**這一欄根本不存在**時補寫初值 — 讓「新增一個初始值欄位」能在已種過的環境落地
   * (如 `modules.icon`);清成 `null` 也算有值,不會被翻回宣告值。
   * 其餘欄位為「每次都 seed 的欄位」,每次同步回宣告值。未指定時採 runner 預設(`["enabled"]`)。
   */
  initialSeedValueFields?: string[];
  /**
   * 額外的比對條件:runner 找既有文件時用 `{ [keyField]: key, ...match }`。
   * 用途是讓 seed 只碰「自己管的那一類」文件(`permissions` 以此排除 `source: "dynamic"`);
   * 同 key 但不符 `match` 的文件不會被更新,insert 會被唯一索引擋下 —— 寧可 seed 失敗也不覆寫。
   */
  match?: Record<string, unknown>;
  /**
   * 認養(ADR-0002「seed 以 key 認養」):以識別鍵找不到既有文件時,改用「宣告裡的這幾個欄位(解析 seedRef 後)
   * + `where`」找**人在畫面建的同一筆**;找到就把它轉成種子(寫上識別鍵、`isSystem: true`、
   * 其餘宣告欄位以 seed 為準),`_id` 不動 —— 引用它的資料照舊。
   * 用途是識別鍵不是人建時就有的那一類(`fields` 的種子 key 是 `<類別 key>.<value>`,畫面建的選項沒有 key)。
   * 以識別鍵找到、但 `isSystem` 不是 `true` 的文件一律視為認養,不需要本欄位。
   */
  adoptBy?: SeedAdoptBy;
  entries: SeedDocument[];
}

/** `SeedDocumentSet.adoptBy`:`where` 的頂層值可以是 seedRef(執行時解析成該環境的 `_id`)。 */
export interface SeedAdoptBy {
  fields: string[];
  where: Record<string, unknown>;
}

/** 所有 documents 種子表的預設「初始 seed 值的欄位」:enabled 開關 seed 只給初值,之後由人管理。 */
export const DEFAULT_INITIAL_SEED_VALUE_FIELDS: readonly string[] = ["enabled"];

/**
 * root 初始超級管理員帳號(ADR-0002):account/email/密碼自環境變數讀取,
 * 僅在帳號不存在時建立(加入 orgKey 組織 + 授予 roleKey 角色);已存在則完全不動。
 */
export interface SeedRootAdminSet {
  kind: "root-admin";
  orgKey: string;
  roleKey: string;
}

/** 以(collection, key)指向另一筆種子文件;執行時解析成該環境的 _id。 */
export interface SeedKeyReference {
  collection: string;
  key: string;
}

/**
 * 種子文件 `data` 中「指向另一筆種子文件」的欄位值(如 fields.categoryId → field_categories):
 * 宣告時寫 (collection, key),runner 執行時解析成該環境的 _id 再寫入
 * (只支援頂層欄位;頂層欄位為陣列時逐元素解析,如 modules.ancestors)。
 */
export interface SeedIdReference {
  $seedRef: SeedKeyReference;
}

export function seedRef(collection: string, key: string): SeedIdReference {
  return { $seedRef: { collection, key } };
}

export function isSeedIdReference(value: unknown): value is SeedIdReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "$seedRef" in value &&
    typeof value.$seedRef === "object"
  );
}

/**
 * 種子之間的核心關聯(ADR-0001;命名順序 Org > User > Role > Module > Permission):
 * 以 (type, firstId, secondId) 冪等,不存在才寫入。
 */
export interface SeedRelation {
  type: string;
  first: SeedKeyReference;
  second: SeedKeyReference;
}

export interface SeedRelationSet {
  kind: "relations";
  entries: SeedRelation[];
}

/** 版本化定義的目標狀態:`retired` 仍保留同一份完整定義(明示退役,與「移除宣告」是兩件事)。 */
export const DEFINITION_DESIRED_STATUSES = ["published", "retired"] as const;

export type DefinitionDesiredStatus =
  (typeof DEFINITION_DESIRED_STATUSES)[number];

/** 兩種版本化定義共用的欄位;一份宣告 = 一個明確內容版本。 */
interface DefinitionSeedBase {
  /** 表單 / 流程 key(底線格式,`@repo/domain/form` 的 `FORM_KEY_PATTERN`),不套一般 seed 的 kebab-case。 */
  key: string;
  /**
   * 專案內該 key 的不變發布識別字串(`DEFINITION_REVISION_PATTERN`):不是來源資料庫的版號,也不是 Git tag。
   * 內容或目標狀態修正要換新的 revision,同一個 revision 不得改內容。
   */
  revision: string;
  name: string;
  /** 發布說明。 */
  changelog: string;
  desiredStatus: DefinitionDesiredStatus;
}

/** 共用表單的一個內容版本(`ownerOrgId = null`);業務內容照既有 `FormDefinition`。 */
export interface FormDefinitionSeedSet extends DefinitionSeedBase {
  kind: "form-definition";
  /** 掛在哪個表單模組(`modules.engine = "form"`)。 */
  moduleKey: string;
  /** 頁籤 / 標題模板;必填,`null` = 清空(用模組層模板)。 */
  tabLabelTemplate: string | null;
  /**
   * 表單設定「允許存草稿」;缺席 = 開。只有要關掉時才寫 `allowDraft: false`
   * (開著的宣告不寫這個鍵,`contentHash` 也不含它,既有宣告的 hash 不變)。
   */
  allowDraft?: boolean;
  definition: FormDefinition;
}

/** 共用流程的一個內容版本(`ownerOrgId = null`、`tenantId = null`);業務內容照既有 `WorkflowDefinition`。 */
export interface WorkflowDefinitionSeedSet extends DefinitionSeedBase {
  kind: "workflow-definition";
  /** 檢查用表單 key;必填,`null` = 清空。 */
  checkFormKey: string | null;
  definition: WorkflowDefinition;
}

/** 版本化定義的種子(經 api 的發布適配安裝,不走一般 documents upsert)。 */
export type DefinitionSeedSet =
  FormDefinitionSeedSet | WorkflowDefinitionSeedSet;

export const DEFINITION_SEED_KINDS = [
  "form-definition",
  "workflow-definition",
] as const satisfies readonly DefinitionSeedSet["kind"][];

export type DefinitionSeedKind = (typeof DEFINITION_SEED_KINDS)[number];

/** revision 的格式:小寫英數開頭,後接小寫英數 / 底線 / 連字號,最長 64。 */
export const DEFINITION_REVISION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidDefinitionRevision(revision: string): boolean {
  return DEFINITION_REVISION_PATTERN.test(revision);
}

export function isDefinitionSeedSet(set: SeedSet): set is DefinitionSeedSet {
  return (DEFINITION_SEED_KINDS as readonly string[]).includes(set.kind);
}

/** 跨環境識別一份定義宣告的 `(kind, key, revision)`。 */
export function definitionSeedId(
  seed: Pick<DefinitionSeedSet, "kind" | "key" | "revision">,
): string {
  return `${seed.kind}:${seed.key}@${seed.revision}`;
}

/** 匯出檔名固定為 `<key>.<revision>.seed.ts`。 */
export function definitionSeedFileName(
  seed: Pick<DefinitionSeedSet, "key" | "revision">,
): string {
  return `${seed.key}.${seed.revision}.seed.ts`;
}

export type SeedSet =
  SeedDocumentSet | SeedRelationSet | SeedRootAdminSet | DefinitionSeedSet;

/** registry 收齊所有種子;依序執行(被引用者在前)。 */
export type SeedRegistry = SeedSet[];
