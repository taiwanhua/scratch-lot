import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

/** collection 名;推導 `tenantId` 的地方(BaseRepository、業務關聯)以原生 collection 讀祖先時共用。 */
export const ORGS_COLLECTION = "orgs";

/** 組織(ADR-0005):物化路徑 ancestors;根組織以 key 供 seed 冪等。 */
@Schema({ collection: ORGS_COLLECTION, timestamps: true })
export class Org {
  /** 組織顯示名稱。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 上層組織 id;根組織為 null。 */
  @Prop({ type: Types.ObjectId, default: null })
  parentId!: Types.ObjectId | null;

  /** 物化路徑祖先 id 陣列(ADR-0005)。 */
  @Prop({ type: [Types.ObjectId], default: [] })
  ancestors!: Types.ObjectId[];

  /** 僅根組織需要,seed 冪等用。 */
  @Prop({ type: String })
  key?: string;

  /** 保護根組織。 */
  @Prop({ type: Boolean, default: false })
  isSystem!: boolean;

  /** 停用租戶(連動整棵子樹)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /**
   * 描述說明(選填)。根組織的描述是初始 seed 值欄位(ADR-0002):清空時留著欄位存 `null`,
   * 讓 seed 不把它補回宣告值;其他組織清空是拿掉欄位。讀取端兩者同義。
   */
  @Prop({ type: String })
  description?: string | null;

  /** 組織商標的 GCS 物件路徑(存路徑非 URL,ADR-0010)。 */
  @Prop({ type: String })
  logoPath?: string;

  /** 租戶擁有者(僅租戶頂層有值,ADR-0009)。 */
  @Prop({ type: Types.ObjectId })
  ownerUserId?: Types.ObjectId;

  /**
   * 租戶短碼(只有租戶頂層有值):格式 `^[a-z][a-z0-9_]{1,19}$`(`@repo/domain/form` 的
   * `ORG_SLUG_PATTERN`)、全域唯一;開通時填,根組織可在組織編輯改。客製表單 key 的預設後綴。
   */
  @Prop({ type: String })
  slug?: string;

  /**
   * 示範機構標記(只有租戶頂層、只在開通時由示範指令設定;`docs/deployment.md`「示範資料(demo)」)。
   * 之後沒有任何端點改得了它:真實租戶永遠不會被當成示範機構清空。缺欄位與 `false` 同義。
   */
  @Prop({ type: Boolean })
  isDemo?: boolean;

  /** 受控 JSON。租戶頂層專用:`visibility` = "own"(使用者只看自己所屬組織的資料)| "subtree"(含整棵下層);未設視為 "own";下層組織不看自己的(ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  settings!: Record<string, unknown>;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引/plugin)
export const OrgSchema = SchemaFactory.createForClass(Org);

OrgSchema.index({ key: 1 }, { unique: true, sparse: true });
OrgSchema.index({ slug: 1 }, { unique: true, sparse: true });
OrgSchema.index({ parentId: 1 });
OrgSchema.index({ ancestors: 1 });
// 基礎欄位(ADR-0007);組織自身以 _id 判定是否在範圍內(ADR-0005)。
// 組織是**治理類** collection(ADR-0005「管理範圍與可見範圍的分工」):過濾吃管理範圍,
// 不吃可見範圍 — 租戶管理員在可見性開關為 own 時照樣管得到整個租戶的組織樹。
OrgSchema.plugin(baseFieldsPlugin);
OrgSchema.plugin(tenantScopePlugin, { path: "_id", kind: "governance" });
