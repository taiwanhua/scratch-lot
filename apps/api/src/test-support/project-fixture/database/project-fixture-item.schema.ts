import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

/** 測試專案模組的 key(模組樹、權限與資料範圍目標都由測試 harness 以這個 key 建立)。 */
export const PROJECT_FIXTURE_MODULE_KEY = "project-fixture";

export const PROJECT_FIXTURE_ITEMS_COLLECTION = "project_fixture_items";

/**
 * 測試專案的租戶資料(只存在於測試):形狀與示範模組相同 ——
 * 先以 schema 選項定 collection,再掛 baseFields 與 tenantScope 的模組資料範圍。
 */
@Schema({ collection: PROJECT_FIXTURE_ITEMS_COLLECTION, timestamps: true })
export class ProjectFixtureItem {
  /**
   * 資料歸屬組織(租戶隔離,ADR-0005)。type 寫 mongoose 的 SchemaType:
   * `Types.ObjectId`(bson class)經 @nestjs/mongoose 會變成 Mixed,資料登記不收。
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  name!: string;

  /** 代碼(lookup 夾具的受保護欄位;要 `PROJECT_FIXTURE_PERMISSIONS.delete` 才讀得到)。 */
  @Prop({ type: String, default: null })
  code!: string | null;

  /** 排序值(lookup 夾具的數字欄位:不能當值欄)。 */
  @Prop({ type: Number, default: 0 })
  rank!: number;

  /** 啟用(lookup 夾具的 `filterFields`)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 模組 key(由 `tenantScopePlugin({ moduleData: true })` 宣告;本表固定為 `PROJECT_FIXTURE_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上 plugin 宣告;`BaseRepository.create` 推導)。 */
  tenantId!: Types.ObjectId | null;
}

export const ProjectFixtureItemSchema =
  SchemaFactory.createForClass(ProjectFixtureItem);

ProjectFixtureItemSchema.index({ orgId: 1, createdAt: 1 });
ProjectFixtureItemSchema.plugin(baseFieldsPlugin);
ProjectFixtureItemSchema.plugin(tenantScopePlugin, { moduleData: true });
ProjectFixtureItemSchema.path("moduleKey").default(PROJECT_FIXTURE_MODULE_KEY);
