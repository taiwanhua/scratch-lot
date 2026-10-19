import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

/**
 * 狀態的固定選項:與 `apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts` 的
 * `dataScopeTarget.fields[status].options` 的 value 一一對應(ADR-0008 的 enum 欄位)。
 */
export const DEMO_ITEM_ONE_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;

export type DemoItemOneStatus = (typeof DEMO_ITEM_ONE_STATUSES)[number];

/**
 * 這張表的資料固定屬於哪個模組(`tenantScopePlugin` 的 `moduleData`;固定欄位模組寫死自己的 key)。
 * 與 `apps/db-migrator/seeds/base/modules/` 的模組 key 一致;回填舊資料的是 `data_module-data-fields` migration。
 */
export const DEMO_ITEM_ONE_MODULE_KEY = "demo.sub.sample-one";

/** 示範模組1(docs/modules/demo.sub.sample-one.md):宣告資料範圍目標的對象。 */
@Schema({ collection: "demo_items_one", timestamps: true })
export class DemoItemOne {
  /** 資料歸屬組織(租戶隔離,ADR-0005)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 名稱。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 分類;欄位管理「示範分類」選項(存 value)。 */
  @Prop({ type: String })
  category?: string;

  /**
   * 狀態;資料範圍目標的 enum 欄位(ADR-0008,正本宣告在
   * `apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts` 的 `dataScopeTarget.fields`)。
   * 新資料預設「草稿」(`draft`),選項與 seed 宣告的 value 一一對應。
   */
  @Prop({ type: String, enum: DEMO_ITEM_ONE_STATUSES, default: "draft" })
  status!: DemoItemOneStatus;

  /** 備註(選填)。 */
  @Prop({ type: String })
  note?: string;

  /** 內部備註;欄位級權限控(show/edit-internal-note)。 */
  @Prop({ type: String })
  internalNote?: string;

  /** 封面圖:公開 bucket 物件路徑。 */
  @Prop({ type: String })
  coverPath?: string;

  /**
   * 附件:私有 bucket 物件路徑。下面三個 `attachment*` 欄位是它的中繼資料,
   * **四欄同生同滅**:換檔一起 `$set`、清空一起 `$unset`。採平行欄位而非巢狀物件,
   * 是為了不必搬既有資料(早期的附件只有這一欄)。
   */
  @Prop({ type: String })
  attachmentPath?: string;

  /**
   * 附件的原始檔名(使用者選檔時的 `File.name`)。
   * 早期上傳的附件沒有這一欄 → api 回 `null`,前端退回顯示路徑尾段。
   */
  @Prop({ type: String })
  attachmentName?: string;

  /** 附件大小(bytes,前端申報的 `File.size`;上限同 `DEMO_ATTACHMENT` 的上傳規則)。舊資料沒有。 */
  @Prop({ type: Number })
  attachmentSize?: number;

  /** 附件的 content type(前端申報的 `File.type`,在 `DEMO_ATTACHMENT` 的白名單內)。舊資料沒有。 */
  @Prop({ type: String })
  attachmentContentType?: string;

  /** 啟用狀態。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 模組 key(由 `tenantScopePlugin({ moduleData: true })` 宣告;本表固定為 `DEMO_ITEM_ONE_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上 plugin 宣告;`BaseRepository.create` 推導,根組織資料為 null)。 */
  tenantId!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const DemoItemOneSchema = SchemaFactory.createForClass(DemoItemOne);

DemoItemOneSchema.index({ orgId: 1, createdAt: 1 });
// 基礎欄位(ADR-0007)+ 租戶資料:查詢自動限縮在操作者可見組織內(ADR-0005)
DemoItemOneSchema.plugin(baseFieldsPlugin);
// 模組資料表(moduleData):plugin 宣告 moduleKey / tenantId 並建索引;moduleKey 寫死本模組
DemoItemOneSchema.plugin(tenantScopePlugin, { moduleData: true });
DemoItemOneSchema.path("moduleKey").default(DEMO_ITEM_ONE_MODULE_KEY);
