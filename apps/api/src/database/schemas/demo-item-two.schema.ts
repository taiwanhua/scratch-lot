import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../plugins/tenant-scope.plugin";

/**
 * 這張表的資料固定屬於哪個模組(`tenantScopePlugin` 的 `moduleData`;固定欄位模組寫死自己的 key)。
 * 與 `apps/db-migrator/seeds/base/modules/` 的模組 key 一致;回填舊資料的是 `data_module-data-fields` migration。
 */
export const DEMO_ITEM_TWO_MODULE_KEY = "demo.sample-two";

/**
 * 示範模組2(docs/modules/demo.sample-two.md):不宣告資料範圍目標的對照組;
 * 也是資料共用(ADR-0014)「可共用、預設不共用、可編輯」的示範表。
 */
@Schema({ collection: "demo_items_two", timestamps: true })
export class DemoItemTwo {
  /** 資料歸屬組織(租戶隔離,ADR-0005)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 名稱。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 備註(選填)。 */
  @Prop({ type: String })
  note?: string;

  /** 啟用狀態。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 模組 key(由 `tenantScopePlugin({ moduleData: true })` 宣告;本表固定為 `DEMO_ITEM_TWO_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上 plugin 宣告;`BaseRepository.create` 推導,根組織資料為 null)。 */
  tenantId!: Types.ObjectId | null;

  /**
   * 共用給(由 `tenantScopePlugin({ sharing: { mode: "shareable" } })` 宣告;ADR-0014):
   * 空 = 不共用;`[{ 租戶頂層, 含下層 }]` = 全部分店。只能整份替換,每個組織都要在同一個租戶。
   */
  shareOrgs!: ShareOrg[];
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const DemoItemTwoSchema = SchemaFactory.createForClass(DemoItemTwo);

DemoItemTwoSchema.index({ orgId: 1, createdAt: 1 });
// 基礎欄位(ADR-0007)+ 租戶資料:查詢自動限縮在操作者可見組織內(ADR-0005)
DemoItemTwoSchema.plugin(baseFieldsPlugin);
// 模組資料表(moduleData):plugin 宣告 moduleKey / tenantId 並建索引;moduleKey 寫死本模組。
// 可共用(預設不共用、有編輯權限的人可改「共用給」):plugin 另宣告 shareOrgs 與索引
DemoItemTwoSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "shareable", defaultShareOrgs: "none", editable: true },
});
DemoItemTwoSchema.path("moduleKey").default(DEMO_ITEM_TWO_MODULE_KEY);
