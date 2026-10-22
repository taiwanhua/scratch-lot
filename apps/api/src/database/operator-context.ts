import type { Aggregate, Query, Types } from "mongoose";

/**
 * 操作者上下文(詞彙見 CONTEXT.md:操作者 / 當前組織 / 可見範圍 / 管理範圍)。
 * 資料層只**消費**這份上下文;其計算(org_user 聯集、可見性開關、角色的擁有組織子樹)
 * 屬登入線(`auth/operator-context.service.ts`)。
 *
 * **兩個範圍各管各的**(ADR-0005「管理範圍與可見範圍的分工」):
 * 治理類 collection 吃 `managedOrgIds`、業務類吃 `visibleOrgIds`,由 schema 上的
 * `tenantScopePlugin({ kind })` 宣告是哪一類,個別功能不自己選。
 */
/** 一個組織集合範圍:明列 id,或「全部」(根組織層級,避免每次請求載入全部組織 id)。 */
export type OperatorOrgScope = Types.ObjectId[] | "all";

export interface OperatorContext {
  /** 操作者(此刻登入、執行動作的使用者)id;無登入主體的流程(如會員註冊)為 null。 */
  actorId: Types.ObjectId | null;
  /** 當前組織:新資料寫入哪個組織(ADR-0005);不參與可見範圍 / 管理範圍計算。 */
  currentOrgId: Types.ObjectId | null;
  /**
   * 可見組織集合 = 所有所屬組織的聯集(開關 ON 時含其下層,ADR-0005);**只管業務資料**。
   * 根組織「預設可見全部」以 `"all"` 表示(ADR-0005),避免每次請求載入全部組織 id。
   */
  visibleOrgIds: OperatorOrgScope;
  /**
   * 管理範圍 = 持有的**啟用中角色**之**擁有組織子樹**的聯集(CONTEXT.md / ADR-0003);
   * **只管治理模組**(組織 / 使用者 / 角色),由角色決定、不受可見性開關影響。
   * 持超級管理員或擁有組織為根組織的角色 = `"all"`;沒有任何角色 = 空陣列。
   */
  managedOrgIds: OperatorOrgScope;
  /**
   * **所屬組織**(`org_user` 的直接關聯,不含下層):資料範圍規則的動態值
   * 【操作者的所屬組織】與套用對象「指定組織」以它比對(ADR-0008)。
   * 與 `visibleOrgIds` 不同 — 後者含可見性開關展開的下層(ADR-0005)。
   *
   * 由登入線的 `OperatorContextService` 填寫;**沒有經登入線解析的內部上下文**
   * (密碼流程的 `LOOKUP` / `asAccount`、夾具的系統上下文)一律明寫 `[]` —
   * 那些流程只碰非租戶資料,永遠走不到資料範圍規則。空集合時規則算出的對象是空集合,
   * `$in: []` 命中不到任何資料(fail-closed,不會放寬)。
   *
   * **必填**:原本可選,漏填與「刻意給空」在型別上長得一模一樣,
   * 新增一個上下文時少寫一欄會靜默變成「不屬於任何組織」而不是編譯錯誤。
   */
  memberOrgIds: Types.ObjectId[];
  /**
   * 持有的**啟用中角色** id:資料範圍規則的套用對象「指定角色」以它比對(ADR-0008)。
   * 與 `managedOrgIds` 同一批角色(停用的不算,ADR-0011 步驟 2);同樣**必填**,語意同上。
   */
  roleIds: Types.ObjectId[];
  /**
   * 資料共用(`docs/adr/0014-data-sharing.md`)的比對來源:**依租戶分組**的所屬組織與其上層鏈
   * (根組織成員不算)。plugin 每個租戶各產生一組共用分支 `{ tenantId: T, … ∈ T 的所屬組織 / 上層鏈 }`,
   * 同時屬於兩個租戶的人不會用乙租戶的身分看到甲租戶的資料。與 `memberOrgIds` 一樣**不隨當前組織切換**。
   * 沒有經登入線解析的內部上下文一律明寫 `[]`(共用分支命中不到任何資料,fail-closed)。
   */
  memberTenants: MemberTenant[];
}

/** 操作者在某一個租戶裡的所屬組織(資料共用用;`OperatorContext.memberTenants` 的元素)。 */
export interface MemberTenant {
  /** 租戶頂層 id。 */
  tenantId: Types.ObjectId;
  /** 在這個租戶裡的所屬組織(直接關聯)。 */
  memberOrgIds: Types.ObjectId[];
  /** 這些所屬組織的上層鏈聯集(不含根組織、不含所屬組織本身)。 */
  ancestorOrgIds: Types.ObjectId[];
  /**
   * 這個租戶裡的**可見範圍**(所屬組織 + 租戶開了「含下層」時各自的整棵下層;登入線計算)。
   * 只給比對可見範圍的共用欄位用(`SharedByField.match: "visible"`,表單提交的依欄位共用);
   * 缺席(內部上下文、測試)= 只有所屬組織。
   */
  visibleOrgIds?: Types.ObjectId[];
}

/** 掛在單一 Query 上的範圍資訊,供 plugin 的查詢中介層讀取。 */
export interface QueryScope {
  operator: OperatorContext;
  /** 是否連軟刪除(deletedAt 有值)的資料一起查(ADR-0007);預設不查。 */
  includeDeleted?: boolean;
  /**
   * 只查**操作者自己建立**的資料,且不套資料範圍規則(可見範圍照套):插件改為加上
   * `createdBy = 操作者` 條件。唯一用途是表單提交的單筆讀取(建立者一律讀得到自己的單),
   * 只能經 `BaseRepository.findOwnById` 設定。
   */
  ownRecordsOnly?: boolean;
  /**
   * **存在性檢查**:不套資料範圍規則(ADR-0008),租戶過濾照套。只回答「有沒有」,
   * 只能經 BaseRepository 的存在性檢查方法設定(條件只能是歸屬欄、只回有無)。
   */
  existenceCheck?: boolean;
  /**
   * **租戶邊界出口**(`BaseRepository.existsInTenant` / `findRefsInTenant`):可見範圍與共用不套,
   * 改成 `tenantId = 這個值`;資料範圍規則不套。只能經那兩個方法設定(ADR-0005「例外出口」)。
   */
  tenantBoundary?: Types.ObjectId;
}

/** Document `$locals` 上存放操作者上下文的鍵(save 中介層讀取)。 */
export const OPERATOR_LOCAL_KEY = "operatorContext";

const queryScopes = new WeakMap<object, QueryScope>();

/**
 * 把操作者上下文掛到 Query 上(以 WeakMap 掛載,不汙染送往驅動程式的 query options)。
 * 唯一應呼叫此函式的地方是 BaseRepository;plugin 以 `getQueryScope` 讀回。
 */
export function scopeQuery<TQuery extends Query<unknown, unknown>>(
  query: TQuery,
  scope: QueryScope,
): TQuery {
  queryScopes.set(query, scope);
  return query;
}

/** 同 `scopeQuery`,掛在 aggregate 上(plugin 的 aggregate 中介層以 `$match` 起點套同一套條件)。 */
export function scopeAggregate<TAggregate extends Aggregate<unknown>>(
  aggregate: TAggregate,
  scope: QueryScope,
): TAggregate {
  queryScopes.set(aggregate, scope);
  return aggregate;
}

export function getQueryScope(query: object): QueryScope | undefined {
  return queryScopes.get(query);
}

function isIn(
  scope: OperatorOrgScope,
  orgId: Types.ObjectId | string,
): boolean {
  if (scope === "all") {
    return true;
  }
  const target = String(orgId);
  return scope.some((id) => String(id) === target);
}

/** 判斷某組織是否落在操作者**可見範圍**內(業務資料;ADR-0005)。 */
export function isOrgVisible(
  operator: OperatorContext,
  orgId: Types.ObjectId | string,
): boolean {
  return isIn(operator.visibleOrgIds, orgId);
}

/** 判斷某組織是否落在操作者**管理範圍**內(治理模組;CONTEXT.md「管理範圍」)。 */
export function isOrgManaged(
  operator: OperatorContext,
  orgId: Types.ObjectId | string,
): boolean {
  return isIn(operator.managedOrgIds, orgId);
}
