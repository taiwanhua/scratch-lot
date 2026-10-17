import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** 側欄呈現型別:group(可展開)/ link / hidden(隱藏頁,key 一律 -page 結尾)。 */
export const MODULE_SIDEBAR_TYPES = ["group", "link", "hidden"] as const;

export type ModuleSidebarType = (typeof MODULE_SIDEBAR_TYPES)[number];

/**
 * 模組頁面怎麼組裝:`fixed` = 固定欄位模組(module-scaffold 手寫頁面);
 * `form` = 表單模組(頁面由表單引擎組裝,資料存 `form_submissions`)。
 */
export const MODULE_ENGINES = ["fixed", "form"] as const;

export type ModuleEngine = (typeof MODULE_ENGINES)[number];

/** 模組(全表種子資料):樹狀,物化路徑 ancestors。模組即頁面(ADR-0004)。 */
@Schema({ collection: "modules", timestamps: true })
export class Module {
  /** unique,kebab-case。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 顯示名,與 key 分離。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 上層模組 id;頂層為 null。 */
  @Prop({ type: Types.ObjectId, default: null })
  parentId!: Types.ObjectId | null;

  /** 物化路徑祖先 id 陣列(ADR-0005)。 */
  @Prop({ type: [Types.ObjectId], default: [] })
  ancestors!: Types.ObjectId[];

  /** 只有自己那段(前綴父路由由 API 組合)。 */
  @Prop({ type: String })
  route?: string;

  /** 側欄呈現型別。 */
  @Prop({ type: String, required: true, enum: MODULE_SIDEBAR_TYPES })
  sidebarType!: ModuleSidebarType;

  /** 側欄排序。 */
  @Prop({ type: Number, default: 0 })
  order!: number;

  /** 停用連動整棵子樹。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 保護種子模組(不可刪/改 key)。 */
  @Prop({ type: Boolean, default: false })
  isSystem!: boolean;

  /** 描述說明(選填)。 */
  @Prop({ type: String })
  description?: string;

  /**
   * 側欄圖示 key(白名單 `@repo/domain/module-icon` 的 `MODULE_ICON_KEYS`);
   * `null` = 沒有指定,由側欄用預設圖示。
   *
   * 與 `enabled` 同屬「初始 seed 值的欄位」(ADR-0002):seed 只在欄位不存在時寫初值,
   * 之後由根組織在「模組與權限」頁以 `setModuleIcon` 管理,重跑 seed 不覆蓋人改過的值。
   * 白名單不寫成 mongoose `enum`:白名單的正本在 `@repo/domain`(前後端共用),
   * 只有一處驗證(`ModuleManagerService.setModuleIcon`),不在 schema 再抄一份會漂移的清單。
   */
  @Prop({ type: String, default: null })
  icon!: string | null;

  /** 受控 JSON 設定。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  settings!: Record<string, unknown>;

  /** 頁面組裝方式(見 `MODULE_ENGINES`);seed 宣告 `engine: "form"` 才是表單模組,其餘 `fixed`。 */
  @Prop({ type: String, enum: MODULE_ENGINES, default: "fixed" })
  engine!: ModuleEngine;

  /**
   * 表單模組依表單分開新增權限(B9b):true 時每張表單發布時建 `<模組>.create-<formKey>`,
   * 新增資格看它而不看模組 `create`(`FormAccessService.canCreateWithForm`)。
   * 與 `engine` 同屬「每次 seed 都同步」的欄位:只能在 seed 宣告,執行期不改。
   */
  @Prop({ type: Boolean, default: false })
  perFormCreate!: boolean;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引/plugin)
export const ModuleSchema = SchemaFactory.createForClass(Module);

ModuleSchema.index({ key: 1 }, { unique: true });
ModuleSchema.index({ ancestors: 1 });
// 基礎欄位(ADR-0007);全表種子資料,不掛 tenantScope
ModuleSchema.plugin(baseFieldsPlugin);
