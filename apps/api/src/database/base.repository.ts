/* eslint-disable @repo/no-raw-model-query -- 此檔即過濾層本身:裸 Model 存取的唯一合法出口(ADR-0005);到期條件:無 */
import mongoose, {
  type ClientSession,
  type Model,
  type PipelineStage,
  type QueryFilter,
  type SaveOptions,
  type Types,
  type UpdateQuery,
} from "mongoose";

import {
  OPERATOR_LOCAL_KEY,
  type OperatorContext,
  isOrgVisible,
  scopeAggregate,
  scopeQuery,
} from "./operator-context";
import {
  ORG_REASSIGN_AUDIT_ACTION,
  currentTenantOf,
  currentTenantsOf,
  orgReassignConflictError,
  orgReassignValidationError,
  reassignTargetOf,
} from "./org-reassign";
import type { BaseFields } from "./plugins/base-fields.plugin";
import {
  SHARE_ORGS_PATH,
  type ShareOrg,
  type TenantScope,
  TenantScopeError,
  getTenantScope,
  hasTenantIdPath,
  writeScopeConditionsOf,
} from "./plugins/tenant-scope.plugin";
import { AuditLog } from "./schemas/audit-log.schema";
import { BUSINESS_RELATIONSHIPS_COLLECTION } from "./schemas/business-relationship.schema";
import { CORE_RELATIONSHIPS_COLLECTION } from "./schemas/core-relationship.schema";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import { WORKFLOW_TASKS_COLLECTION } from "./schemas/workflow-task.schema";
import { WORKFLOWS_COLLECTION } from "./schemas/workflow.schema";
import {
  assertShareOrgsInTenant,
  normalizeShareOrgs,
  shareOrgsValidationError,
  tenantIdsOfShareOrgs,
} from "./share-orgs";
import { assertTenantBoundary } from "./tenant-boundary";
import { tenantIdOfOrg } from "./tenant-id";
import { currentSession } from "./transaction";
import { writeCountConflictError } from "./write-conflict";

/** Model 型別參數固定為預設值(無 query helpers / instance methods / virtuals),只讓 hydrated 文件型別可推導。 */
type NoExtras = Record<never, never>;

export type RepositoryModel<TSchema, TDocument> = Model<
  TSchema,
  NoExtras,
  NoExtras,
  NoExtras,
  TDocument
>;

/** hydrated 文件型別的最小需求(由傳入的 Model 推導,不需手動指定)。 */
export interface RepositoryDocument {
  $locals: Record<string, unknown>;
  save(options?: SaveOptions): Promise<unknown>;
}

/** 經 BaseRepository 取回的文件:一定帶基礎欄位(由 baseFields plugin 保證)。 */
export type Persisted<TDocument> = TDocument & BaseFields;

export type RepositoryFilter<TSchema> = QueryFilter<TSchema & BaseFields>;

export type RepositoryUpdate<TSchema> = UpdateQuery<TSchema & BaseFields>;

/** 租戶內引用名稱出口(`findRefsInTenant`)回的一筆:`_id` + schema 宣告的 `refFields`。 */
export type TenantRef = { _id: Types.ObjectId } & Record<string, unknown>;

/**
 * 建立資料的內容。`_id` 只給「先配好 id 再寫入」的內部流程用(受管定義的安裝紀錄要在第一筆寫入前
 * 記下 id,中斷後才認得出自己建的那一筆);一般呼叫端不給,由 Mongoose 產生。
 */
export type RepositoryCreate<TSchema> = Partial<TSchema> & {
  _id?: Types.ObjectId;
};

/**
 * 交易的 session(`TransactionService.withTransaction` 給的)。沒帶(`undefined`)時用目前進行中交易的
 * session,不在交易內就是一般讀寫;明給 `null` = 刻意在交易外讀寫(如共用快取的載入,不該看到、
 * 也不該被綁在某個請求尚未提交的交易上)。租戶保底、資料範圍規則與 session 無關,一律照套。
 */
export interface SessionOptions {
  session?: ClientSession | null;
}

export interface FindOptions extends SessionOptions {
  /** 連軟刪除的資料一起查(ADR-0007);預設排除。 */
  includeDeleted?: boolean;
  /**
   * 投影;預設排除的欄位(如加密個資,ADR-0007)需在此明確以 `+欄位` 請求才回傳。
   * 物件形式給陣列投影用(如 `{ revisions: { $slice: -1 } }`,只取最後一筆)。
   */
  select?: string | Record<string, unknown>;
  /** 排序(如 `{ createdAt: -1 }`);分頁清單要有穩定順序才不會漏筆 / 重複。 */
  sort?: Record<string, 1 | -1>;
  /** 跳過筆數(分頁:`(page - 1) * pageSize`)。 */
  skip?: number;
  /** 取回上限(分頁:`pageSize`)。 */
  limit?: number;
}

/** 條件更新的額外選項。 */
export interface UpdateOptions extends SessionOptions {
  /** 陣列元素的篩選(`$[識別名]` 指到哪幾個元素;Mongo `arrayFilters`)。 */
  arrayFilters?: Record<string, unknown>[];
}

/** 搬家(`reassignOrg`)的選項。 */
export interface ReassignOrgOptions<TSchema> extends UpdateOptions {
  /**
   * 同一次寫入順便改的其他欄位(例:狀態、`$inc` 版本);欄位保護與 `findOneAndUpdate` 相同
   * (不得碰 `orgId` / `tenantId` / 建立資訊)。
   */
  update?: RepositoryUpdate<TSchema>;
}

/** 批次搬家(`reassignOrgMany`)的選項。 */
export interface ReassignOrgManyOptions<TSchema> extends SessionOptions {
  /**
   * 各筆自己的條件(id 字串 → 條件,例:各自的版本 `{ editVersion: 3 }`);沒列的那筆只照選取條件。
   * 列了卻不在這批(看不到、不存在、不符選取條件)的 id 也算不符。
   */
  expected?: Readonly<Record<string, RepositoryFilter<TSchema>>>;
  /** 每一筆同一次寫入順便改的其他欄位;欄位保護同 `reassignOrg`(不得碰 `orgId` / `tenantId` / 建立資訊)。 */
  update?: RepositoryUpdate<TSchema>;
}

/** `bulkUpdateByIds` 的一筆:哪一筆、怎麼改、這一筆自己的條件。 */
export interface BulkUpdateByIdItem<TSchema> {
  id: Types.ObjectId | string;
  /** 只收 `$set` / `$unset` / `$inc`(見 `bulkUpdateByIds`)。 */
  update: RepositoryUpdate<TSchema>;
  /** 這一筆自己的條件(例:樂觀鎖版本 `{ editVersion: 3 }`、狀態);沒給 = 只看 id 與範圍。 */
  filter?: RepositoryFilter<TSchema>;
}

/** 批次搬家的結果:`mismatched` 非空 = **整批沒有寫入**(`moved` / `skipped` 為空)。 */
export interface ReassignOrgManyResult {
  /** 這次搬過去的 id。 */
  moved: Types.ObjectId[];
  /** 已經在目標組織、跳過的 id(冪等)。 */
  skipped: Types.ObjectId[];
  /** 不符的 id(字串,照呼叫端給的):id 清單裡看不到 / 不存在 / 已刪除 / 不是合法 id 的,或不符 `expected` 條件的。 */
  mismatched: string[];
}

/**
 * 所有資料存取的共用層(ADR-0005 / ADR-0007 / ADR-0011):
 * 每個公開方法都以操作者上下文開頭 — 租戶過濾、軟刪除排除、基礎欄位填寫全由 plugin 依此自動完成,
 * 個別功能不自己寫、也繞不過(api 內裸 `Model.xxx()` 由 ESLint 規則 `@repo/no-raw-model-query` 擋下)。
 * 刪除一律走 `softDeleteById` / `softDeleteMany`(ADR-0007);硬刪除只有 `hardDeleteById`(撤銷開通、退役權限清理)與
 * `hardDeleteDraft`(從未對外生效的版本草稿,見該方法)。
 */
export class BaseRepository<TSchema, TDocument extends RepositoryDocument> {
  constructor(protected readonly model: RepositoryModel<TSchema, TDocument>) {
    // 核心關聯只能經 RelationService 的具名包裝(ADR-0001);不讓 BaseRepository 成為第二個入口
    if (model.collection.collectionName === CORE_RELATIONSHIPS_COLLECTION) {
      throw new TenantScopeError(
        `${model.modelName}:核心關聯不經 BaseRepository,請改用 RelationService(ADR-0001)`,
      );
    }
    // 業務關聯以 tenantId 為邊界、不掛 tenantScope;只能經強制帶 tenantId 的專屬 repository
    if (model.collection.collectionName === BUSINESS_RELATIONSHIPS_COLLECTION) {
      throw new TenantScopeError(
        `${model.modelName}:業務關聯不經 BaseRepository,請改用 BusinessRelationshipsRepository`,
      );
    }
    // 流程與審核任務同樣以 tenantId 為邊界、不掛 tenantScope;只能經各自的專屬 repository
    const tenantBoundRepositories: Record<string, string> = {
      [WORKFLOWS_COLLECTION]: "WorkflowsRepository",
      [WORKFLOW_TASKS_COLLECTION]: "WorkflowTasksRepository",
    };
    const dedicated = tenantBoundRepositories[model.collection.collectionName];
    if (dedicated !== undefined) {
      throw new TenantScopeError(
        `${model.modelName}:以 tenantId 為邊界的表不經 BaseRepository,請改用 ${dedicated}`,
      );
    }
  }

  /** 這個 repository 實際綁的 model 名(只讀識別;資料登記用它驗證沒有錯綁,不暴露 Model)。 */
  get modelName(): string {
    return this.model.modelName;
  }

  /** 這個 repository 實際讀寫的 collection 名(只讀識別,同上)。 */
  get collectionName(): string {
    return this.model.collection.collectionName;
  }

  /** schema 上的租戶範圍宣告(只讀;lookup 登記據此驗證共用篩選,不暴露 Model)。 */
  get tenantScope(): TenantScope | undefined {
    return getTenantScope(this.model.schema);
  }

  async findMany(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema> = {},
    options: FindOptions = {},
  ): Promise<Persisted<TDocument>[]> {
    // sort / skip / limit 是同一個 Query 實例上的鏈式設定,不會換掉 scopeQuery 掛上的上下文
    const query = scopeQuery(this.model.find({ ...filter }, options.select), {
      operator,
      includeDeleted: options.includeDeleted,
    }).session(sessionOf(options));
    if (options.sort) {
      query.sort(options.sort);
    }
    if (options.skip !== undefined) {
      query.skip(options.skip);
    }
    if (options.limit !== undefined) {
      query.limit(options.limit);
    }
    const documents = await query.exec();
    return documents as Persisted<TDocument>[];
  }

  /**
   * 讀一筆。`sort` / `skip` 照套(多筆符合時依排序取第一筆,例:最近一次售出 `{ at: -1 }`);
   * `limit` 對單筆讀取沒有意義,忽略。
   */
  async findOne(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    options: FindOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    // 同 `findMany`:鏈式設定在同一個 Query 實例上,不會換掉 scopeQuery 掛上的上下文
    const query = scopeQuery(
      this.model.findOne({ ...filter }, options.select),
      { operator, includeDeleted: options.includeDeleted },
    ).session(sessionOf(options));
    if (options.sort) {
      query.sort(options.sort);
    }
    if (options.skip !== undefined) {
      query.skip(options.skip);
    }
    const document = await query.exec();
    return document as Persisted<TDocument> | null;
  }

  findById(
    operator: OperatorContext,
    id: Types.ObjectId | string,
    options: FindOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    return this.findOne(operator, { _id: id }, options);
  }

  /**
   * 讀**操作者自己建立**的一筆:可見範圍照套,但不套資料範圍規則(ADR-0008),條件改成
   * `createdBy = 操作者`(由插件加上,呼叫端無法放寬)。只給「建立者一律讀得到自己的單」這種
   * 單筆讀取用(表單提交);列表不得使用。
   */
  findOwnById(
    operator: OperatorContext,
    id: Types.ObjectId | string,
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    return this.findOwnOne(operator, { _id: id }, options);
  }

  /** 同 `findOwnById`,以條件找(如 `(createdBy, clientRequestId)` 的冪等重試)。 */
  async findOwnOne(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    options: Pick<FindOptions, "includeDeleted" | "select" | "session"> = {},
  ): Promise<Persisted<TDocument> | null> {
    if (operator.actorId === null) {
      return null;
    }
    const document = await scopeQuery(
      this.model.findOne(
        { ...filter, createdBy: operator.actorId },
        options.select,
      ),
      {
        operator,
        ownRecordsOnly: true,
        includeDeleted: options.includeDeleted,
      },
    )
      .session(sessionOf(options))
      .exec();
    return document as Persisted<TDocument> | null;
  }

  /**
   * 條件更新**操作者自己建立**的一筆(範圍同 `findOwnById`:可見範圍照套、不套資料範圍規則)。
   * 用途:草稿只屬於建立者,資料範圍規則把草稿擋在列表外時,建立者仍要能存 / 送 / 刪自己的草稿。
   */
  async findOwnAndUpdate(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    update: RepositoryUpdate<TSchema>,
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    if (operator.actorId === null) {
      return null;
    }
    const shared = await this.prepareUpdate(operator, filter, update, options);
    const document = await scopeQuery(
      this.model.findOneAndUpdate(
        { ...shared.filter, createdBy: operator.actorId },
        update,
        { returnDocument: "after", runValidators: true },
      ),
      { operator, ownRecordsOnly: true },
    )
      .session(sessionOf(options))
      .exec();
    return document as Persisted<TDocument> | null;
  }

  count(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema> = {},
    options: FindOptions = {},
  ): Promise<number> {
    return scopeQuery(this.model.countDocuments({ ...filter }), {
      operator,
      includeDeleted: options.includeDeleted,
    })
      .session(sessionOf(options))
      .exec();
  }

  /**
   * **存在性檢查**:某個組織名下是否還有任何一筆(不含已軟刪除)。**不套資料範圍規則**
   * (ADR-0008)——刪組織、撤銷開通這類前置檢查問的是「有沒有」,必須 fail-closed,
   * 不能被規則收窄成「你看不看得到」。租戶過濾仍由中介層依 `operator` 套上。
   *
   * 條件只能是歸屬欄(`ownerField` = `orgId` / `ownerOrgId`)等於某個組織,呼叫端無法帶任意條件;
   * 只回有無,不回筆數或文件。列表、詳情、要顯示給人看的筆數一律用 `findMany` / `findOne` / `count`。
   * 呼叫端登記在 `EXISTS_ANY_CALLERS`(ADR-0005「例外出口」),由測試鎖定。
   */
  async existsAny(
    operator: OperatorContext,
    ownerField: "orgId" | "ownerOrgId",
    orgId: Types.ObjectId,
    options: SessionOptions = {},
  ): Promise<boolean> {
    const filter = { [ownerField]: orgId } as RepositoryFilter<TSchema>;
    const found = await scopeQuery(this.model.countDocuments(filter).limit(1), {
      operator,
      existenceCheck: true,
    })
      .session(sessionOf(options))
      .exec();
    return found > 0;
  }

  /**
   * **租戶內存在性檢查**(ADR-0005「例外出口」):在**整個租戶**內問「有沒有符合條件的一筆」——
   * 租戶內唯一(證號、代碼)、「這個組織是否已被占用」這類問的是整個租戶,不是操作者看得到的那一部分。
   *
   * - `tenantId` 必填(租戶頂層 ObjectId),沒給 / 給錯型別 → `TenantScopeError`;可見範圍不是 `"all"`
   *   的操作者,`tenantId` 必須是自己所屬的租戶(`memberTenants`),否則同樣拋錯
   * - 條件只能是**欄位等於值**的組合(`equals` = `{ 欄位路徑: 純量 / ObjectId / Date / null }`,
   *   例:同一家分店內名稱唯一 `{ orgId, name }`),不收運算子物件;plugin 另釘 `tenantId`
   * - 不套可見範圍、共用與**資料範圍規則**;軟刪除照常排除
   * - 只回有無,不回筆數或文件;只給有 `tenantId` 的模組資料表
   * - 呼叫端登記在 `TENANT_BOUNDARY_CALLERS`,由測試掃 src 鎖定
   */
  async existsInTenant(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    equals: Readonly<Record<string, unknown>>,
    options: SessionOptions = {},
  ): Promise<boolean> {
    const boundary = this.tenantBoundaryOf(operator, tenantId);
    const filter = equalityFilterOf(this.model.modelName, equals);
    const found = await scopeQuery(this.model.countDocuments(filter).limit(1), {
      operator,
      tenantBoundary: boundary,
    })
      .session(sessionOf(options))
      .exec();
    return found > 0;
  }

  /**
   * **租戶內引用名稱**(ADR-0005「例外出口」):「看得到這筆就看得到它引用的名稱」——
   * 明列 id、只回 schema 宣告的 `refFields`(`tenantScopePlugin` 選項)與 `_id`。
   * 規則同 `existsInTenant`:`tenantId` 必填且是操作者所屬的租戶、不套可見範圍 / 共用 / 資料範圍規則、
   * 軟刪除照常排除;呼叫端同樣登記在 `TENANT_BOUNDARY_CALLERS`。
   * 表沒宣告 `refFields` → `TenantScopeError`(這張表不提供這個出口)。
   */
  async findRefsInTenant(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    ids: readonly (Types.ObjectId | string)[],
    options: SessionOptions = {},
  ): Promise<TenantRef[]> {
    const boundary = this.tenantBoundaryOf(operator, tenantId);
    const refFields = getTenantScope(this.model.schema)?.refFields ?? [];
    if (refFields.length === 0) {
      throw new TenantScopeError(
        `${this.model.modelName}:沒有宣告 refFields,不提供租戶內引用名稱出口`,
      );
    }
    const objectIds = ids
      .map(String)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length === 0) {
      return [];
    }
    return scopeQuery(
      this.model
        .find({ _id: { $in: objectIds } }, refFields.join(" "))
        .lean<TenantRef[]>(),
      { operator, tenantBoundary: boundary },
    )
      .session(sessionOf(options))
      .exec();
  }

  /**
   * aggregate:plugin 在 pipeline 最前面放同一套讀取條件(可見範圍 + 共用 + 資料範圍規則 + 軟刪除)。
   * 會讀別張表或寫出的階段(`$lookup` / `$unionWith` / `$graphLookup` / `$out` / `$merge`)一律拒收 ——
   * 那些表的範圍不歸這支 repository 管。
   * `allowDiskUse`:排序 / 分組的資料量可能超過記憶體上限時讓 Mongo 用暫存檔(例:報表從現況往回推)。
   */
  async aggregate(
    operator: OperatorContext,
    pipeline: readonly Record<string, unknown>[],
    options: Pick<FindOptions, "includeDeleted" | "session"> & {
      allowDiskUse?: boolean;
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const forbidden = forbiddenStageIn(pipeline);
    if (forbidden !== undefined) {
      throw new TenantScopeError(
        `${this.model.modelName}:aggregate 不得使用 ${forbidden}(會讀寫範圍外的表)`,
      );
    }
    const query = scopeAggregate(
      this.model.aggregate<Record<string, unknown>>(
        pipeline as unknown as PipelineStage[],
      ),
      { operator, includeDeleted: options.includeDeleted },
    ).session(sessionOf(options));
    if (options.allowDiskUse === true) {
      query.allowDiskUse(true);
    }
    return query.exec();
  }

  /**
   * 建立資料:租戶資料自動寫入當前組織(ADR-0005),且不可寫入可見範圍外的組織。
   * 模組資料表(`moduleData`)另由後端推導 `tenantId`,呼叫端給的值一律忽略。
   */
  async create(
    operator: OperatorContext,
    data: RepositoryCreate<TSchema>,
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument>> {
    const session = sessionOf(options);
    const document = new this.model(
      await this.withShareOrgs(
        await this.withModuleTenant(
          this.withTenantOrg(operator, data),
          session,
        ),
        session,
      ),
    );
    document.$locals[OPERATOR_LOCAL_KEY] = operator;
    await document.save({ session });
    return document as Persisted<TDocument>;
  }

  /**
   * 依 id 更新;可見範圍外或已軟刪除的資料視為不存在(回 null)。回傳更新後的文件。
   * update 不得觸及 orgId(否則可把資料搬進別的租戶)與建立資訊(createdBy / createdAt)。
   */
  async updateById(
    operator: OperatorContext,
    id: Types.ObjectId | string,
    update: RepositoryUpdate<TSchema>,
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    const shared = await this.prepareUpdate(
      operator,
      { _id: id },
      update,
      options,
    );
    const document = await scopeQuery(
      this.model.findOneAndUpdate(shared.filter, update, {
        returnDocument: "after",
        runValidators: true,
      }),
      { operator },
    )
      .session(sessionOf(options))
      .exec();
    return document as Persisted<TDocument> | null;
  }

  /**
   * **條件更新**:更新第一筆符合 `filter` 的資料並回傳更新後的文件,沒有符合者回 null。
   * 用途是樂觀鎖與搶鎖(「`editVersion` 還是我讀到的那個才寫」「草稿還在 draft 才改成 publishing」):
   * 條件與更新在同一次寫入裡判斷,兩個請求同時來只有一個會命中。欄位保護與範圍與 `updateById` 相同。
   *
   * `options.arrayFilters`:更新陣列裡**特定元素**時用(`steps.$[cur].decisions` 配
   * `[{ "cur.stepKey": k }]`;流程實例的決定原子寫入)。
   */
  async findOneAndUpdate(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    update: RepositoryUpdate<TSchema>,
    options: UpdateOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    const shared = await this.prepareUpdate(operator, filter, update, options);
    const document = await scopeQuery(
      this.model.findOneAndUpdate({ ...shared.filter }, update, {
        returnDocument: "after",
        runValidators: true,
        ...(options.arrayFilters === undefined
          ? {}
          : { arrayFilters: options.arrayFilters }),
      }),
      { operator },
    )
      .session(sessionOf(options))
      .exec();
    return document as Persisted<TDocument> | null;
  }

  /**
   * 批次更新可見範圍內符合條件的資料,回傳實際更新筆數;欄位保護與 `updateById` 相同。
   * 用途如「作廢該帳號全部 refresh token」這類同時對多筆做同一變更的操作。
   */
  async updateMany(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    update: RepositoryUpdate<TSchema>,
    options: UpdateOptions = {},
  ): Promise<number> {
    const shared = await this.prepareUpdate(operator, filter, update, options);
    const { modifiedCount } = await scopeQuery(
      this.model.updateMany({ ...shared.filter }, update, {
        runValidators: true,
        ...(options.arrayFilters === undefined
          ? {}
          : { arrayFilters: options.arrayFilters }),
      }),
      { operator },
    )
      .session(sessionOf(options))
      .exec();
    return modifiedCount;
  }

  /** 軟刪除(ADR-0007):寫入 deletedAt,之後預設查詢視為不存在;已刪除者再刪回 null。 */
  softDeleteById(
    operator: OperatorContext,
    id: Types.ObjectId | string,
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    return this.updateById(
      operator,
      id,
      { $set: { deletedAt: new Date() } },
      options,
    );
  }

  /**
   * **一次軟刪多筆**(TX-06):一次 `updateMany` 寫入 `deletedAt`,範圍與 `softDeleteById` 相同(租戶過濾、
   * 資料範圍規則、已刪除的視為不存在都由中介層套上)。重複的 id 只算一次。
   *
   * 刪到的筆數與 id 數不符(有幾筆不存在 / 已刪除 / 範圍外)→ 拋 `CONFLICT`(`writeCountConflictError`),
   * 交易回復已刪的那幾筆(TX-04 / TX-06)。所以**必須在交易內**(不在交易內 → `TenantScopeError`);
   * 空清單不送指令。
   */
  async softDeleteMany(
    operator: OperatorContext,
    ids: readonly (Types.ObjectId | string)[],
    options: SessionOptions = {},
  ): Promise<void> {
    assertInTransaction(this.model.modelName, "softDeleteMany", options);
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) {
      return;
    }
    const deleted = await this.updateMany(
      operator,
      { _id: { $in: unique } },
      { $set: { deletedAt: new Date() } },
      options,
    );
    if (deleted !== unique.length) {
      throw writeCountConflictError(
        `${this.model.modelName}:要刪 ${String(unique.length)} 筆,只刪到 ${String(deleted)} 筆`,
      );
    }
  }

  /**
   * **寫入範圍的條件**(可見範圍 + 資料範圍規則,不含共用分支;與寫入中介層同一份判斷 `writeScopeConditionsOf`),
   * 給「先讀再整批寫回」的呼叫端併進讀取條件:讀到的就是寫得到的,唯讀共用過來的那幾筆不會讀進來,
   * 也不會讓整批寫回因筆數不符而失敗。只能把讀取收窄,不會放寬(讀取中介層的條件照樣套)。
   */
  async writableFilterOf(
    operator: OperatorContext,
  ): Promise<RepositoryFilter<TSchema>> {
    const conditions = await writeScopeConditionsOf(this.model.schema, {
      operator,
    });
    return (
      conditions.length === 0 ? {} : { $and: conditions }
    ) as RepositoryFilter<TSchema>;
  }

  /**
   * **依 id 一次更新多筆、每筆的值不同**(TX-06「每筆要改的值不同」):底層一次 ordered `bulkWrite`,
   * 每筆一個 `updateOne`。值都相同的一組用 `updateMany`;這個出口給依值分組會變成一筆一組的情形
   * (例:每筆各自的時間、各自的版本)。
   *
   * - 範圍與 `updateById` 相同:每筆條件都釘上 `_id`、`deletedAt: null`、寫入範圍(可見範圍 + 資料範圍規則,
   *   與寫入中介層同一份判斷 `writeScopeConditionsOf`;`bulkWrite` 不經查詢中介層,所以在這裡自己帶),
   *   另可帶這一筆自己的條件 `filter`(樂觀鎖版本、狀態,TX-05)。`updatedBy` 由這裡填,`updatedAt` 由 timestamps 填
   * - 欄位保護與 `updateById` 相同(不得碰 `orgId` / 建立資訊 / 模組資料表的 `moduleKey`、`tenantId`);
   *   另外只收 `$set` / `$unset` / `$inc` / `$push`(`$push` 只收單一元素或 `$each`),不收 `shareOrgs`
   *   (共用清單改用 `updateById` / `updateMany`)、不收 pipeline、位置運算子、`arrayFilters`、`$pull`。
   *   `$set` / `$unset` / `$push` 的值照 schema 驗證(`bulkWrite` 不跑 `runValidators`,在這裡先驗)
   * - 同一個 id 在同一批出現兩次 → `TenantScopeError`(依出現順序分輪,TX-06)
   * - 每一筆都要命中(以 `matchedCount` 判,值沒變的列也算命中,不會被誤判成衝突);有不符 → 拋 `CONFLICT`
   *   (同 `softDeleteMany`),交易回復已寫的那幾筆;所以**必須在交易內**
   * - `audit_logs` 不能用(只增不改的守門掛在查詢中介層上,`bulkWrite` 會繞過)
   */
  async bulkUpdateByIds(
    operator: OperatorContext,
    items: readonly BulkUpdateByIdItem<TSchema>[],
    options: SessionOptions = {},
  ): Promise<void> {
    assertInTransaction(this.model.modelName, "bulkUpdateByIds", options);
    if (this.model.modelName === AuditLog.name) {
      throw new TenantScopeError(
        `${this.model.modelName}:稽核紀錄只增不改,不能經 bulkUpdateByIds`,
      );
    }
    if (items.length === 0) {
      return;
    }
    const seen = new Set<string>();
    const protectedPaths = this.protectedUpdatePaths();
    for (const item of items) {
      const key = String(item.id);
      if (seen.has(key)) {
        throw new TenantScopeError(
          `${this.model.modelName}:bulkUpdateByIds 同一批不得重複同一個 id(${key});依出現順序分輪`,
        );
      }
      seen.add(key);
      assertBulkUpdateShape(this.model.modelName, item.update);
      assertUpdateLeavesProtectedPaths(this.model.modelName, item.update, [
        ...protectedPaths,
        SHARE_ORGS_PATH,
      ]);
      await this.validateUpdateValues(item.update);
    }
    const conditions = await writeScopeConditionsOf(this.model.schema, {
      operator,
    });
    const operations = items.map((item) => ({
      updateOne: {
        filter: {
          $and: [
            { _id: item.id },
            { ...item.filter },
            { deletedAt: null },
            ...conditions,
          ],
        },
        update: {
          ...item.update,
          $set: {
            ...item.update.$set,
            updatedBy: operator.actorId,
          },
        },
      },
    }));
    const { matchedCount } = await this.model.bulkWrite(
      operations as unknown as Parameters<
        RepositoryModel<TSchema, TDocument>["bulkWrite"]
      >[0],
      { ordered: true, session: sessionOf(options) ?? undefined },
    );
    if (matchedCount !== items.length) {
      throw writeCountConflictError(
        `${this.model.modelName}:要改 ${String(items.length)} 筆,只命中 ${String(matchedCount)} 筆`,
      );
    }
  }

  /**
   * **硬刪除**:把一筆文件從資料庫抹掉,回傳是否真的刪到(ADR-0007 軟刪除的例外)。
   *
   * 為什麼需要它:撤銷開通(ADR-0009)要把開通建出的組織、角色副本、首任管理員「當作沒發生過」——
   * 軟刪除幫不上忙,`users` 的 account / email 唯一索引**含已軟刪除的文件**,留一筆殭屍會讓同一組帳號 /
   * Email 永遠再也開不了;退役權限清理同理(權限 key 全域唯一)。多步驟寫入的失敗回復一律由交易負責
   * (ADR-0013),不再用它做補償刪除。
   *
   * **只准用在 ADR-0007 列出的用途**:使用者要刪的資料一律 `softDeleteById`。
   * 租戶過濾與 `deletedAt` 一樣由 plugin 套上(`includeDeleted` 讓半途已被標記刪除的也刪得掉)。
   */
  async hardDeleteById(
    operator: OperatorContext,
    id: Types.ObjectId | string,
    options: SessionOptions = {},
  ): Promise<boolean> {
    const { deletedCount } = await scopeQuery(
      this.model.deleteOne({ _id: id }),
      { operator, includeDeleted: true },
    )
      .session(sessionOf(options))
      .exec();
    return deletedCount > 0;
  }

  /**
   * **條件硬刪一份版本草稿**(ADR-0007 第三種硬刪):條件與刪除在同一次寫入裡判斷(兩個請求同時來只有
   * 一個刪得到),回被刪的文件、沒命中回 null。租戶過濾與軟刪除排除照常由 plugin 套上。
   *
   * 型別上強制條件帶 `status: "draft"` 與 `version: null` —— 只刪得到從未發布、沒有引用的草稿
   * (`form_versions` / `workflow_versions`);刪之前的內容由呼叫端寫進稽核的 `before`。
   * 其餘資料一律 `softDeleteById`。
   */
  async hardDeleteDraft(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema> & { status: "draft"; version: null },
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument> | null> {
    const document = await scopeQuery(
      this.model.findOneAndDelete({ ...filter }),
      { operator },
    )
      .session(sessionOf(options))
      .exec();
    return document as Persisted<TDocument> | null;
  }

  /**
   * **一次寫多筆**(ADR-0005「例外出口」表的 `createMany`):每一筆的檢查與 `create` 相同 ——
   * 歸屬組織在可見範圍內(缺席 = 當前組織)、模組資料表推導 `tenantId` 並帶 `moduleKey`、可共用的表驗
   * `shareOrgs`(別租戶 → `VALIDATION_FAILED`)、基礎欄位填操作者。任何一筆沒過就整批不寫(先全部檢查完才寫入)。
   *
   * **必須在交易內**(`TransactionService.withTransaction`,或明給進行中交易的 session):底層是 ordered
   * `insertMany`,寫到一半撞到唯一索引時要靠交易回復前面已寫的,不在交易內 → `TenantScopeError`。
   * 同一個組織的租戶推導與同一份共用清單的檢查只查一次(1,000 筆不必查 1,000 次組織)。
   *
   * **schema 自訂了 `pre("save")` 的表不要用**:`insertMany` 不跑 save 中介層,那些 hook 不會執行
   * (基礎欄位的建立者 / 更新者由這裡自己填;租戶 plugin 的 save hook 只擋「更新既有文件」,新建不受影響)。
   */
  async createMany(
    operator: OperatorContext,
    data: readonly RepositoryCreate<TSchema>[],
    options: SessionOptions = {},
  ): Promise<Persisted<TDocument>[]> {
    const session = sessionOf(options);
    if (session?.inTransaction() !== true) {
      throw new TenantScopeError(
        `${this.model.modelName}:createMany 必須在交易內(一筆失敗整批不寫)`,
      );
    }
    if (data.length === 0) {
      return [];
    }
    const shareable =
      getTenantScope(this.model.schema)?.sharing.mode === "shareable";
    const tenants = new Map<string, Promise<Partial<TSchema>>>();
    const shares = new Map<string, Promise<Partial<TSchema>>>();
    const prepared: Partial<TSchema>[] = [];
    for (const item of data) {
      const placed = this.withTenantOrg(operator, item);
      const orgId = (placed as { orgId?: Types.ObjectId | string | null })
        .orgId;
      const orgKey = String(orgId ?? "");
      let tenant = tenants.get(orgKey);
      if (tenant === undefined) {
        tenant = this.withModuleTenant(
          { orgId } as unknown as Partial<TSchema>,
          session,
        );
        tenants.set(orgKey, tenant);
      }
      const derived = await tenant;
      const withTenant =
        "tenantId" in derived
          ? {
              ...placed,
              tenantId: (derived as { tenantId?: unknown }).tenantId,
            }
          : placed;
      if (!shareable) {
        prepared.push(withTenant);
        continue;
      }
      const tenantId =
        (withTenant as { tenantId?: Types.ObjectId | null }).tenantId ?? null;
      const given = (withTenant as Record<string, unknown>)[SHARE_ORGS_PATH];
      const shareKey = `${String(tenantId)}|${JSON.stringify(given ?? null)}`;
      let share = shares.get(shareKey);
      if (share === undefined) {
        share = this.withShareOrgs(
          { tenantId, [SHARE_ORGS_PATH]: given } as unknown as Partial<TSchema>,
          session,
        );
        shares.set(shareKey, share);
      }
      const checked = await share;
      prepared.push({
        ...withTenant,
        [SHARE_ORGS_PATH]: (checked as Record<string, unknown>)[
          SHARE_ORGS_PATH
        ],
      });
    }
    // insertMany 不走 save 中介層:基礎欄位的建立者 / 更新者在這裡填(同 baseFieldsPlugin 的 save)
    const documents = prepared.map((item) => {
      const document = new this.model({
        ...item,
        createdBy: operator.actorId,
        updatedBy: operator.actorId,
      });
      document.$locals[OPERATOR_LOCAL_KEY] = operator;
      return document;
    });
    const inserted = await this.model.insertMany(documents, {
      ordered: true,
      session,
    });
    return inserted as unknown as Persisted<TDocument>[];
  }

  /**
   * **搬家**(ADR-0005「例外出口」;一般更新不准改 `orgId`):把符合 `filter` 的**第一筆**資料改歸屬到
   * `newOrgId`,回更新後的文件;沒有符合(可見範圍外、已刪除、條件不符、同時被搬走)回 null。
   *
   * - 被搬的資料要在操作者的**可見範圍**內(寫入範圍:共用進來、只能看的不算)
   * - 新組織要存在、**同租戶**、不能是根組織,不合法 → `VALIDATION_FAILED`(`fields: ["orgId"]`);
   *   新組織**可以**是操作者看不到的(把資料移給別的分店)
   * - 有 `tenantId` 欄的表照新組織重新推導 `tenantId`(同租戶,值不變)
   * - 條件更新:`filter` 可帶版本 / 狀態等條件;`options.update` 同一次寫入順便改其他欄位
   * - 寫一筆稽核(`data.reassign-org`:誰、哪張表哪一筆、從哪個組織搬到哪個組織),與搬家同一個 session
   * - **必須在交易內**(搬家與稽核要一起成功或一起回復),不在交易內 → `TenantScopeError`
   * - 已經在新組織(搬到原本所在的組織):冪等,不寫入、不記稽核,直接回那一筆
   * - 呼叫端登記在 `ORG_REASSIGN_CALLERS`(底座)/ `PROJECT_ORG_REASSIGN_CALLERS`(專案),由測試掃 src 鎖定
   */
  async reassignOrg(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    newOrgId: Types.ObjectId | string,
    options: ReassignOrgOptions<TSchema> = {},
  ): Promise<Persisted<TDocument> | null> {
    if (getTenantScope(this.model.schema)?.path !== "orgId") {
      throw new TenantScopeError(
        `${this.model.modelName}:搬家只給以 orgId 歸屬的租戶資料`,
      );
    }
    const actorId = operator.actorId;
    if (actorId === null) {
      throw new TenantScopeError(
        `${this.model.modelName}:搬家要寫稽核,需要操作者`,
      );
    }
    const session = sessionOf(options);
    if (session?.inTransaction() !== true) {
      throw new TenantScopeError(
        `${this.model.modelName}:reassignOrg 必須在交易內(搬家與稽核一起成功或一起回復)`,
      );
    }
    const extra: RepositoryUpdate<TSchema> = options.update ?? {};
    const shared = await this.prepareUpdate(operator, filter, extra, options);
    const target = await reassignTargetOf(this.model.db, newOrgId, session);
    const found = await scopeQuery(this.model.findOne({ ...shared.filter }), {
      operator,
    })
      .session(session)
      .exec();
    if (!found) {
      return null;
    }
    const current = found as Persisted<TDocument> & {
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
    };
    const fromOrgId = current.orgId;
    const fromTenant = await currentTenantOf(
      this.model.db,
      this.model.modelName,
      fromOrgId,
      session,
    );
    if (fromTenant?.equals(target.tenantId) !== true) {
      throw orgReassignValidationError(
        "data can only be moved to an org of the same tenant",
      );
    }
    if (fromOrgId.equals(target.orgId)) {
      // 已經在那裡:冪等,不寫入、不記稽核(重送同一個搬家請求不會多一筆稽核)
      return current;
    }
    const moved: Record<string, unknown> = {
      orgId: target.orgId,
      ...(Object.hasOwn(this.model.schema.paths, "tenantId")
        ? { tenantId: target.tenantId }
        : {}),
    };
    const { $set: extraSet, ...extraRest } = extra as Record<string, unknown>;
    const update = {
      ...extraRest,
      $set: { ...(extraSet as Record<string, unknown> | undefined), ...moved },
    } as RepositoryUpdate<TSchema>;
    const document = await scopeQuery(
      this.model.findOneAndUpdate(
        {
          $and: [{ ...shared.filter }, { _id: current._id, orgId: fromOrgId }],
        },
        update,
        {
          returnDocument: "after",
          runValidators: true,
          ...(options.arrayFilters === undefined
            ? {}
            : { arrayFilters: options.arrayFilters }),
        },
      ),
      { operator },
    )
      .session(session)
      .exec();
    if (!document) {
      return null;
    }
    await this.auditLogs().create(
      operator,
      {
        actorId,
        actorType: "user",
        action: ORG_REASSIGN_AUDIT_ACTION,
        targetType: this.model.collection.collectionName,
        targetId: current._id,
        before: { orgId: fromOrgId },
        after: { orgId: target.orgId },
      },
      { session },
    );
    return document as Persisted<TDocument>;
  }

  /**
   * **批次搬家**(同 `reassignOrg` 的例外出口,一次搬多筆):把 `target` 選到的資料改歸屬到 `newOrgId`。
   * `target` = id 清單,或選取條件(可見範圍內符合的全部)。
   *
   * - 規則同 `reassignOrg`:必須在交易內、要有操作者、被搬的在可見範圍內(寫入範圍)、新組織同租戶且不是根組織
   *   (可以是操作者看不到的)、有 `tenantId` 欄的照新組織重推、`options.update` 欄位保護照擋
   * - 目標組織查一次、來源組織的租戶一次查完(不逐筆查)
   * - **全有或全無**:先在交易內逐筆核對(id 清單裡看不到 / 不存在的、不符 `options.expected` 各自條件的),
   *   任何一筆不符 → 不寫入、回 `mismatched`;都符合才以一次條件更新寫入(每筆帶自己的條件),
   *   寫入筆數與核對結果不同(核對後被別人改了)→ `CONFLICT`(`EDIT_VERSION_MISMATCH`,前端照「已被別人更新」處理),呼叫端的交易整個回復
   * - 已經在新組織的跳過(`skipped`,冪等);全部跳過 → 不寫入、不記稽核
   * - 只寫**一筆**稽核(`data.reassign-org`:`before.orgIds` = 來源組織、`after` = 新組織 + id 清單 + 筆數)
   * - 呼叫端登記與 `reassignOrg` 同一份清單(`ORG_REASSIGN_CALLERS` / `PROJECT_ORG_REASSIGN_CALLERS`)
   */
  async reassignOrgMany(
    operator: OperatorContext,
    target: readonly (Types.ObjectId | string)[] | RepositoryFilter<TSchema>,
    newOrgId: Types.ObjectId | string,
    options: ReassignOrgManyOptions<TSchema> = {},
  ): Promise<ReassignOrgManyResult> {
    if (getTenantScope(this.model.schema)?.path !== "orgId") {
      throw new TenantScopeError(
        `${this.model.modelName}:搬家只給以 orgId 歸屬的租戶資料`,
      );
    }
    const actorId = operator.actorId;
    if (actorId === null) {
      throw new TenantScopeError(
        `${this.model.modelName}:搬家要寫稽核,需要操作者`,
      );
    }
    const session = sessionOf(options);
    if (session?.inTransaction() !== true) {
      throw new TenantScopeError(
        `${this.model.modelName}:reassignOrgMany 必須在交易內(整批與稽核一起成功或一起回復)`,
      );
    }
    const extra: RepositoryUpdate<TSchema> = options.update ?? {};
    const { requested, selection } = batchSelectionOf(target);
    const shared = await this.prepareUpdate(
      operator,
      selection,
      extra,
      options,
    );
    const destination = await reassignTargetOf(
      this.model.db,
      newOrgId,
      session,
    );
    const candidates = await this.leanIds<{
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
    }>(operator, shared.filter, { _id: 1, orgId: 1 }, session);
    const expected = options.expected ?? {};
    const mismatched = await this.batchMismatchesOf(
      operator,
      shared.filter,
      session,
      { candidates, requested, expected },
    );
    if (mismatched.length > 0) {
      return { moved: [], skipped: [], mismatched };
    }
    const fromOrgIds = uniqueIds(candidates.map((found) => found.orgId));
    const tenants = await currentTenantsOf(
      this.model.db,
      this.model.modelName,
      fromOrgIds,
      session,
    );
    if (
      fromOrgIds.some(
        (orgId) =>
          tenants.get(String(orgId))?.equals(destination.tenantId) !== true,
      )
    ) {
      throw orgReassignValidationError(
        "data can only be moved to an org of the same tenant",
      );
    }
    const skipped = candidates.filter((found) =>
      found.orgId.equals(destination.orgId),
    );
    const toMove = candidates.filter(
      (found) => !found.orgId.equals(destination.orgId),
    );
    if (toMove.length === 0) {
      return {
        moved: [],
        skipped: skipped.map((found) => found._id),
        mismatched: [],
      };
    }
    const moved: Record<string, unknown> = {
      orgId: destination.orgId,
      ...(Object.hasOwn(this.model.schema.paths, "tenantId")
        ? { tenantId: destination.tenantId }
        : {}),
    };
    const { $set: extraSet, ...extraRest } = extra as Record<string, unknown>;
    const update = {
      ...extraRest,
      $set: { ...(extraSet as Record<string, unknown> | undefined), ...moved },
    } as RepositoryUpdate<TSchema>;
    // 一次條件更新、每筆帶自己的條件(id + 核對時的組織 + `expected`):不逐筆來回,也不繞過查詢中介層
    const { modifiedCount } = await scopeQuery(
      this.model.updateMany(
        {
          $and: [
            { ...shared.filter },
            {
              $or: toMove.map((found) => ({
                $and: [
                  { _id: found._id, orgId: found.orgId },
                  ...(expected[String(found._id)] === undefined
                    ? []
                    : [expected[String(found._id)]]),
                ],
              })),
            },
          ],
        } as RepositoryFilter<TSchema>,
        update,
        { runValidators: true },
      ),
      { operator },
    )
      .session(session)
      .exec();
    if (modifiedCount !== toMove.length) {
      throw orgReassignConflictError(
        `${this.model.modelName}: batch reassign expected ${String(toMove.length)} writes but made ${String(modifiedCount)}; changed after the check`,
      );
    }
    const movedIds = toMove.map((found) => found._id);
    await this.auditLogs().create(
      operator,
      {
        actorId,
        actorType: "user",
        action: ORG_REASSIGN_AUDIT_ACTION,
        targetType: this.model.collection.collectionName,
        before: {
          orgIds: uniqueIds(toMove.map((found) => found.orgId)),
        },
        after: {
          orgId: destination.orgId,
          ids: movedIds.map(String),
          count: movedIds.length,
        },
      },
      { session },
    );
    return {
      moved: movedIds,
      skipped: skipped.map((found) => found._id),
      mismatched: [],
    };
  }

  /**
   * `bulkUpdateByIds` 的值驗證(代替 `runValidators`;`bulkWrite` 不跑它):只驗這次寫到的路徑,照 schema 的
   * 型別與驗證器,不合 → Mongoose `ValidationError`(與 `updateById` 撞到驗證器時同一種錯)。
   * - `$set`:驗寫入的值
   * - `$unset`:路徑當成沒有值來驗 —— 必填欄位會被擋下(同 `runValidators` 對 `$unset` 的 required 檢查)
   * - `$push`:把要加的元素(或 `$each` 的元素)當成那個陣列的值來驗
   * - `$inc`:不驗(同 `runValidators`,它本來就不驗 `$inc`)
   *
   * 已知限制(與 `runValidators` 的差異):以 `Model.validate` 驗一個只含這些路徑的物件,所以
   * 需要拿 `this` 當 Query 的自訂驗證器(update validator context)拿不到 Query;
   * 陣列索引路徑(`items.0.x`)可能沒有驗到。用到這兩種的更新改走 `updateById`。
   */
  private async validateUpdateValues(
    update: RepositoryUpdate<TSchema>,
  ): Promise<void> {
    const values = new Map<string, unknown>();
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      values.set(path, value);
    }
    for (const path of Object.keys(update.$unset ?? {})) {
      values.set(path, undefined);
    }
    for (const [path, value] of Object.entries(update.$push ?? {})) {
      values.set(path, pushedElementsOf(value));
    }
    if (values.size === 0) {
      return;
    }
    const expanded: Record<string, unknown> = {};
    for (const [path, value] of values) {
      if (value === undefined) {
        continue;
      }
      const pieces = path.split(".");
      let holder = expanded;
      for (const piece of pieces.slice(0, -1)) {
        const next = holder[piece];
        if (next === null || typeof next !== "object") {
          holder[piece] = {};
        }
        holder = holder[piece] as Record<string, unknown>;
      }
      holder[pieces.at(-1) ?? path] = value;
    }
    await this.model.validate(expanded, [...values.keys()]);
  }

  /** 批次搬家的核對讀取:可見範圍內符合條件的那幾筆,只取指定欄位(lean)。 */
  private async leanIds<TRow>(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    projection: Record<string, 1>,
    session: ClientSession,
  ): Promise<TRow[]> {
    const rows: unknown = await scopeQuery(
      this.model.find({ ...filter }).select(projection),
      { operator },
    )
      .session(session)
      .lean()
      .exec();
    return rows as TRow[];
  }

  /**
   * 批次搬家的不符清單(id 字串):id 清單裡沒選到的(看不到 / 不存在 / 已刪除 / 不是合法 id),
   * 加上 `expected` 列了、卻不符各自條件(或不在這批)的。
   */
  private async batchMismatchesOf(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    session: ClientSession,
    batch: {
      candidates: readonly { _id: Types.ObjectId }[];
      requested: readonly string[] | null;
      expected: Readonly<Record<string, RepositoryFilter<TSchema>>>;
    },
  ): Promise<string[]> {
    const selected = new Set(
      batch.candidates.map((found) => String(found._id)),
    );
    const mismatched = new Set(
      (batch.requested ?? []).filter((id) => !selected.has(id)),
    );
    const expectedIds = Object.keys(batch.expected);
    if (expectedIds.length === 0) {
      return [...mismatched];
    }
    const satisfied = await this.leanIds<{ _id: Types.ObjectId }>(
      operator,
      {
        $and: [
          { ...filter },
          {
            $or: expectedIds.map((id) => ({
              $and: [
                { _id: mongoose.isValidObjectId(id) ? id : null },
                batch.expected[id],
              ],
            })),
          },
        ],
      } as RepositoryFilter<TSchema>,
      { _id: 1 },
      session,
    );
    const satisfiedIds = new Set(satisfied.map((found) => String(found._id)));
    for (const id of expectedIds) {
      if (!satisfiedIds.has(id)) {
        mismatched.add(id);
      }
    }
    return [...mismatched];
  }

  /**
   * 搬家的稽核寫進 `audit_logs`(同一條連線上已註冊的 model;沒註冊 → `TenantScopeError`,不靜默略過)。
   * 經 BaseRepository 寫:稽核的歸屬組織 = 操作者當前組織、建立者 = 操作者,與 `AuditService.record` 同形狀。
   */
  private auditLogs(): BaseRepository<AuditLog, RepositoryDocument> {
    const model = this.model.db.models[AuditLog.name] as
      RepositoryModel<AuditLog, RepositoryDocument> | undefined;
    if (model === undefined) {
      throw new TenantScopeError(
        `${this.model.modelName}:搬家要寫稽核,但連線上沒有 ${AuditLog.name} model`,
      );
    }
    return new BaseRepository(model);
  }

  /**
   * 模組資料表另外鎖住 `moduleKey` / `tenantId`:兩者建立後不可經一般更新改動;
   * 共用清單固定(`editable: false`)的表連 `shareOrgs` 也鎖住。
   */
  private protectedUpdatePaths(): readonly string[] {
    const scope = getTenantScope(this.model.schema);
    return [
      ...PROTECTED_UPDATE_PATHS,
      ...(scope?.moduleData === true ? MODULE_DATA_PROTECTED_PATHS : []),
      ...(scope !== undefined &&
      !scope.moduleData &&
      hasTenantIdPath(this.model.schema, scope)
        ? ["tenantId"]
        : []),
      ...(scope?.sharing.mode === "shareable" && !scope.sharing.editable
        ? [SHARE_ORGS_PATH]
        : []),
    ];
  }

  /**
   * 租戶邊界出口的前置:`tenantId` 必填、表要有 `tenantId` 欄(模組資料表),
   * 而且操作者(可見範圍不是 `"all"` 時)要屬於那個租戶 —— 出口只放寬「自己租戶裡看不到的部分」。
   */
  private tenantBoundaryOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
  ): Types.ObjectId {
    const boundary = assertTenantBoundary(tenantId, this.model.modelName);
    const scope = getTenantScope(this.model.schema);
    if (scope === undefined || !hasTenantIdPath(this.model.schema, scope)) {
      throw new TenantScopeError(
        `${this.model.modelName}:租戶邊界出口只給有 tenantId 欄的表`,
      );
    }
    if (
      operator.visibleOrgIds !== "all" &&
      !operator.memberTenants.some((tenant) => tenant.tenantId.equals(boundary))
    ) {
      throw new TenantScopeError(
        `${this.model.modelName}:租戶邊界出口只能用在操作者所屬的租戶`,
      );
    }
    return boundary;
  }

  /**
   * 更新的共同前置:受保護欄位檢查,加上共用清單(ADR-0014)——
   * `shareOrgs` 只能以 `$set`(或頂層)整份替換;每個組織都要在**同一個租戶**,而且是操作者所屬的租戶
   * (不是 → `VALIDATION_FAILED`);條件另釘 `tenantId = 那個租戶`,資料若在別的租戶就命中不到。
   */
  private async prepareUpdate(
    operator: OperatorContext,
    filter: RepositoryFilter<TSchema>,
    update: RepositoryUpdate<TSchema>,
    options: SessionOptions,
  ): Promise<{ filter: RepositoryFilter<TSchema> }> {
    assertUpdateLeavesProtectedPaths(
      this.model.modelName,
      update,
      this.protectedUpdatePaths(),
    );
    const scope = getTenantScope(this.model.schema);
    if (scope?.sharing.mode !== "shareable") {
      return { filter };
    }
    const container = shareOrgsContainerOf(this.model.modelName, update);
    if (container === null) {
      return { filter };
    }
    const shareOrgs = normalizeShareOrgs(container[SHARE_ORGS_PATH]);
    container[SHARE_ORGS_PATH] = shareOrgs;
    const tenants = await tenantIdsOfShareOrgs(
      this.model.db,
      shareOrgs,
      sessionOf(options),
    );
    const [tenantId] = tenants;
    if (tenantId === undefined) {
      return { filter };
    }
    if (
      tenants.length > 1 ||
      (operator.visibleOrgIds !== "all" &&
        !operator.memberTenants.some((tenant) =>
          tenant.tenantId.equals(tenantId),
        ))
    ) {
      throw shareOrgsValidationError(
        "shareOrgs can only include orgs of the same tenant",
      );
    }
    return {
      filter: { $and: [{ ...filter }, { tenantId }] },
    };
  }

  /**
   * 可共用的表建立時的共用清單:固定(`editable: false`)一律用預設、呼叫端給的忽略;
   * 可編輯時呼叫端沒給才用預設。預設 `wholeTenant` = `[{ 租戶頂層, 含下層 }]`(根組織的資料沒有租戶 → 空)。
   * 清單裡每個組織都要在這筆資料的租戶,否則 `VALIDATION_FAILED`。
   */
  private async withShareOrgs(
    data: Partial<TSchema>,
    session: ClientSession | null,
  ): Promise<Partial<TSchema>> {
    const scope = getTenantScope(this.model.schema);
    if (scope?.sharing.mode !== "shareable") {
      return data;
    }
    const tenantId =
      (data as { tenantId?: Types.ObjectId | null }).tenantId ?? null;
    const given = (data as Record<string, unknown>)[SHARE_ORGS_PATH];
    const shareOrgs: ShareOrg[] =
      scope.sharing.editable && given !== undefined && given !== null
        ? normalizeShareOrgs(given)
        : defaultShareOrgsOf(scope.sharing.defaultShareOrgs, tenantId);
    await assertShareOrgsInTenant(this.model.db, shareOrgs, tenantId, session);
    return { ...data, [SHARE_ORGS_PATH]: shareOrgs };
  }

  /**
   * 模組資料表的 `tenantId`:依 `orgId` 的祖先推導租戶頂層(`tenantIdOfOrg`),
   * 覆蓋呼叫端給的任何值(GraphQL input 本來就不收,這裡再防一次內部呼叫端)。
   *
   * 組織以原生 collection 讀:`orgs` 掛的是治理類過濾(吃管理範圍),而建立業務資料的人
   * 不一定管得到自己寫入的組織;可寫入與否已由 `withTenantOrg` 以可見範圍判過,這裡只取祖先。
   * 讀不到組織 → 拋錯(fail-closed):那是資料損毀,不該靜默寫出一筆沒有租戶邊界的資料。
   */
  private async withModuleTenant(
    data: Partial<TSchema>,
    session: ClientSession | null,
  ): Promise<Partial<TSchema>> {
    const scope = getTenantScope(this.model.schema);
    // 有 tenantId 欄的表(模組資料表,或自己宣告 tenantId 的表)一律由 orgId 推導、覆蓋呼叫端給的值:
    // tenantId 是租戶邊界出口與共用分支的邊界,不能信任呼叫端
    if (scope?.path !== "orgId" || !hasTenantIdPath(this.model.schema, scope)) {
      return data;
    }
    const orgId = (data as { orgId?: Types.ObjectId | string | null }).orgId;
    if (orgId === undefined || orgId === null) {
      throw new TenantScopeError(
        `${this.model.modelName} 有 tenantId 欄,建立時需要所屬組織才能推導 tenantId`,
      );
    }
    const org = await this.model.db
      .collection<{ ancestors?: Types.ObjectId[] }>(ORGS_COLLECTION)
      .findOne(
        { _id: new mongoose.Types.ObjectId(String(orgId)) },
        { projection: { ancestors: 1 }, session: session ?? undefined },
      );
    if (!org) {
      throw new TenantScopeError(
        `${this.model.modelName}:所屬組織 ${String(orgId)} 不存在,無法推導 tenantId`,
      );
    }
    return {
      ...data,
      tenantId: tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors ?? [] }),
    };
  }

  private withTenantOrg(
    operator: OperatorContext,
    data: Partial<TSchema>,
  ): Partial<TSchema> {
    const scope = getTenantScope(this.model.schema);
    // 非租戶資料,或以 _id 判定可見的資料(orgs):沒有 orgId 可填
    if (scope?.path !== "orgId") {
      return data;
    }
    const given = (data as { orgId?: unknown }).orgId;
    const orgId = given === undefined ? operator.currentOrgId : given;
    if (orgId === null) {
      // 全域資料(orgId null)只有根組織可建立
      if (scope.allowGlobal && operator.visibleOrgIds === "all") {
        return { ...data, orgId: null };
      }
      throw new TenantScopeError(
        `${this.model.modelName} 是租戶資料,建立時需要當前組織`,
      );
    }
    if (!isOrgVisible(operator, orgId as string)) {
      throw new TenantScopeError(
        `${this.model.modelName}:不可寫入可見範圍外的組織`,
      );
    }
    return { ...data, orgId };
  }
}

/**
 * **允許呼叫 `existsAny` 的檔案**(相對 `apps/api/src/`;ADR-0005「例外出口」登記的範圍):
 * 只有需要 fail-closed 回答「有沒有」的前置檢查。`exists-any-callers.test.ts` 掃整個 src
 * 斷言沒有其他檔案呼叫它 —— 新增呼叫端要先在 ADR-0005 登記、再加進這裡。
 */
export const EXISTS_ANY_CALLERS: readonly string[] = [
  "database/org-business-data.reader.ts",
];

/**
 * **允許呼叫租戶邊界出口(`existsInTenant` / `findRefsInTenant`)的底座檔案**(相對 `apps/api/src/`;
 * ADR-0005「例外出口」)。專案的呼叫端登記在專案入口 `project/database/tenant-boundary-callers.ts`,不改這份。
 * `exists-any-callers.test.ts` 合併兩份清單掃整個 src 斷言沒有其他檔案呼叫它們 ——
 * 新增呼叫端要先在 ADR-0005 確認用途、再加進對應的清單。
 */
export const TENANT_BOUNDARY_CALLERS: readonly string[] = [];

/**
 * 批次搬家的 `target` → 選取條件:id 清單 → `_id ∈ 清單`(不是合法 id 的略過,核對時算不符),
 * `requested` = 清單的 id 字串;選取條件 → 原樣,`requested` = null。
 */
function batchSelectionOf<TSchema>(
  target: readonly (Types.ObjectId | string)[] | RepositoryFilter<TSchema>,
): { requested: string[] | null; selection: RepositoryFilter<TSchema> } {
  if (!Array.isArray(target)) {
    return { requested: null, selection: target };
  }
  const requested = (target as readonly (Types.ObjectId | string)[]).map(
    String,
  );
  return {
    requested,
    selection: {
      _id: {
        $in: requested
          .filter((id) => mongoose.isValidObjectId(id))
          .map((id) => new mongoose.Types.ObjectId(id)),
      },
    },
  };
}

/** 去重(依 id 字串),保留第一次出現的順序。 */
function uniqueIds(ids: readonly Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Map<string, Types.ObjectId>();
  for (const id of ids) {
    if (!seen.has(String(id))) {
      seen.set(String(id), id);
    }
  }
  return [...seen.values()];
}

/**
 * 明確給的 session(含 `null`)優先,否則用目前進行中交易的;都沒有 → null(一般讀寫)。
 * 一律以明確值交給 Mongoose:交易已結束時,Mongoose 自己的 AsyncLocalStorage 可能還留著那個 session
 * (`fn` 裡排出去的晚到工作),明給 null 才不會誤用已結束的 session。
 */
function sessionOf(options: SessionOptions): ClientSession | null {
  return options.session === undefined
    ? (currentSession() ?? null)
    : options.session;
}

/**
 * 批次寫入出口的前置:筆數不符時要靠交易回復已寫的部分,不在交易內 → `TenantScopeError`
 * (同 `createMany`)。
 */
function assertInTransaction(
  modelName: string,
  method: string,
  options: SessionOptions,
): void {
  if (sessionOf(options)?.inTransaction() !== true) {
    throw new TenantScopeError(
      `${modelName}:${method} 必須在交易內(筆數不符時整批回復)`,
    );
  }
}

/** `bulkUpdateByIds` 收的運算子;其餘(頂層欄位、pipeline、`$pull`…)一律拒收。 */
const BULK_UPDATE_OPERATORS: ReadonlySet<string> = new Set([
  "$set",
  "$unset",
  "$inc",
  "$push",
]);

/**
 * `bulkUpdateByIds` 的更新形狀:只收 `$set` / `$unset` / `$inc` / `$push` 物件,路徑不得含位置運算子;
 * `$push` 的值是單一元素或只含 `$each` 的物件(`$position` / `$slice` / `$sort` 不收)。
 */
function assertBulkUpdateShape(modelName: string, update: unknown): void {
  if (update === null || typeof update !== "object" || Array.isArray(update)) {
    throw new TenantScopeError(
      `${modelName}:bulkUpdateByIds 的更新要是運算子物件(不收 pipeline)`,
    );
  }
  for (const [key, value] of Object.entries(
    update as Record<string, unknown>,
  )) {
    if (!BULK_UPDATE_OPERATORS.has(key)) {
      throw new TenantScopeError(
        `${modelName}:bulkUpdateByIds 只收 $set / $unset / $inc / $push(拿到 ${key})`,
      );
    }
    if (value === null || typeof value !== "object") {
      throw new TenantScopeError(
        `${modelName}:bulkUpdateByIds 的 ${key} 要是物件`,
      );
    }
    const positional = Object.keys(value).find((path) => path.includes("$"));
    if (positional !== undefined) {
      throw new TenantScopeError(
        `${modelName}:bulkUpdateByIds 不收位置運算子(${positional})`,
      );
    }
    if (key === "$push") {
      for (const pushed of Object.values(value as Record<string, unknown>)) {
        assertPushValue(modelName, pushed);
      }
    }
  }
}

/** `$push` 的值:單一元素,或只含 `$each`(陣列)的修飾物件。 */
function assertPushValue(modelName: string, pushed: unknown): void {
  if (pushed === null || typeof pushed !== "object" || Array.isArray(pushed)) {
    return;
  }
  const modifiers = Object.keys(pushed).filter((key) => key.startsWith("$"));
  if (modifiers.length === 0) {
    return;
  }
  if (
    modifiers.some((key) => key !== "$each") ||
    !Array.isArray((pushed as { $each?: unknown }).$each)
  ) {
    throw new TenantScopeError(
      `${modelName}:bulkUpdateByIds 的 $push 只收單一元素或 $each 陣列(拿到 ${modifiers.join(", ")})`,
    );
  }
}

/** `$push` 要加進陣列的元素(驗證用):`$each` 的元素,或單一元素。 */
function pushedElementsOf(pushed: unknown): unknown[] {
  if (
    pushed !== null &&
    typeof pushed === "object" &&
    !Array.isArray(pushed) &&
    "$each" in pushed
  ) {
    return [...(pushed as { $each: unknown[] }).$each];
  }
  return [pushed];
}

/**
 * **允許呼叫搬家(`reassignOrg` / 批次 `reassignOrgMany`)的底座檔案**(相對 `apps/api/src/`;ADR-0005「例外出口」)。
 * 專案的呼叫端登記在專案入口 `project/database/org-reassign-callers.ts`,不改這份。
 * `exists-any-callers.test.ts` 合併兩份清單、以呼叫語法(`.reassignOrg(` / `.reassignOrgMany(`)掃整個 src 斷言沒有其他檔案呼叫它。
 */
export const ORG_REASSIGN_CALLERS: readonly string[] = [];

/** 更新內容不得觸及的欄位:所屬組織(租戶隔離)與建立資訊(稽核)。 */
const PROTECTED_UPDATE_PATHS: readonly string[] = [
  "orgId",
  "createdBy",
  "createdAt",
];

/** aggregate 不收的階段:讀別張表(範圍不歸本 repository)或寫出。 */
const FORBIDDEN_AGGREGATE_STAGES: ReadonlySet<string> = new Set([
  "$lookup",
  "$unionWith",
  "$graphLookup",
  "$out",
  "$merge",
]);

/** pipeline 裡(含 `$facet` 子管線、任何巢狀的陣列管線)第一個被禁的階段;沒有 → undefined。 */
function forbiddenStageIn(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      const found = forbiddenStageIn(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_AGGREGATE_STAGES.has(key)) {
      return key;
    }
    const found = forbiddenStageIn(nested);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** `existsInTenant` 的欄位路徑:英數與 `.` 分段,不是 `tenantId`、不以 `$` 開頭。 */
const EQUALITY_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/;

/**
 * 「一個欄位等於一個值」的條件:值只能是純量、ObjectId、Date 或 null;
 * 物件(含 `{ $ne: … }` 這類運算子)與陣列一律拒收,條件放寬不了。
 */
function equalityFilterOf(
  modelName: string,
  equals: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const entries = Object.entries(equals);
  if (entries.length === 0) {
    throw new TenantScopeError(`${modelName}:existsInTenant 至少要一個欄位`);
  }
  for (const [field, value] of entries) {
    if (!EQUALITY_FIELD_PATTERN.test(field) || field === "tenantId") {
      throw new TenantScopeError(
        `${modelName}:existsInTenant 的欄位 ${field} 不合法`,
      );
    }
    const scalar =
      value === null ||
      ["string", "number", "boolean"].includes(typeof value) ||
      value instanceof mongoose.Types.ObjectId ||
      value instanceof Date;
    if (!scalar) {
      throw new TenantScopeError(
        `${modelName}:existsInTenant 的值只能是純量、ObjectId、Date 或 null`,
      );
    }
  }
  return { ...equals };
}

function defaultShareOrgsOf(
  kind: "none" | "wholeTenant",
  tenantId: Types.ObjectId | null,
): ShareOrg[] {
  return kind === "wholeTenant" && tenantId !== null
    ? [{ orgId: tenantId, includeDescendants: true }]
    : [];
}

/**
 * update 裡放 `shareOrgs` 的那一層(頂層或 `$set`);沒碰 → null。
 * 以其他運算子(`$push` / `$unset` / `$addToSet`…)或子路徑(`shareOrgs.0`)改 → `TenantScopeError`:
 * 只能整份替換,租戶檢查才看得到最後的完整清單。
 */
function shareOrgsContainerOf(
  modelName: string,
  update: unknown,
): Record<string, unknown> | null {
  if (!update || typeof update !== "object") {
    return null;
  }
  let container: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(update)) {
    const isOperator = key.startsWith("$");
    const holder = isOperator
      ? ((value ?? {}) as Record<string, unknown>)
      : (update as Record<string, unknown>);
    const touched = (isOperator ? Object.keys(holder) : [key]).filter(
      (path) =>
        path === SHARE_ORGS_PATH || path.startsWith(`${SHARE_ORGS_PATH}.`),
    );
    if (touched.length === 0) {
      continue;
    }
    if (
      touched.some((path) => path !== SHARE_ORGS_PATH) ||
      (isOperator && key !== "$set")
    ) {
      throw new TenantScopeError(
        `${modelName}:${SHARE_ORGS_PATH} 只能以 $set 整份替換`,
      );
    }
    container = holder;
  }
  return container;
}

/** 模組資料表另外不得經一般更新改動的欄位(`tenantScopePlugin` 的 `moduleData`)。 */
const MODULE_DATA_PROTECTED_PATHS: readonly string[] = [
  "moduleKey",
  "tenantId",
];

/**
 * 檢查 update 的頂層與各運算子(`$set` / `$unset` / `$setOnInsert` / `$rename`…)內
 * 是否觸及受保護欄位(含 `orgId.x` 這類子路徑);觸及即拋 TenantScopeError。
 * 搬移資料到別的組織若有需求,應是獨立且明確的操作,不經一般更新。
 */
function assertUpdateLeavesProtectedPaths(
  modelName: string,
  update: unknown,
  protectedPaths: readonly string[],
): void {
  if (!update || typeof update !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(update)) {
    const paths = key.startsWith("$")
      ? Object.keys((value ?? {}) as Record<string, unknown>)
      : [key];
    const touched = paths.find((path) =>
      protectedPaths.some(
        (protectedPath) =>
          path === protectedPath || path.startsWith(`${protectedPath}.`),
      ),
    );
    if (touched) {
      throw new TenantScopeError(
        `${modelName}:更新不得變更 ${touched}(所屬組織與建立資訊不可經一般更新修改)`,
      );
    }
  }
}
