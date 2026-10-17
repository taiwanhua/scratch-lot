import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type {
  AssigneeSource,
  StepDef,
  WorkflowEdge,
} from "@repo/domain/workflow";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/**
 * 版本狀態(同 `form_versions`,Spec 6a §6 的四步發布、冪等重試,少了欄位級權限那一步):
 * `draft` 設計中 / `publishing` 只存在於發布交易內的搶鎖狀態(部分唯一索引保證至多一筆,交易外看不到)/
 * `published` 凍結、供新送出 / `retired` 退役。
 */
export const WORKFLOW_VERSION_STATUSES = [
  "draft",
  "publishing",
  "published",
  "retired",
] as const;

export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

/**
 * 流程版本(一版一筆;`docs/data-model.md`「workflow_versions」)。定義的形狀正本是 `@repo/domain/workflow`:
 * `steps[]` 是節點清單(`kind: review | join`),**沒有 `edges` 時陣列順序 = 直線流程**;
 * 有 `edges` 才是圖(分流 / 匯合)。每關 `key` 發布後不可改(實例、任務、歷程都靠它找回關卡)。
 */
@Schema({ collection: "workflow_versions", timestamps: true, minimize: false })
export class WorkflowVersion {
  @Prop({ type: String, required: true })
  workflowKey!: string;

  /** 正式版號:發布搶鎖時配(該流程最大版號 + 1);草稿為 null。 */
  @Prop({ type: Number, default: null })
  version!: number | null;

  @Prop({ type: String, required: true, enum: WORKFLOW_VERSION_STATUSES })
  status!: WorkflowVersionStatus;

  /** 草稿每存一次 +1;存草稿與發布都要帶預期值,不符 → 409。 */
  @Prop({ type: Number, default: 0 })
  draftRevision!: number;

  /** 這份草稿以哪一版為基底複製出來(全新 = null)。 */
  @Prop({ type: Number, default: null })
  baseVersion!: number | null;

  /** 關卡節點(StepDef[];`kind` 省略 = review)。 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  steps!: StepDef[];

  /** 連線;null = 直線(依 `steps[]` 順序)。 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: null })
  edges!: WorkflowEdge[] | null;

  /**
   * 整個流程的知會對象(B17;`AssigneeSource`,來源同審核者三種):單據完成、被駁回、被作廢時通知。
   * null = 沒設(這個欄位出現之前的版本讀起來也是 null)。關卡的知會在 `steps[].cc`。
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  cc!: AssigneeSource | null;

  /**
   * 設計器的「檢查用表單」(表單 key;選填、null = 沒選):設計時對照的表單,
   * `field` 審核者來源的欄位選單、`skipWhen` 的欄位選單與檢查器都對它的**目前版本**。
   * 存草稿時一併存、發布快照保留、以某版為基底開草稿 / fork 時帶過去;送出時仍以綁定的表單為準。
   */
  @Prop({ type: String, default: null })
  checkFormKey!: string | null;

  /** 發布時必填。 */
  @Prop({ type: String, default: null })
  changelog!: string | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  publishedBy!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const WorkflowVersionSchema =
  SchemaFactory.createForClass(WorkflowVersion);

// 正式版號唯一(草稿的 null 不算)
WorkflowVersionSchema.index(
  { workflowKey: 1, version: 1 },
  { unique: true, partialFilterExpression: { version: { $type: "number" } } },
);
// 一個流程同時最多一筆草稿、最多一筆發布中(同 form_versions 的兩條部分唯一索引)
WorkflowVersionSchema.index(
  { workflowKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "draft" },
    name: "workflowKey_draft_unique",
  },
);
WorkflowVersionSchema.index(
  { workflowKey: 1, status: -1 },
  {
    unique: true,
    partialFilterExpression: { status: "publishing" },
    name: "workflowKey_publishing_unique",
  },
);
// 基礎欄位(ADR-0007);版本屬流程,可見與否跟著流程走,不掛 tenantScope
WorkflowVersionSchema.plugin(baseFieldsPlugin);
