import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** collection 名;存取只經 `WorkflowsRepository`(每個方法強制帶 `tenantId` 邊界)。 */
export const WORKFLOWS_COLLECTION = "workflows";

/** 客製流程的來源(以哪個流程的哪一版為基底建的)。 */
export interface WorkflowForkSource {
  workflowKey: string;
  version: number;
}

/**
 * 審核流程(`docs/data-model.md`「workflows」):一組依序的審核關卡的身分。
 *
 * - 共用流程:`ownerOrgId = null`、`tenantId = null`,root 管,以 `org_workflow` 分派給租戶
 * - 客製流程:`ownerOrgId = tenantId = 租戶頂層`,只有該租戶看得到
 *
 * **不掛 `tenantScopePlugin`**:流程沒有 `orgId`,邊界是 `tenantId`(同 `business_relationships`):
 * `WorkflowsRepository` 每個讀寫方法都要明給 `tenantId`(租戶頂層 id,或 `null` = 共用),
 * 沒給就拋錯(fail-closed)。
 */
@Schema({ collection: WORKFLOWS_COLLECTION, timestamps: true })
export class Workflow {
  /** 全域唯一,格式同表單 key(`isValidFormKey`);客製預設 `<來源 key>_<orgs.slug>`;**建立後不可改**。 */
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** null = 共用(root 管);有值 = 該租戶頂層(客製)。 */
  @Prop({ type: Types.ObjectId, default: null })
  ownerOrgId!: Types.ObjectId | null;

  /** = `ownerOrgId`;查詢以它為邊界(root 查共用的用 null)。 */
  @Prop({ type: Types.ObjectId, default: null })
  tenantId!: Types.ObjectId | null;

  /** 客製來源;共用流程或全新建立為 null。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  forkedFrom!: WorkflowForkSource | null;

  /** 目前已發布版本號;null = 尚未發布或已退役目前版本。 */
  @Prop({ type: Number, default: null })
  currentVersion!: number | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const WorkflowSchema = SchemaFactory.createForClass(Workflow);

WorkflowSchema.index({ key: 1 }, { unique: true });
// 邊界查詢:root 列共用(tenantId = null)、租戶列自己的客製
WorkflowSchema.index({ tenantId: 1, createdAt: 1 });
// 基礎欄位(ADR-0007);不掛 tenantScope(理由見 class 註解)
WorkflowSchema.plugin(baseFieldsPlugin);
