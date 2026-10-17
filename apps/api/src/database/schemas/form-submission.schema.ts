import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type { StoredValues, SubmissionSummary } from "@repo/domain/form";
import {
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from "@repo/domain/workflow";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

/** collection 名(資料範圍目標、退役權限清理的跨租戶計數共用)。 */
export const FORM_SUBMISSIONS_COLLECTION = "form_submissions";

/**
 * 提交狀態(Spec 6a §6 + 6b §6,單一欄位;正本是 `@repo/domain/workflow` 的 `SUBMISSION_STATUSES`):
 * - `draft` 存了沒送出、可改可刪
 * - `reviewing` 有進行中的實例(內容凍結在該修訂快照);`returned` / `withdrawn` 被退回 / 撤回,可改後再送
 * - `completed` 不綁流程:送出即此、可再修改;綁流程(`currentInstanceId` 有值):實例核准、鎖定只能作廢
 * - `rejected` 被駁回,不可改不可再送;`voided` 核准後作廢
 *
 * 表單模組 seed(三個示範表單)的資料範圍目標 `status` 選項與它一一對應:
 * 任何一個表單模組都可能被綁流程,所以一律宣告完整七種。
 */
export const FORM_SUBMISSION_STATUSES = SUBMISSION_STATUSES;

export type FormSubmissionStatus = SubmissionStatus;

/**
 * 一次送出 / 修改的上下文(歷史檢視重算條件時轉成表達式的 `ctx.*`,不拿讀者現在的身分補值)。
 * `orgId` = 操作者當時的當前組織;`orgIds` = 操作者當時的所屬組織(全部,`org_user` 的直接關聯);
 * `tenantId` = 操作者當時的租戶頂層(根組織 = null)。`orgIds` / `tenantId` 缺席 = 舊修訂(讀成空 / null)。
 */
export interface FormRevisionContext {
  at: Date;
  timezone: string;
  userId: Types.ObjectId | null;
  orgId: Types.ObjectId | null;
  orgIds?: Types.ObjectId[];
  tenantId?: Types.ObjectId | null;
}

/** 修訂的來由:`upgrade` = 舊版資料升級到新版(改綁版本 + 補值 + 重算,不驗證);缺席 = 一般送出 / 修改。 */
export type FormRevisionKind = "upgrade";

/** 一個修訂號的**完整值快照**(不是 diff;受保護欄位原值照存,讀取時投影遮蔽)。 */
export interface FormRevision {
  revision: number;
  /**
   * 填寫當時綁的表單版本(升級後歷史修訂用它渲染);缺席 = 提交目前的 `version`
   * (讀取一律 `revision.version ?? submission.version`)。
   */
  version?: number;
  values: StoredValues;
  /** 條件 / 計算的上下文;升級產生的修訂沿用上一筆修訂的(升級不改變 `ctx.now` / `ctx.user` 算出的值)。 */
  ctx: FormRevisionContext;
  kind?: FormRevisionKind;
  /** 只有升級產生的修訂有:誰升級(操作者)。 */
  upgradedBy?: Types.ObjectId | null;
  /** 只有升級產生的修訂有:什麼時候升級。 */
  upgradedAt?: Date;
}

/** 修訂 r 用哪一版的定義渲染。 */
export function revisionVersionOf(
  submission: { version: number },
  revision: Pick<FormRevision, "version">,
): number {
  return revision.version ?? submission.version;
}

/**
 * 表單提交(所有表單模組共用一張;`docs/data-model.md`「form_submissions」)。
 * 模組資料表:`tenantScopePlugin({ moduleData: true })` 宣告 `moduleKey`(= 綁的表單所屬模組)與
 * `tenantId`(後端依 `orgId` 推導);可見範圍與資料範圍規則照固定欄位模組一樣自動套用。
 */
@Schema({
  collection: FORM_SUBMISSIONS_COLLECTION,
  timestamps: true,
  minimize: false,
})
export class FormSubmission {
  /** 資料歸屬組織(租戶隔離,ADR-0005)= 建立者當時的當前組織。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  formKey!: string;

  /**
   * 綁的版本(建草稿時的 `forms.currentVersion`);之後不隨表單改版而變,只有「舊版資料升級到新版」
   * 會改綁(同時記一筆修訂,歷史修訂仍以各自的 `revisions[].version` 渲染)。
   */
  @Prop({ type: Number, required: true })
  version!: number;

  /** 欄位 key → 存值(Spec §5「值的存法」);受保護欄位原值照存,讀取時投影為 `"[redacted]"`。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  values!: StoredValues;

  /** 依版本 `summaryMap` 算的快照;列表只讀它(關鍵字也只比對 `summary.title`)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  summary!: SubmissionSummary | null;

  @Prop({ type: String, required: true, enum: FORM_SUBMISSION_STATUSES })
  status!: FormSubmissionStatus;

  /** 目前修訂號:草稿為 0、送出時 = 1、已完成後每改一次 +1。 */
  @Prop({ type: Number, default: 0 })
  revision!: number;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  revisions!: FormRevision[];

  /** 每次寫入(存草稿 / 送出 / 已完成修改)+1;寫入都要帶預期值,不符 → 409。 */
  @Prop({ type: Number, default: 0 })
  editVersion!: number;

  /**
   * 使用者**碰過**的欄位 key(Spec 6a §5「預設值」):存草稿時由前端一併送來;沒碰過的欄位
   * 在填寫時會隨依賴重算預設值,碰過就停。只對草稿有意義,送出後不再變動。
   */
  @Prop({ type: [String], default: [] })
  touched!: string[];

  /** `createFormDraft` 的一次性 id;`(createdBy, clientRequestId)` 唯一,重試回同一筆。 */
  @Prop({ type: String, required: true })
  clientRequestId!: string;

  /** 第一次送出時間(= `revisions[0].ctx.at`);索引與列表排序用。 */
  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  /**
   * 進行中或最後一個流程實例;**null = 沒走過流程**(`completed` 後可修改,6a);
   * 有值 = 走過流程(`completed` 後鎖定、只能作廢)。
   */
  @Prop({ type: Types.ObjectId, default: null })
  currentInstanceId!: Types.ObjectId | null;

  /** 實例被阻擋時 true(列表 chip 顯示「審核中(待處理)」)。 */
  @Prop({ type: Boolean, default: false })
  blocked!: boolean;

  /** 作廢時間 / 操作者 / 理由(`voided`)。 */
  @Prop({ type: Date, default: null })
  voidedAt!: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  voidedBy!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  voidReason!: string | null;

  /** 「複製為新單」建出的那筆(選填)。 */
  @Prop({ type: Types.ObjectId, default: null })
  replacedById!: Types.ObjectId | null;

  /** 這筆草稿是「複製為新單」從哪一筆複製來的(`copySubmissionToDraft`);一般新增為 null。 */
  @Prop({ type: Types.ObjectId, default: null })
  copiedFrom!: Types.ObjectId | null;

  /** 模組 key(`tenantScopePlugin` 的 `moduleData` 宣告;= 綁的表單的 `moduleKey`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上;`BaseRepository.create` 推導,根組織資料為 null)。 */
  tenantId!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const FormSubmissionSchema =
  SchemaFactory.createForClass(FormSubmission);

// 列表(依模組 / 表單,送出時間排序)與「我的提交」(6b 申請中心)
FormSubmissionSchema.index({
  tenantId: 1,
  moduleKey: 1,
  formKey: 1,
  submittedAt: 1,
});
FormSubmissionSchema.index({ tenantId: 1, createdBy: 1, submittedAt: 1 });
// 新增的冪等:同一人同一次頁面開啟只會建一筆(含已軟刪除的,重用 id 一律拒絕)
FormSubmissionSchema.index(
  { createdBy: 1, clientRequestId: 1 },
  { unique: true },
);
// 基礎欄位(ADR-0007)+ 模組資料表(可見範圍 + 資料範圍規則依 moduleKey,ADR-0005 / ADR-0008)
FormSubmissionSchema.plugin(baseFieldsPlugin);
FormSubmissionSchema.plugin(tenantScopePlugin, { moduleData: true });
