/**
 * 種子的組裝檢查與執行順序(正本:ADR-0002)。純函式、不碰資料庫:**任何寫入之前**先把整份 registry 驗完。
 *
 * - documents:同一個 collection 的識別鍵欄位、`match`、初始值欄位與認養政策要一致;同一個 key 不能宣告兩次
 *   (不靠後載入的覆蓋前面的)。完全相同的 relation 去重(不增加撤銷語意)。root 初始帳號只允許一份
 * - 引用:seedRef(頂層欄位與頂層陣列)、relation 的兩端、root 初始帳號的組織與角色都要對得到已宣告的種子文件;
 *   巢狀位置的 seedRef 執行器不解析,直接報錯
 * - 順序:以**條目**為單位依引用排序(被引用者在前),不是只排整個 set;循環指出路徑
 * - 版本化定義(表單 / 流程)不走一般 documents:相關 collection 不收 raw 文件;定義宣告驗形狀、可攜性與依賴,
 *   排在全部普通種子之後、彼此依引用排序
 * - 由模組宣告推導的內容(modules / permissions / data_scope_targets / 租戶管理員模板)只能來自推導
 */
import { isDeepStrictEqual } from "node:util";

import type { FormDefinition } from "@repo/domain/form";
import {
  type PortableCatalog,
  type PortableLookupProvider,
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  SEED_UPDATE_RUNS_COLLECTION,
  definitionSeedId,
  validatePortableDefinition,
} from "@repo/domain/seed";

import {
  DEFAULT_INITIAL_SEED_VALUE_FIELDS,
  type DefinitionSeedSet,
  type SeedDocument,
  type SeedDocumentSet,
  type SeedKeyReference,
  type SeedRegistry,
  type SeedRelation,
  type SeedRelationSet,
  type SeedSet,
  isSeedIdReference,
} from "./seed-declaration";
import {
  DATA_SCOPE_TARGETS_COLLECTION,
  MODULES_COLLECTION,
  PERMISSIONS_COLLECTION,
} from "./seed-key-convention";

/** 一個來源的種子;`origin` 用在錯誤訊息裡指出是哪一方(`base`、`project`、模組推導…)。 */
export interface SeedOriginSource {
  origin: string;
  seeds: readonly SeedSet[];
  /** 由模組宣告推導出來的那一份(只有它能宣告推導類的 collection 與模板綁定)。 */
  isDerived?: boolean;
}

/** 組裝檢查沒過;`problems` 逐項列出,訊息帶來源與 key。此時還沒有任何寫入。 */
export class SeedCompositionError extends Error {
  override name = "SeedCompositionError";

  constructor(readonly problems: readonly string[]) {
    super(`種子組裝檢查未通過(尚未寫入任何資料):\n- ${problems.join("\n- ")}`);
  }
}

const DEFAULT_KEY_FIELD = "key";
const FIELD_CATEGORIES_COLLECTION = "field_categories";
const FIELDS_COLLECTION = "fields";

/** 只能由模組宣告推導的 collection。 */
const DERIVED_COLLECTIONS: ReadonlySet<string> = new Set([
  MODULES_COLLECTION,
  PERMISSIONS_COLLECTION,
  DATA_SCOPE_TARGETS_COLLECTION,
]);

/**
 * 版本化定義與它的安裝 / 執行紀錄:只能經定義宣告由 api 的發布適配寫入,不收一般 documents
 * (否則等於把版本化發布繞回 raw upsert)。
 */
export const VERSIONED_DEFINITION_COLLECTIONS: readonly string[] = [
  "forms",
  "form_versions",
  "workflows",
  "workflow_versions",
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  SEED_UPDATE_RUNS_COLLECTION,
];

/** 排序與檢查的單位:一筆文件、一筆關聯、root 初始帳號或一份定義。 */
interface PlanNode {
  label: string;
  set: SeedSet;
  entry: SeedDocument | SeedRelation | null;
  dependencies: PlanNode[];
}

function documentId(collection: string, key: string): string {
  return `${collection}.${key}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 純物件 / 陣列裡(任何深度)有沒有 seedRef。 */
function containsSeedRef(value: unknown): boolean {
  if (isSeedIdReference(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSeedRef(item));
  }
  return (
    isPlainRecord(value) &&
    Object.values(value).some((item) => containsSeedRef(item))
  );
}

/**
 * 一個頂層值裡執行器會解析的 seedRef:值本身,或頂層陣列的元素(與 `seed-runner.ts` 的 `resolveValue` 同一套)。
 * 藏在物件裡的 seedRef 執行器不會解析(會原樣寫進資料庫),所以列成問題。
 */
function seedRefsOf(
  value: unknown,
  path: string,
  problems: string[],
): SeedKeyReference[] {
  if (isSeedIdReference(value)) {
    const { collection, key } = value.$seedRef as Partial<SeedKeyReference>;
    if (typeof collection !== "string" || typeof key !== "string") {
      problems.push(`${path} 的 seedRef 必須有 collection 與 key`);
      return [];
    }
    return [{ collection, key }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      seedRefsOf(item, `${path}.${String(index)}`, problems),
    );
  }
  if (containsSeedRef(value)) {
    problems.push(
      `${path} 在巢狀位置用了 seedRef;執行器只解析頂層欄位與頂層陣列的元素,不會遞迴解析`,
    );
  }
  return [];
}

function recordSeedRefs(
  record: Record<string, unknown>,
  path: string,
  problems: string[],
): SeedKeyReference[] {
  return Object.entries(record).flatMap(([field, value]) =>
    seedRefsOf(value, `${path}.${field}`, problems),
  );
}

interface CollectionPolicy {
  origin: string;
  set: SeedDocumentSet;
}

function keyFieldOf(set: SeedDocumentSet): string {
  return set.keyField ?? DEFAULT_KEY_FIELD;
}

/** 同一個 collection 的兩個 set 政策不相容的地方(空陣列 = 相容)。 */
function policyDifferences(
  left: SeedDocumentSet,
  right: SeedDocumentSet,
): string[] {
  const initialFieldsOf = (set: SeedDocumentSet): string[] =>
    [
      ...(set.initialSeedValueFields ?? DEFAULT_INITIAL_SEED_VALUE_FIELDS),
    ].toSorted((first, second) => first.localeCompare(second, "zh-Hant"));
  const differences: string[] = [];
  if (keyFieldOf(left) !== keyFieldOf(right)) {
    differences.push("識別鍵欄位");
  }
  if (!isDeepStrictEqual(left.match ?? {}, right.match ?? {})) {
    differences.push("match");
  }
  if (!isDeepStrictEqual(initialFieldsOf(left), initialFieldsOf(right))) {
    differences.push("初始值欄位");
  }
  if (!isDeepStrictEqual(left.adoptBy ?? null, right.adoptBy ?? null)) {
    differences.push("認養條件");
  }
  return differences;
}

function relationId(relation: SeedRelation): string {
  return [
    relation.type,
    documentId(relation.first.collection, relation.first.key),
    documentId(relation.second.collection, relation.second.key),
  ].join(" ");
}

/** 檢查與排序共用的狀態。 */
class RegistryPlan {
  readonly problems: string[] = [];
  /** 依輸入順序;定義另外放(排在全部普通種子之後)。 */
  readonly nodes: PlanNode[] = [];
  readonly definitionNodes: PlanNode[] = [];
  /** 可被引用的種子文件(識別鍵欄位是 `key` 的那些)。 */
  private readonly documents = new Map<string, PlanNode>();
  private readonly policies = new Map<string, CollectionPolicy>();
  /** 每個 collection 宣告過的 key → 第一個宣告它的來源。 */
  private readonly declaredKeys = new Map<string, string>();
  private readonly relations = new Set<string>();
  private readonly definitions = new Map<string, PlanNode>();
  private readonly pendingReferences: {
    node: PlanNode;
    references: SeedKeyReference[];
  }[] = [];
  private rootAdminOrigin: string | null = null;

  /** 專案宣告的可攜 lookup 來源(`SeedSource.portableLookupProviders`);進可攜性目錄。 */
  constructor(
    private readonly lookupProviders: ReadonlyMap<
      string,
      PortableLookupProvider
    > = new Map(),
  ) {}

  add(origin: string, set: SeedSet): void {
    switch (set.kind) {
      case "documents": {
        this.addDocuments(origin, set);
        return;
      }
      case "relations": {
        this.addRelations(origin, set);
        return;
      }
      case "root-admin": {
        this.addRootAdmin(origin, set);
        return;
      }
      case "form-definition":
      case "workflow-definition": {
        this.addDefinition(origin, set);
        return;
      }
      default: {
        this.problems.push(
          `${origin}:不認得的種子種類 ${String((set as { kind?: unknown }).kind)}`,
        );
      }
    }
  }

  private addDocuments(origin: string, set: SeedDocumentSet): void {
    const { collection } = set;
    if (VERSIONED_DEFINITION_COLLECTIONS.includes(collection)) {
      this.problems.push(
        `${origin}:${collection} 是版本化定義 / 安裝紀錄,不能用一般 documents 寫入;表單與流程請用 form-definition / workflow-definition 宣告`,
      );
      return;
    }
    if (collection === PERMISSIONS_COLLECTION) {
      this.checkPermissionSet(origin, set);
    }
    const policy = this.policies.get(collection);
    if (policy === undefined) {
      this.policies.set(collection, { origin, set });
    } else {
      const differences = policyDifferences(policy.set, set);
      if (differences.length > 0) {
        this.problems.push(
          `${collection} 在 ${policy.origin} 與 ${origin} 的宣告政策不相容(${differences.join("、")}不同);同一個 collection 的識別與初始值政策必須一致`,
        );
      }
    }
    const adoptReferences =
      set.adoptBy === undefined
        ? []
        : recordSeedRefs(
            set.adoptBy.where,
            `${origin}:${collection} 的 adoptBy.where`,
            this.problems,
          );
    for (const entry of set.entries) {
      const id = documentId(collection, entry.key);
      const declaredBy = this.declaredKeys.get(id);
      if (declaredBy !== undefined) {
        this.problems.push(
          `${id} 重複宣告(${declaredBy} 與 ${origin});同一個 key 不能宣告兩次,後面的不會覆蓋前面的`,
        );
        continue;
      }
      this.declaredKeys.set(id, origin);
      const node: PlanNode = {
        label: `${origin}:${id}`,
        set,
        entry,
        dependencies: [],
      };
      this.nodes.push(node);
      if (keyFieldOf(set) === DEFAULT_KEY_FIELD) {
        this.documents.set(id, node);
      }
      this.pendingReferences.push({
        node,
        references: [
          ...recordSeedRefs(entry.data, node.label, this.problems),
          ...adoptReferences,
        ],
      });
    }
  }

  /** 權限表與發布器產生的 dynamic 權限共用:seed 只能碰 `source` 不是 dynamic 的那些。 */
  private checkPermissionSet(origin: string, set: SeedDocumentSet): void {
    if (!isDeepStrictEqual(set.match, { source: { $ne: "dynamic" } })) {
      this.problems.push(
        `${origin}:${PERMISSIONS_COLLECTION} 的宣告必須帶 match { source: { $ne: "dynamic" } },不得比對或覆寫發布器產生的 dynamic 權限`,
      );
    }
    for (const entry of set.entries) {
      if (entry.data.source === "dynamic") {
        this.problems.push(
          `${origin}:${documentId(PERMISSIONS_COLLECTION, entry.key)} 是 dynamic 權限,只能由表單發布產生,不能用種子寫入`,
        );
      }
    }
  }

  private addRelations(origin: string, set: SeedRelationSet): void {
    for (const entry of set.entries) {
      const id = relationId(entry);
      // 完全相同的關聯只留第一筆(關聯本來就是「不存在才寫入」,重複宣告沒有額外語意)
      if (this.relations.has(id)) {
        continue;
      }
      this.relations.add(id);
      const node: PlanNode = {
        label: `${origin}:關聯 ${id}`,
        set,
        entry,
        dependencies: [],
      };
      this.nodes.push(node);
      this.pendingReferences.push({
        node,
        references: [entry.first, entry.second],
      });
    }
  }

  private addRootAdmin(
    origin: string,
    set: Extract<SeedSet, { kind: "root-admin" }>,
  ): void {
    if (this.rootAdminOrigin !== null) {
      this.problems.push(
        `root 初始帳號只允許宣告一份(${this.rootAdminOrigin} 與 ${origin} 都宣告了)`,
      );
      return;
    }
    this.rootAdminOrigin = origin;
    const node: PlanNode = {
      label: `${origin}:root 初始帳號`,
      set,
      entry: null,
      dependencies: [],
    };
    this.nodes.push(node);
    this.pendingReferences.push({
      node,
      references: [
        { collection: "orgs", key: set.orgKey },
        { collection: "roles", key: set.roleKey },
      ],
    });
  }

  private addDefinition(origin: string, set: DefinitionSeedSet): void {
    const id = `${set.kind}:${set.key}`;
    const existing = this.definitions.get(id);
    if (existing !== undefined) {
      this.problems.push(
        `${id} 重複宣告(${existing.label} 與 ${origin}:${definitionSeedId(set)});目前 registry 一個 key 只登記一個有效 revision`,
      );
      return;
    }
    const node: PlanNode = {
      label: `${origin}:${definitionSeedId(set)}`,
      set,
      entry: null,
      dependencies: [],
    };
    this.definitions.set(id, node);
    this.definitionNodes.push(node);
  }

  /** 全部宣告都收齊後才解析引用(被引用者可以宣告在後面,順序由排序處理)。 */
  resolveReferences(): void {
    for (const { node, references } of this.pendingReferences) {
      for (const reference of references) {
        const target = this.documentNode(reference, node.label);
        // 指向自己的引用也留著:插入前查不到自己的 id,排序時會以循環報出來
        if (target !== null) {
          node.dependencies.push(target);
        }
      }
    }
  }

  private documentNode(
    reference: SeedKeyReference,
    usedBy: string,
  ): PlanNode | null {
    const id = documentId(reference.collection, reference.key);
    const target = this.documents.get(id);
    if (target !== undefined) {
      return target;
    }
    const policy = this.policies.get(reference.collection);
    this.problems.push(
      policy !== undefined && keyFieldOf(policy.set) !== DEFAULT_KEY_FIELD
        ? `${usedBy} 引用了 ${id},但 ${reference.collection} 以 ${keyFieldOf(policy.set)} 當識別鍵,不可被 seedRef 引用`
        : `${usedBy} 引用的種子文件未宣告:找不到種子文件 ${id}`,
    );
    return null;
  }

  /** 同一計畫可解析的 key(模組、受管類別與它的種子選項、共用表單)。 */
  catalog(): PortableCatalog {
    const formModuleKeys = new Set(
      this.documentEntriesOf(MODULES_COLLECTION)
        .filter((entry) => entry.data.engine === "form")
        .map((entry) => entry.key),
    );
    const fieldCategories = new Map(
      this.documentEntriesOf(FIELD_CATEGORIES_COLLECTION).map((entry) => [
        entry.key,
        new Set<string>(),
      ]),
    );
    for (const { data } of this.documentEntriesOf(FIELDS_COLLECTION)) {
      const { categoryId, orgId, value } = data;
      // 全域(orgId = null)的種子選項才算受管;租戶自訂選項不在種子裡
      if (
        isSeedIdReference(categoryId) &&
        categoryId.$seedRef.collection === FIELD_CATEGORIES_COLLECTION &&
        orgId === null &&
        typeof value === "string"
      ) {
        fieldCategories.get(categoryId.$seedRef.key)?.add(value);
      }
    }
    const sharedForms = new Map<string, FormDefinition>();
    for (const { set } of this.definitionNodes) {
      if (set.kind === "form-definition") {
        sharedForms.set(set.key, set.definition);
      }
    }
    return {
      formModuleKeys,
      fieldCategories,
      sharedForms,
      lookupProviders: this.lookupProviders,
    };
  }

  private documentEntriesOf(collection: string): SeedDocument[] {
    return this.nodes.flatMap(({ set, entry }) =>
      set.kind === "documents" &&
      set.collection === collection &&
      entry !== null &&
      "data" in entry
        ? [entry]
        : [],
    );
  }

  /** 定義宣告:形狀與可攜性(含依賴可解析);通過的才補上排序用的依賴。 */
  checkDefinitions(): void {
    if (this.definitionNodes.length === 0) {
      return;
    }
    const catalog = this.catalog();
    for (const node of this.definitionNodes) {
      const set = node.set as DefinitionSeedSet;
      const { errors } = validatePortableDefinition(set, catalog);
      for (const issue of errors) {
        this.problems.push(
          `${node.label} 的 ${issue.path === "" ? "(宣告)" : issue.path}:${issue.message}(${issue.code})`,
        );
      }
      if (errors.length === 0) {
        node.dependencies.push(...this.definitionDependencies(set));
      }
    }
  }

  private definitionDependencies(set: DefinitionSeedSet): PlanNode[] {
    const { documentIds, formKeys } = definitionReferencesOf(set);
    const dependencies: PlanNode[] = [];
    for (const id of documentIds) {
      const target = this.documents.get(id);
      if (target !== undefined) {
        dependencies.push(target);
      }
    }
    for (const formKey of formKeys) {
      const target = this.definitions.get(`form-definition:${formKey}`);
      if (target !== undefined && target.set !== set) {
        dependencies.push(target);
      }
    }
    return dependencies;
  }
}

/** lookup 來源描述指到的表單(`form_submission` 才有)。 */
function lookupFormKeyOf(source: unknown): string[] {
  return isPlainRecord(source) &&
    source.provider === "form_submission" &&
    typeof source.formKey === "string"
    ? [source.formKey]
    : [];
}

/** 一個欄位(或明細子欄)引用到的類別與表單。 */
function fieldReferencesOf(field: unknown): {
  categoryKeys: string[];
  formKeys: string[];
} {
  if (!isPlainRecord(field)) {
    return { categoryKeys: [], formKeys: [] };
  }
  const categoryKeys: string[] = [];
  const formKeys = lookupFormKeyOf(field.source);
  const options = field.options;
  if (isPlainRecord(options)) {
    if (options.kind === "fieldCategory" && typeof options.key === "string") {
      categoryKeys.push(options.key);
    }
    formKeys.push(...lookupFormKeyOf(options.source));
  }
  for (const column of Array.isArray(field.columns) ? field.columns : []) {
    const nested = fieldReferencesOf(column);
    categoryKeys.push(...nested.categoryKeys);
    formKeys.push(...nested.formKeys);
  }
  return { categoryKeys, formKeys };
}

/** 一份定義(已通過形狀檢查)引用到的種子文件與表單定義:排序用。 */
function definitionReferencesOf(set: DefinitionSeedSet): {
  documentIds: string[];
  formKeys: string[];
} {
  if (set.kind === "workflow-definition") {
    const formKeys = set.checkFormKey === null ? [] : [set.checkFormKey];
    for (const step of set.definition.steps) {
      const assignee: unknown = (step as { assignee?: unknown }).assignee;
      if (
        isPlainRecord(assignee) &&
        assignee.kind === "field" &&
        typeof assignee.formKey === "string"
      ) {
        formKeys.push(assignee.formKey);
      }
    }
    return { documentIds: [], formKeys };
  }
  const documentIds = [documentId(MODULES_COLLECTION, set.moduleKey)];
  const formKeys: string[] = [];
  for (const field of set.definition.fields) {
    const references = fieldReferencesOf(field);
    documentIds.push(
      ...references.categoryKeys.map((key) =>
        documentId(FIELD_CATEGORIES_COLLECTION, key),
      ),
    );
    formKeys.push(...references.formKeys);
  }
  for (const prefill of set.definition.prefills) {
    formKeys.push(...lookupFormKeyOf((prefill as { source?: unknown }).source));
  }
  return { documentIds, formKeys };
}

/** 依引用排序(被引用者在前,其餘維持輸入順序);循環列成問題。 */
function orderNodes(
  nodes: readonly PlanNode[],
  problems: string[],
): PlanNode[] {
  const ordered: PlanNode[] = [];
  const state = new Map<PlanNode, "visiting" | "done">();
  const visit = (node: PlanNode, trail: readonly PlanNode[]): void => {
    const current = state.get(node);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(node)), node];
      problems.push(
        `種子引用循環:${cycle.map((item) => item.label).join(" → ")}`,
      );
      return;
    }
    state.set(node, "visiting");
    for (const dependency of node.dependencies) {
      visit(dependency, [...trail, node]);
    }
    state.set(node, "done");
    ordered.push(node);
  };
  for (const node of nodes) {
    visit(node, []);
  }
  return ordered;
}

/** 排好的條目收回成 set:連續且屬於同一個原 set 的條目併成一組(原 set 完整且順序沒變就原樣沿用)。 */
function regroup(ordered: readonly PlanNode[]): SeedRegistry {
  const groups: { set: SeedSet; entries: (SeedDocument | SeedRelation)[] }[] =
    [];
  for (const node of ordered) {
    let group = groups.at(-1);
    if (group?.set !== node.set) {
      group = { set: node.set, entries: [] };
      groups.push(group);
    }
    if (node.entry !== null) {
      group.entries.push(node.entry);
    }
  }
  return groups.map(({ set, entries }) => {
    if (set.kind !== "documents" && set.kind !== "relations") {
      return set;
    }
    const isUnchanged =
      entries.length === set.entries.length &&
      entries.every((entry, index) => entry === set.entries[index]);
    return isUnchanged ? set : ({ ...set, entries } as SeedSet);
  });
}

/** 組裝的選項(不屬於任何一份種子的設定)。 */
export interface SeedCompositionOptions {
  /** 專案登記、可以跟著共用定義交付的 lookup 來源(可攜性目錄的 `lookupProviders`)。 */
  lookupProviders?: Readonly<Record<string, PortableLookupProvider>>;
}

/**
 * 固定組裝入口(`seeds/registry.ts` 的 `assembleSeedRegistry`)最後一次登記的可攜 lookup 來源。
 * seed / reset / update 都先載入 registry 檔(組裝時登記)再預檢同一份 registry,預檢沒帶選項時用它 ——
 * 宣告跟著專案來源走,不必每個入口各傳一次;沒有組裝過 = 空(只有底座的三種來源)。
 */
let assembledLookupProviders: Readonly<Record<string, PortableLookupProvider>> =
  {};

/** 固定組裝入口登記專案宣告的可攜 lookup 來源(`SeedSource.portableLookupProviders`)。 */
export function registerAssembledLookupProviders(
  providers: Readonly<Record<string, PortableLookupProvider>> | undefined,
): void {
  assembledLookupProviders = providers ?? {};
}

function planOf(
  sources: readonly SeedOriginSource[],
  options: SeedCompositionOptions = {},
): RegistryPlan {
  const plan = new RegistryPlan(
    new Map(
      Object.entries(options.lookupProviders ?? assembledLookupProviders),
    ),
  );
  for (const { origin, seeds } of sources) {
    for (const set of seeds) {
      plan.add(origin, set);
    }
  }
  plan.resolveReferences();
  plan.checkDefinitions();
  return plan;
}

/**
 * 驗整份種子並排出執行順序:普通種子依引用排序,版本化定義排在最後、彼此依引用排序。
 * 任何一項不合就丟 `SeedCompositionError`(列出全部問題),呼叫端還沒寫入任何資料。
 */
export function planSeedRegistry(
  sources: readonly SeedOriginSource[],
  options: SeedCompositionOptions = {},
): SeedRegistry {
  const plan = planOf(sources, options);
  // 一次排完:定義接在普通種子後面,它們引用的種子文件此時都已排過,不會被再排一次
  const ordered = orderNodes(
    [...plan.nodes, ...plan.definitionNodes],
    plan.problems,
  );
  if (plan.problems.length > 0) {
    throw new SeedCompositionError(plan.problems);
  }
  return regroup(ordered);
}

/** 一份 registry 的可攜性目錄(模組、受管類別與選項、共用表單);給定義的檢查與匯出共用。 */
export function portableCatalogOf(
  registry: SeedRegistry,
  options: SeedCompositionOptions = {},
): PortableCatalog {
  return planOf([{ origin: "registry", seeds: registry }], options).catalog();
}

/** 推導出來的模板綁定是誰的:`<type> <角色>`;其他來源不得再宣告同一個角色的這類綁定。 */
function relationOwner(relation: SeedRelation): string {
  return `${relation.type} ${documentId(relation.first.collection, relation.first.key)}`;
}

function derivedOverlapProblems(
  sources: readonly SeedOriginSource[],
): string[] {
  const derivedOwners = new Set(
    sources
      .filter((source) => source.isDerived === true)
      .flatMap((source) => source.seeds)
      .flatMap((set) => (set.kind === "relations" ? set.entries : []))
      .map((relation) => relationOwner(relation)),
  );
  return sources
    .filter((source) => source.isDerived !== true)
    .flatMap(({ origin, seeds }) =>
      seeds.flatMap((set) => derivedOverlapOf(origin, set, derivedOwners)),
    );
}

/** 一個非推導來源的 set 宣告了哪些只能由推導產生的內容。 */
function derivedOverlapOf(
  origin: string,
  set: SeedSet,
  derivedOwners: ReadonlySet<string>,
): string[] {
  if (set.kind === "documents") {
    return DERIVED_COLLECTIONS.has(set.collection)
      ? [
          `${origin}:${set.collection} 由模組宣告推導,不能再用 documents 宣告;請改登記 moduleDeclarations`,
        ]
      : [];
  }
  if (set.kind !== "relations") {
    return [];
  }
  return set.entries
    .filter((relation) => derivedOwners.has(relationOwner(relation)))
    .map(
      (relation) =>
        `${origin}:關聯 ${relationId(relation)} 屬於由模組宣告推導的角色模板,不能另外宣告`,
    );
}

/**
 * 固定組裝入口用:把底座、模組推導與專案三份合成一份 registry。
 * 除了 `planSeedRegistry` 的檢查,另擋「非推導來源宣告推導類內容」。
 */
export function composeSeedRegistry(
  sources: readonly SeedOriginSource[],
  options: SeedCompositionOptions = {},
): SeedRegistry {
  const problems = derivedOverlapProblems(sources);
  try {
    const registry = planSeedRegistry(sources, options);
    if (problems.length === 0) {
      return registry;
    }
  } catch (error) {
    if (!(error instanceof SeedCompositionError)) {
      throw error;
    }
    problems.push(...error.problems);
  }
  throw new SeedCompositionError(problems);
}
