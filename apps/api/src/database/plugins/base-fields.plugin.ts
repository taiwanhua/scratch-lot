/* eslint-disable unicorn/no-this-outside-of-class -- Mongoose 中介層以 this 接收 Query/Document,無參數式替代;到期條件:Mongoose 提供以參數傳入的中介層 API */
import {
  type MongooseQueryMiddleware,
  type Query,
  Schema,
  type Types,
} from "mongoose";

import {
  OPERATOR_LOCAL_KEY,
  type OperatorContext,
  getQueryScope,
} from "../operator-context";

/** 全部 collection 共通的基礎欄位(ADR-0007);由 plugin 掛上,schema class 不需重複宣告。 */
export interface BaseFields {
  createdAt: Date;
  updatedAt: Date;
  /** 建立者(操作者 id);無登入主體的流程為 null。 */
  createdBy: Types.ObjectId | null;
  /** 最後更新者(操作者 id)。 */
  updatedBy: Types.ObjectId | null;
  /** 軟刪除時間;null = 未刪除。有值即視為不存在(預設查詢排除),資料仍保留。 */
  deletedAt: Date | null;
}

export const BASE_FIELD_PATHS = [
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "deletedAt",
] as const satisfies readonly (keyof BaseFields)[];

/** 吃過濾條件的查詢中介層:預設排除已軟刪除的資料。 */
const FILTERED_QUERY_MIDDLEWARE = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
] as const satisfies readonly MongooseQueryMiddleware[];

/** 會改資料的查詢中介層:自動補 updatedBy。 */
const UPDATE_QUERY_MIDDLEWARE = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
] as const satisfies readonly MongooseQueryMiddleware[];

type AnyQuery = Query<unknown, unknown, unknown, Record<string, unknown>>;

/** 已掛好本 plugin 的 schema(安裝完成才記錄);資料登記據此驗證,不靠「欄位存在」推測。 */
const installedSchemas = new WeakSet<Schema>();

/** 這個 schema 是否已掛 baseFields plugin(欄位與中介層都裝好)。 */
export function hasBaseFields(schema: Schema): boolean {
  return installedSchemas.has(schema);
}

/**
 * Mongoose plugin(ADR-0007):
 * - 補齊 timestamps(createdAt/updatedAt)與 createdBy/updatedBy/deletedAt 三個欄位。
 * - save:自操作者上下文(Document `$locals`)填 createdBy(新建時)與 updatedBy。
 * - 更新類查詢:自操作者上下文填 updatedBy。
 * - 所有帶條件的查詢:預設加 `deletedAt: null`(軟刪除語意);`includeDeleted` 才連已刪除一起查。
 */
export function baseFieldsPlugin(schema: Schema): void {
  if (!schema.get("timestamps")) {
    schema.set("timestamps", true);
  }
  schema.add({
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    deletedAt: { type: Date, default: null },
  });

  schema.pre("save", function () {
    const operator = this.$locals[OPERATOR_LOCAL_KEY] as
      OperatorContext | undefined;
    if (!operator) {
      return;
    }
    if (this.isNew) {
      this.set("createdBy", operator.actorId);
    }
    this.set("updatedBy", operator.actorId);
  });

  schema.pre([...FILTERED_QUERY_MIDDLEWARE], function () {
    excludeSoftDeleted(this);
  });

  schema.pre([...UPDATE_QUERY_MIDDLEWARE], function () {
    fillUpdatedBy(this);
  });

  // aggregate(只經 BaseRepository.aggregate):軟刪除排除放在 pipeline 最前面的 `$match`
  schema.pre("aggregate", function () {
    if (getQueryScope(this)?.includeDeleted) {
      return;
    }
    this.pipeline().unshift({ $match: { deletedAt: null } });
  });

  installedSchemas.add(schema);
}

function excludeSoftDeleted(query: AnyQuery): void {
  if (getQueryScope(query)?.includeDeleted) {
    return;
  }
  query.and([{ deletedAt: null }]);
}

function fillUpdatedBy(query: AnyQuery): void {
  const scope = getQueryScope(query);
  if (!scope) {
    return;
  }
  query.set("updatedBy", scope.operator.actorId);
}
