/* eslint-disable unicorn/no-this-outside-of-class -- Mongoose 中介層以 this 接收 Query,無參數式替代;到期條件:Mongoose 提供以參數傳入 query 的中介層 API */
import {
  type MongooseQueryMiddleware,
  type Query,
  type QueryFilter,
  type Schema,
  Types,
} from "mongoose";

import type {
  MemberTenant,
  OperatorOrgScope,
  QueryScope,
} from "../operator-context";
import { getQueryScope } from "../operator-context";
import { getDataScopeRuleProvider } from "./data-scope-provider";

/**
 * 這個 collection 屬哪一類(ADR-0005「管理範圍與可見範圍的分工」),決定過濾吃哪個集合:
 * - `business`(預設):業務資料,吃**可見範圍** `visibleOrgIds`
 * - `governance`:治理資料(組織本身),吃**管理範圍** `managedOrgIds`
 *
 * 判準寫在 schema 上、不寫在呼叫端:同一張表在不同功能裡不該換範圍,
 * 否則「治理頁看得到、業務頁看不到」這種差異會散落在各 service 裡(CONTEXT.md「租戶過濾」)。
 * 沒有 `orgId`、走核心關聯歸屬的 users / roles 不掛本 plugin,由模組先查關聯再查本表 —
 * 它們查關聯時用的組織清單也一律來自 orgs(已是治理類),範圍自然跟著對。
 */
export type TenantScopeKind = "business" | "governance";

/** 共用清單的一筆(`shareOrgs` 的元素):共用給哪個組織、是否連它的下層一起。 */
export interface ShareOrg {
  orgId: Types.ObjectId;
  includeDescendants: boolean;
}

/**
 * 「也給這個欄位指到的組織看」的欄位(`sharedByFields`):欄位是單一組織或組織陣列(ObjectId),
 * 任一個值對上操作者的所屬組織就看得到;`includeDescendants` = 被指到的組織的下層也看得到。
 * 欄位與 `{ tenantId, <欄位> }` 開頭的索引由宣告的表自己建,掛 plugin 時驗證存在。
 */
export interface SharedByField {
  path: string;
  includeDescendants: boolean;
  /**
   * 比對誰(預設 `members`):
   * - `members`:欄位 ∈ 讀者在該租戶的**所屬組織**(`includeDescendants` 另含其上層鏈)—— 資料表的共用
   * - `visible`:欄位 ∈ 讀者在該租戶的**可見範圍**(所屬組織 + 開關展開的下層)—— 表單提交的依欄位共用:
   *   表單的組織欄代表「這張單屬於哪家店」,看得到那家店的人就看得到這張單(ADR-0014「表單提交:依欄位共用」);
   *   不可再勾 `includeDescendants`
   */
  match?: "members" | "visible";
}

/**
 * 每張表三種資料共用宣告之一(ADR-0014;寫在 schema 上,不在 UI):
 * - `private`(預設):只照可見範圍
 * - `shareable`:每筆資料有共用清單 `shareOrgs`(plugin 加欄位與索引);`defaultShareOrgs` 是新增時的
 *   預設清單(`none` = 空、`wholeTenant` = 租戶頂層含下層 = 全部分店);`editable: false` = 清單固定、
 *   一般更新改不了;`sharedByFields` 另讓欄位指到的組織看得到(不需同步任何清單)。
 *   `defaultShareOrgs: "none"` + `editable: false` = 清單永遠是空的:plugin 不宣告 `shareOrgs` 欄位與索引、
 *   讀取不加共用清單的分支,只靠 `sharedByFields`(見 `hasShareList`)
 * - `inheritDown`:下層看得到上層建的(看所屬組織的上層鏈,不隨當前組織切換)
 *
 * 共用只放寬**讀**;修改 / 刪除仍只對「歸屬組織在自己可見範圍內」的資料做(共用進來的只能看)。
 */
export type TenantSharingOptions =
  | { mode: "private" }
  | {
      mode: "shareable";
      defaultShareOrgs: "none" | "wholeTenant";
      editable: boolean;
      sharedByFields?: readonly SharedByField[];
    }
  | { mode: "inheritDown" };

/** 解析後的共用宣告(`sharedByFields` 一律有值)。 */
export type TenantSharing =
  | { mode: "private" }
  | {
      mode: "shareable";
      defaultShareOrgs: "none" | "wholeTenant";
      editable: boolean;
      sharedByFields: readonly SharedByField[];
    }
  | { mode: "inheritDown" };

export interface TenantScopeOptions {
  /** 承載組織 id 的欄位:一般租戶資料為 `orgId`;orgs 自身以 `_id` 判定可見(ADR-0005)。 */
  path?: "orgId" | "_id";
  /** 該欄位為 null 的資料視為全域(如 fields 的全域種子,ADR-0005 `$or`),對所有操作者可見。 */
  allowGlobal?: boolean;
  /** 治理類 / 業務類(見 `TenantScopeKind`);預設 `business`。 */
  kind?: TenantScopeKind;
  /**
   * **模組資料表**(`demo_items_one`、`demo_items_two`、之後的 `form_submissions` 與每張模組資料表):
   * 開了就由本 plugin 一併宣告兩個欄位並建索引 —
   * - `moduleKey`(必填):這筆資料屬於哪個模組;固定欄位模組寫死自己的 key,表單提交寫綁的模組。
   *   資料範圍規則依它分模組套用(`docs/modules/data-scope.md`「依模組」)
   * - `tenantId`(ObjectId | null):租戶頂層 id,由 `BaseRepository.create` 依 `orgId` 的祖先推導
   *   (根組織的資料為 null),呼叫端給了也會被覆蓋;只用於租戶邊界、索引與日後分片,
   *   **不決定可見範圍**(可見範圍仍看 `orgId`)
   *
   * **不綁 `kind: "business"`**:業務類還掛在 `fields`、`audit_logs`、`customers` 上,
   * 它們不是模組資料,不加這兩欄。
   */
  moduleData?: boolean;
  /** 資料共用宣告(見 `TenantSharingOptions`);預設 `{ mode: "private" }`。`shareable` 必須是模組資料表。 */
  sharing?: TenantSharingOptions;
  /**
   * `BaseRepository.findRefsInTenant` 可回的欄位白名單(「看得到這筆就看得到它引用的名稱」);
   * 不給 = 這張表不提供引用名稱出口。必須是模組資料表。
   */
  refFields?: readonly string[];
}

/** 解析後的租戶範圍設定(`getTenantScope`)。 */
export interface TenantScope {
  path: "orgId" | "_id";
  allowGlobal: boolean;
  kind: TenantScopeKind;
  moduleData: boolean;
  sharing: TenantSharing;
  refFields: readonly string[];
}

/**
 * 會被套上租戶過濾的**讀取**中介層:可見範圍 + 資料共用(ADR-0014)放寬,再被資料範圍規則縮小。
 * `estimatedDocumentCount` 不吃條件,刻意不列 — 對租戶資料不該使用。`aggregate` 另以
 * `$match` 起點套同一套條件(見 `tenantScopePlugin`)。
 */
export const SCOPED_READ_MIDDLEWARE = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
] as const satisfies readonly MongooseQueryMiddleware[];

/** 會被套上租戶過濾的**寫入**中介層:只照可見範圍,**不帶共用分支**(共用進來的只能看)。 */
export const SCOPED_WRITE_MIDDLEWARE = [
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
] as const satisfies readonly MongooseQueryMiddleware[];

/** 凡吃過濾條件的讀/寫/刪(兩份清單的聯集)。 */
export const SCOPED_QUERY_MIDDLEWARE = [
  ...SCOPED_READ_MIDDLEWARE,
  ...SCOPED_WRITE_MIDDLEWARE,
] as const satisfies readonly MongooseQueryMiddleware[];

const tenantScopes = new WeakMap<Schema, TenantScope>();

/** 掛 plugin 當下 schema 上的 collection 名(中介層閉包拿到的就是這個值);資料登記據此驗證。 */
const installedCollections = new WeakMap<Schema, string | undefined>();

/** 租戶隔離被違反或缺少上下文時拋出;屬程式錯誤(該經 BaseRepository 卻沒有),不是使用者錯誤。 */
export class TenantScopeError extends Error {
  override name = "TenantScopeError";
}

/** 資料共用的欄位名(`shareable` 的表由本 plugin 宣告)。 */
export const SHARE_ORGS_PATH = "shareOrgs";

/**
 * 這張表有沒有共用清單 `shareOrgs`:`shareable` 且清單可能非空(可編輯,或預設全部分店)。
 * 預設不共用又不可編輯的清單永遠是空的,欄位、索引與讀取分支都只是成本(每次讀取多一個
 * 比對整個租戶的 `$or` 分支),一律省掉;寫入時也不寫這個欄位。
 */
export function hasShareList(sharing: TenantSharing): boolean {
  return (
    sharing.mode === "shareable" &&
    (sharing.editable || sharing.defaultShareOrgs !== "none")
  );
}

/**
 * Mongoose plugin(ADR-0005 / ADR-0014):把「組織 ∈ 操作者可見組織」自動加進每一條查詢。
 * - 條件以 `$and` 追加,呼叫端自己的 orgId 條件只會再收窄、無法放寬。
 * - 讀取另依 `sharing` 宣告以 `$or` 加上共用分支(每個分支都釘 `tenantId`);寫入不加。
 * - 查詢未攜帶操作者上下文(沒經 BaseRepository)→ 直接拋錯(fail-closed),不會靜默回傳全部。
 * - 未掛此 plugin 的 schema(種子表、平台級帳號表)完全不受影響 — 這就是「非租戶資料」的判定機制。
 */
export function tenantScopePlugin(
  schema: Schema,
  options: TenantScopeOptions = {},
): void {
  const scope: TenantScope = {
    path: options.path ?? "orgId",
    allowGlobal: options.allowGlobal ?? false,
    kind: options.kind ?? "business",
    moduleData: options.moduleData ?? false,
    sharing: resolveSharing(options.sharing),
    refFields: options.refFields ?? [],
  };
  assertSharingDeclaration(schema, scope);
  tenantScopes.set(schema, scope);
  if (scope.moduleData) {
    declareModuleDataFields(schema);
  }
  if (hasShareList(scope.sharing)) {
    declareShareOrgsField(schema);
  }
  // collection 名在 schema 定義時就確定(每張 schema 都以 `@Schema({ collection })` 明寫),
  // 在此取一次:資料範圍規則以 collection 為識別鍵(ADR-0008),中介層裡不必再碰原生驅動程式
  const collectionName: string | undefined = schema.get("collection");
  schema.pre([...SCOPED_READ_MIDDLEWARE], async function () {
    applyTenantScope(this, scope, "read");
    await applyDataScope(this, scope, collectionName);
  });
  schema.pre([...SCOPED_WRITE_MIDDLEWARE], async function () {
    applyTenantScope(this, scope, "write");
    await applyDataScope(this, scope, collectionName);
  });
  // 讀進來的文件(含共用分支讀到的)再 `save()` 會走 `collection.updateOne`,不經查詢中介層,
  // 等於繞過寫入範圍;更新一律經 BaseRepository 的條件更新,這裡只放行新建
  schema.pre("save", function () {
    if (!this.isNew) {
      throw new TenantScopeError(
        `${collectionName ?? "租戶資料"}:更新請經 BaseRepository(不得對已存在的文件呼叫 save())`,
      );
    }
  });
  // aggregate 沒有 Query 的 `$and`:同一套讀取條件放進 pipeline 最前面的 `$match`
  schema.pre("aggregate", async function () {
    const queryScope = getQueryScope(this);
    if (!queryScope) {
      throw new TenantScopeError(
        `${collectionName ?? "租戶資料"} 的 aggregate 必須攜帶操作者上下文(請經 BaseRepository.aggregate)`,
      );
    }
    const conditions = [
      readConditionOf(queryScope, scope),
      await dataScopeConditionOf(queryScope, scope, collectionName),
    ].filter((condition) => condition !== null);
    if (conditions.length > 0) {
      this.pipeline().unshift({ $match: { $and: conditions } });
    }
  });
  installedCollections.set(schema, collectionName);
}

/**
 * 掛 plugin 當下取到的 collection 名;未掛 plugin、或掛的時候 schema 還沒定 collection 都回 undefined。
 * 事後才 `schema.set("collection")` 的 schema,資料範圍規則會因為中介層拿不到 collection 而靜默不套 ——
 * 資料登記以此擋下(`registration-validation.ts`)。
 */
export function getTenantScopeCollection(schema: Schema): string | undefined {
  return installedCollections.get(schema);
}

function resolveSharing(
  sharing: TenantSharingOptions | undefined,
): TenantSharing {
  if (sharing?.mode === "shareable") {
    return { ...sharing, sharedByFields: sharing.sharedByFields ?? [] };
  }
  return sharing ?? { mode: "private" };
}

/**
 * 宣告自洽檢查(掛 plugin 當下、schema 欄位與索引都已定義):不合就拋 `TenantScopeError`,
 * app 起不來 —— 宣告錯了是程式錯誤,不能留到查詢時才靜默少套條件。
 */
function assertSharingDeclaration(schema: Schema, scope: TenantScope): void {
  const collection: string | undefined = schema.get("collection");
  const subject = `${collection ?? "租戶資料"} 的租戶範圍宣告`;
  if (
    scope.sharing.mode !== "private" &&
    (scope.kind !== "business" || scope.path !== "orgId" || scope.allowGlobal)
  ) {
    throw new TenantScopeError(
      `${subject}:資料共用只給業務類、path: orgId、allowGlobal: false 的表`,
    );
  }
  if (scope.sharing.mode === "shareable" && !scope.moduleData) {
    throw new TenantScopeError(
      `${subject}:可共用要以 tenantId 為邊界,必須是模組資料表(moduleData: true)`,
    );
  }
  if (scope.refFields.length > 0 && !hasTenantIdPath(schema, scope)) {
    throw new TenantScopeError(
      `${subject}:引用名稱出口要以 tenantId 為邊界,表要有 tenantId 欄(模組資料表或自己宣告的 ObjectId 欄)`,
    );
  }
  if (
    scope.sharing.mode === "shareable" &&
    !hasShareList(scope.sharing) &&
    scope.sharing.sharedByFields.length === 0
  ) {
    throw new TenantScopeError(
      `${subject}:預設不共用又不可編輯、也沒有 sharedByFields = 不會共用給任何人,請改宣告 private`,
    );
  }
  if (scope.sharing.mode === "shareable") {
    for (const field of scope.sharing.sharedByFields) {
      assertSharedByField(schema, subject, field);
    }
  }
  for (const field of scope.refFields) {
    if (schema.pathType(field) !== "real") {
      throw new TenantScopeError(
        `${subject}:refFields 的 ${field} 不是這張表的欄位`,
      );
    }
  }
}

/**
 * 這張表有沒有 `tenantId` 欄可當租戶邊界:模組資料表由 plugin 宣告;其他表要自己宣告成 ObjectId
 * (例:比照業務關聯、自己寫 tenantId 的關聯表)。租戶邊界出口(`existsInTenant` / `findRefsInTenant`)據此放行。
 */
export function hasTenantIdPath(schema: Schema, scope: TenantScope): boolean {
  if (scope.moduleData) {
    return true;
  }
  const path = schema.path("tenantId") as { instance?: string } | undefined;
  return path?.instance === "ObjectId";
}

/** `sharedByFields` 的欄位:存在、是組織 id(或其陣列),且有 `{ tenantId, <欄位> }` 開頭的索引。 */
function assertSharedByField(
  schema: Schema,
  subject: string,
  field: SharedByField,
): void {
  const { path } = field;
  if (field.match === "visible" && field.includeDescendants) {
    throw new TenantScopeError(
      `${subject}:sharedByFields 的 ${path} 比對可見範圍(match: visible)時不能再勾 includeDescendants`,
    );
  }
  if (path === "orgId" || path === SHARE_ORGS_PATH) {
    throw new TenantScopeError(
      `${subject}:sharedByFields 不能是 ${path}(歸屬與共用清單已有自己的分支)`,
    );
  }
  const schemaType = schema.path(path) as
    | { instance?: string; embeddedSchemaType?: { instance?: string } }
    | undefined;
  const isObjectId =
    schemaType?.instance === "ObjectId" ||
    (schemaType?.instance === "Array" &&
      schemaType.embeddedSchemaType?.instance === "ObjectId");
  if (!isObjectId) {
    throw new TenantScopeError(
      `${subject}:sharedByFields 的 ${path} 必須是組織 id(ObjectId 或其陣列)欄位`,
    );
  }
  const indexed = schema.indexes().some(([fields]) => {
    const keys = Object.keys(fields);
    return keys[0] === "tenantId" && keys[1] === path;
  });
  if (!indexed) {
    throw new TenantScopeError(
      `${subject}:sharedByFields 的 ${path} 要先建 { tenantId: 1, ${path}: 1 } 開頭的索引(掛 plugin 之前)`,
    );
  }
}

/** 模組資料的兩個欄位與索引(見 `TenantScopeOptions.moduleData`)。 */
function declareModuleDataFields(schema: Schema): void {
  schema.add({
    moduleKey: { type: String, required: true },
    tenantId: { type: Types.ObjectId, default: null },
  });
  // 租戶邊界 + 模組(列表、分片的前綴);資料範圍的 `$or` 依 moduleKey 分支
  schema.index({ tenantId: 1, moduleKey: 1, createdAt: 1 });
  schema.index({ moduleKey: 1, orgId: 1 });
}

/** 可共用的表:共用清單欄位與「共用給誰」的索引(ADR-0014)。 */
function declareShareOrgsField(schema: Schema): void {
  schema.add({
    [SHARE_ORGS_PATH]: {
      type: [
        {
          _id: false,
          orgId: { type: Types.ObjectId, required: true },
          includeDescendants: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
  });
  schema.index({ tenantId: 1, [`${SHARE_ORGS_PATH}.orgId`]: 1 });
}

/** 讀取 schema 的租戶範圍設定;未掛 plugin 回 undefined(= 非租戶資料)。 */
export function getTenantScope(schema: Schema): TenantScope | undefined {
  return tenantScopes.get(schema);
}

type AnyQuery = Query<unknown, unknown, unknown, Record<string, unknown>>;
type Filter = QueryFilter<Record<string, unknown>>;

/**
 * **寫入中介層會加上的條件**(可見範圍 + 資料範圍規則),給不經查詢中介層的寫入(`bulkWrite`)自己釘在
 * 每一筆的條件上 —— 與 `SCOPED_WRITE_MIDDLEWARE` 同一套判斷,不另寫一份。未掛本 plugin 的 schema 回 `[]`。
 * 只給 `BaseRepository` 用(其他寫入一律經查詢中介層)。
 */
export async function writeScopeConditionsOf(
  schema: Schema,
  queryScope: QueryScope,
): Promise<Filter[]> {
  const scope = tenantScopes.get(schema);
  if (scope === undefined) {
    return [];
  }
  const conditions = [
    writeConditionOf(queryScope, scope),
    await dataScopeConditionOf(
      queryScope,
      scope,
      installedCollections.get(schema),
    ),
  ];
  return conditions.filter((condition) => condition !== null);
}

function applyTenantScope(
  query: AnyQuery,
  scope: TenantScope,
  access: "read" | "write",
): void {
  const queryScope = getQueryScope(query);
  if (!queryScope) {
    throw new TenantScopeError(
      `${query.model.modelName} 是租戶資料,查詢必須攜帶操作者上下文(請經 BaseRepository)`,
    );
  }
  const condition =
    access === "read"
      ? readConditionOf(queryScope, scope)
      : writeConditionOf(queryScope, scope);
  if (condition !== null) {
    query.and([condition]);
  }
}

/** 租戶邊界出口(`tenantBoundary`):只釘 `tenantId`,讀寫都不看可見範圍與共用。 */
function boundaryConditionOf(queryScope: QueryScope): Filter | null {
  return queryScope.tenantBoundary === undefined
    ? null
    : { tenantId: queryScope.tenantBoundary };
}

/** 可見範圍本身(寫入只看它):`orgId ∈ 範圍`,`allowGlobal` 另含全域。`"all"` → 不加條件。 */
function visibilityConditionOf(
  queryScope: QueryScope,
  scope: TenantScope,
): Filter | null {
  const orgIds = scopeOrgIdsOf(queryScope.operator, scope.kind);
  if (orgIds === "all") {
    return null;
  }
  const inScopeOrgs: Filter = { [scope.path]: { $in: orgIds } };
  return scope.allowGlobal
    ? { $or: [inScopeOrgs, { [scope.path]: null }] }
    : inScopeOrgs;
}

function writeConditionOf(
  queryScope: QueryScope,
  scope: TenantScope,
): Filter | null {
  return (
    boundaryConditionOf(queryScope) ?? visibilityConditionOf(queryScope, scope)
  );
}

/**
 * 讀取條件 = `$or: [可見範圍, ...共用分支]`(ADR-0014);可見範圍是 `"all"`(根組織、登記過的提升上下文)
 * 時共用不必再放寬,一樣不加條件。
 */
function readConditionOf(
  queryScope: QueryScope,
  scope: TenantScope,
): Filter | null {
  const boundary = boundaryConditionOf(queryScope);
  if (boundary !== null) {
    return boundary;
  }
  const visibility = visibilityConditionOf(queryScope, scope);
  if (visibility === null) {
    return null;
  }
  const shared = sharingBranchesOf(scope, queryScope.operator.memberTenants);
  return shared.length === 0 ? visibility : { $or: [visibility, ...shared] };
}

/**
 * 共用分支(ADR-0014 的讀取條件,不含可見範圍本身),**每個所屬租戶各一組**,
 * 每組都釘 `tenantId = 那個租戶`、只比對**那個租戶裡**的所屬組織與上層鏈 —— 同時屬於兩個租戶的人,
 * 不會拿乙租戶的組織去命中甲租戶的資料:
 * - `inheritDown`:`orgId ∈ 該租戶所屬組織的上層鏈`(上層鏈就是該租戶的組織,不另釘 `tenantId`)
 * - `shareable`:`shareOrgs` 命中該租戶的所屬組織,或命中其上層鏈且勾了含下層
 * - `sharedByFields`:欄位 ∈ 該租戶的所屬組織(宣告含下層時另含其上層鏈);`match: visible` 的欄位改比對
 *   該租戶的可見範圍
 *
 * 沒有所屬租戶(內部上下文)→ 一個分支都不加(fail-closed)。
 */
function sharingBranchesOf(
  scope: TenantScope,
  memberTenants: readonly MemberTenant[],
): Filter[] {
  return memberTenants.flatMap((tenant) => tenantBranchesOf(scope, tenant));
}

function tenantBranchesOf(scope: TenantScope, tenant: MemberTenant): Filter[] {
  const { sharing } = scope;
  const members = [...tenant.memberOrgIds];
  const ancestors = [...tenant.ancestorOrgIds];
  if (sharing.mode === "inheritDown") {
    return ancestors.length === 0
      ? []
      : // 上層鏈本身就是該租戶的組織(由組織樹推出),不必另釘 tenantId;inheritDown 的表也不一定有 tenantId
        [{ orgId: { $in: ancestors } }];
  }
  if (sharing.mode !== "shareable") {
    return [];
  }
  const branches: Filter[] = [];
  if (hasShareList(sharing)) {
    // 「共用給所屬組織」與「共用給上層鏈且含下層」拆成兩個分支(語意同 `$elemMatch` 裡放 `$or`):
    // `$elemMatch` 內有 `$or` 時索引 `{ tenantId, shareOrgs.orgId }` 只用得到 `tenantId`,要掃過整個租戶
    branches.push({
      tenantId: tenant.tenantId,
      [SHARE_ORGS_PATH]: { $elemMatch: { orgId: { $in: members } } },
    });
    if (ancestors.length > 0) {
      branches.push({
        tenantId: tenant.tenantId,
        [SHARE_ORGS_PATH]: {
          $elemMatch: { orgId: { $in: ancestors }, includeDescendants: true },
        },
      });
    }
  }
  for (const field of sharing.sharedByFields) {
    branches.push({
      tenantId: tenant.tenantId,
      [field.path]: { $in: sharedByFieldTargetsOf(field, tenant) },
    });
  }
  return branches;
}

/** `sharedByFields` 一個欄位要比對的組織(見 `SharedByField.match`)。 */
function sharedByFieldTargetsOf(
  field: SharedByField,
  tenant: MemberTenant,
): Types.ObjectId[] {
  if (field.match === "visible") {
    return [...(tenant.visibleOrgIds ?? tenant.memberOrgIds)];
  }
  return field.includeDescendants
    ? [...tenant.memberOrgIds, ...tenant.ancestorOrgIds]
    : [...tenant.memberOrgIds];
}

/**
 * 「這筆是否給某個組織的成員看得到」(歸屬是它、它沿用的上層、或共用給它):lookup 的「依表單欄位換值的共用篩選」
 * 用(`LookupProviderDeclaration.sharedToFilter`)。只回條件,仍與操作者自己的讀取範圍 `$and`,放寬不了。
 * `private` 的表只剩「歸屬是它」。
 */
export function sharedToOrgCondition(
  scope: TenantScope,
  target: {
    orgId: Types.ObjectId;
    ancestorOrgIds: readonly Types.ObjectId[];
    tenantId: Types.ObjectId | null;
  },
): Filter {
  const shared = sharingBranchesOf(
    scope,
    target.tenantId === null
      ? []
      : [
          {
            tenantId: target.tenantId,
            memberOrgIds: [target.orgId],
            ancestorOrgIds: [...target.ancestorOrgIds],
          },
        ],
  );
  return { $or: [{ orgId: target.orgId }, ...shared] };
}

/**
 * 資料範圍規則(ADR-0008):在租戶保底**之內**再收窄 —
 * 條件同樣以 `$and` 追加,所以規則永遠只會讓看到的變少,保底不可被關掉;共用進來的資料一樣被縮小
 * (先放寬、再縮小)。
 *
 * 只套**模組資料表**(`moduleData: true`,必為業務類):治理類 collection(組織 / 使用者 / 角色)
 * 吃的是管理範圍,由角色決定,不是資料範圍要管的事;`fields` / `audit_logs` / `customers` 這類
 * 業務類但非模組資料的表沒有 `moduleKey`,規則無從依模組套用(`docs/modules/data-scope.md`「執行面」)。
 * 存在性檢查(`existenceCheck`)與租戶邊界出口(`tenantBoundary`)略過規則、只留租戶保底。
 * 規則以 `(collection, moduleKey)` 為鍵,provider 把同一 collection 下命中操作者的規則
 * 依模組拼成 `$or`;沒有規則的模組(如 `demo.sample-two`)維持只看可見範圍。
 */
async function applyDataScope(
  query: AnyQuery,
  scope: TenantScope,
  collectionName: string | undefined,
): Promise<void> {
  // applyTenantScope 已在同一個中介層先跑過,沒有上下文的查詢在那裡就 fail-closed 了
  const queryScope = getQueryScope(query);
  if (!queryScope) {
    return;
  }
  const condition = await dataScopeConditionOf(
    queryScope,
    scope,
    collectionName,
  );
  if (condition) {
    query.and([condition]);
  }
}

async function dataScopeConditionOf(
  queryScope: QueryScope,
  scope: TenantScope,
  collectionName: string | undefined,
): Promise<Filter | null> {
  if (
    !scope.moduleData ||
    scope.kind !== "business" ||
    collectionName === undefined
  ) {
    return null;
  }
  const provider = getDataScopeRuleProvider();
  if (!provider) {
    // 跑起來的 app 走不到這裡:`DatabaseModule.onApplicationBootstrap` 已斷言 provider
    // 必定註冊;剩下的呼叫端只有不起 Nest 的單元測試
    return null;
  }
  if (
    queryScope.existenceCheck === true ||
    queryScope.tenantBoundary !== undefined
  ) {
    // 存在性檢查與租戶邊界出口:問的是「有沒有」/「引用的名稱」,規則不得把答案收窄;
    // 租戶過濾已在前面套上,這裡只略過規則
    return null;
  }
  if (queryScope.ownRecordsOnly === true) {
    // 建立者讀自己的資料:不套規則,改成只許命中自己建的(沒有操作者 = 什麼都命中不到)
    return { createdBy: queryScope.operator.actorId ?? { $in: [] } };
  }
  return provider.conditionFor(collectionName, queryScope.operator);
}

/** 治理類吃管理範圍、業務類吃可見範圍(ADR-0005 的分工表;此處是唯一的選擇點)。 */
export function scopeOrgIdsOf(
  operator: {
    visibleOrgIds: OperatorOrgScope;
    managedOrgIds: OperatorOrgScope;
  },
  kind: TenantScopeKind,
): OperatorOrgScope {
  return kind === "governance"
    ? operator.managedOrgIds
    : operator.visibleOrgIds;
}
