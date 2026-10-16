import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";
import { FormUserRef } from "../../../forms/models/form-common.model";

/** 流程版本狀態(成員值即落庫字串;同表單版本的四種)。 */
export enum WorkflowVersionStatusEnum {
  DRAFT = "draft",
  PUBLISHING = "publishing",
  PUBLISHED = "published",
  RETIRED = "retired",
}

registerEnumType(WorkflowVersionStatusEnum, {
  name: "WorkflowVersionStatus",
  description: "流程版本狀態:草稿 / 發布中 / 已發布 / 已退役",
});

/** 客製流程的來源。 */
@ObjectType()
export class WorkflowForkSourceModel {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => Int)
  version!: number;
}

/** root 視角:共用流程分派到的租戶。 */
@ObjectType()
export class WorkflowAssignment {
  @Field(() => ID)
  tenantOrgId!: string;

  @Field(() => String, { nullable: true })
  tenantName!: string | null;
}

/** 綁了這個流程的表單(反查 `org_form_workflow`;租戶視角只列本租戶的)。 */
@ObjectType()
export class WorkflowBoundForm {
  @Field(() => ID)
  formKey!: string;

  @Field(() => String, { nullable: true })
  formName!: string | null;

  @Field(() => String, { nullable: true })
  moduleKey!: string | null;
}

/** 這位操作者對這個流程能做什麼(**含權限**,業務模組那一種 `abilities`,前端直接用)。 */
@ObjectType()
export class WorkflowAbilities {
  /** 改名稱、開草稿、存草稿(`system.workflows.edit` + 自己擁有的流程)。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 發布 / 重試發布 / 退役(`system.workflows.publish` + 自己擁有的流程)。 */
  @Field(() => Boolean)
  canPublish!: boolean;

  /** 分派 / 收回(站在根組織 + 共用流程 + `system.workflows.assign`)。 */
  @Field(() => Boolean)
  canAssign!: boolean;

  /** 以此為基底建流程(`system.workflows.create`)。 */
  @Field(() => Boolean)
  canFork!: boolean;
}

@ObjectType()
export class WorkflowModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;

  /** 共用流程(`ownerOrgId = null`)。 */
  @Field(() => Boolean)
  isShared!: boolean;

  @Field(() => ID, { nullable: true })
  ownerOrgId!: string | null;

  @Field(() => String, { nullable: true })
  ownerOrgName!: string | null;

  @Field(() => WorkflowForkSourceModel, { nullable: true })
  forkedFrom!: WorkflowForkSourceModel | null;

  /** 已發布版本;null = 未發布或已退役。 */
  @Field(() => Int, { nullable: true })
  currentVersion!: number | null;

  @Field(() => Boolean)
  hasDraft!: boolean;

  /** root 視角的共用流程才有;其餘為空陣列。 */
  @Field(() => [WorkflowAssignment])
  assignments!: WorkflowAssignment[];

  /** 綁了這個流程的表單(租戶視角:本租戶的綁定;root 視角:空陣列)。 */
  @Field(() => [WorkflowBoundForm])
  boundForms!: WorkflowBoundForm[];

  @Field(() => WorkflowAbilities)
  abilities!: WorkflowAbilities;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class WorkflowsPayload {
  @Field(() => [WorkflowModel])
  items!: WorkflowModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class WorkflowPayload {
  @Field(() => WorkflowModel)
  workflow!: WorkflowModel;
}

/** 連線(關卡 key → 關卡 key)。 */
@ObjectType()
export class WorkflowEdgeModel {
  @Field(() => String)
  from!: string;

  @Field(() => String)
  to!: string;
}

/** 流程的一版;`steps` 的形狀見 `@repo/domain/workflow` 的 `StepDef`(含 `kind: review | join`)。 */
@ObjectType()
export class WorkflowVersionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  workflowKey!: string;

  /** 草稿為 null。 */
  @Field(() => Int, { nullable: true })
  version!: number | null;

  @Field(() => WorkflowVersionStatusEnum)
  status!: WorkflowVersionStatusEnum;

  @Field(() => Int)
  draftRevision!: number;

  @Field(() => Int, { nullable: true })
  baseVersion!: number | null;

  /** 節點清單(`StepDef[]`);沒有 `edges` 時陣列順序 = 直線流程。 */
  @Field(() => [GraphQLJSONObject])
  steps!: Record<string, unknown>[];

  /** 連線;null = 直線。 */
  @Field(() => [WorkflowEdgeModel], { nullable: true })
  edges!: WorkflowEdgeModel[] | null;

  /** 設計器的「檢查用表單」(表單 key);沒選 = null。發布快照保留、開草稿 / fork 帶過去。 */
  @Field(() => ID, { nullable: true })
  checkFormKey!: string | null;

  @Field(() => String, { nullable: true })
  changelog!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  publishedAt!: Date | null;

  @Field(() => FormUserRef, { nullable: true })
  publishedBy!: FormUserRef | null;
}

/** 檢查器的一筆錯誤 / 警告(定位到關卡或連線;碼的正本 `@repo/domain/workflow` 的 `issues.ts`)。 */
@ObjectType()
export class WorkflowIssueModel {
  @Field(() => String)
  code!: string;

  @Field(() => String)
  message!: string;

  @Field(() => String, { nullable: true })
  stepKey!: string | null;

  @Field(() => Int, { nullable: true })
  stepIndex!: number | null;

  @Field(() => Int, { nullable: true })
  edgeIndex!: number | null;

  @Field(() => String, { nullable: true })
  property!: string | null;

  @Field(() => String, { nullable: true })
  exprPath!: string | null;
}

/** 檢查器結果:有錯不能發布,警告可發布。 */
@ObjectType()
export class WorkflowValidationReport {
  @Field(() => [WorkflowIssueModel])
  errors!: WorkflowIssueModel[];

  @Field(() => [WorkflowIssueModel])
  warnings!: WorkflowIssueModel[];
}

@ObjectType()
export class WorkflowVersionPayload {
  @Field(() => WorkflowVersionModel)
  workflowVersion!: WorkflowVersionModel;

  /** 草稿才有(存草稿後 / 讀草稿時的檢查器結果);已發布 / 退役版為 null。 */
  @Field(() => WorkflowValidationReport, { nullable: true })
  validation!: WorkflowValidationReport | null;
}

/** 版本面板:全部版本(不分頁,GQL-03 天生有上限的清單)。 */
@ObjectType()
export class WorkflowVersionsPayload {
  @Field(() => [WorkflowVersionModel])
  items!: WorkflowVersionModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 匯出的專案設定檔(`exportWorkflowSeed`):內容就是可以直接登記進專案的 TypeScript。 */
@ObjectType()
export class ExportWorkflowSeedPayload {
  /** 固定 `<流程 key>.<revision>.seed.ts`。 */
  @Field(() => String)
  fileName!: string;

  /** 檔案內容(TypeScript 原始碼)。 */
  @Field(() => String)
  source!: string;
}

/** 綁定時檢查的一個問題(Spec 6b §3 表;`problem` 正本 `workflows-error.ts` 的 `BindingIssue`)。 */
@ObjectType()
export class WorkflowBindingIssueModel {
  @Field(() => String)
  stepKey!: string;

  @Field(() => Int)
  stepNumber!: number;

  @Field(() => String)
  problem!: string;

  @Field(() => String)
  detail!: string;
}

/** 表單管理的流程下拉的一項:本租戶看得到且已發布的流程,與它能不能直接綁這張表單。 */
@ObjectType()
export class FormWorkflowOption {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => String)
  workflowName!: string;

  @Field(() => Boolean)
  isShared!: boolean;

  /** 綁定時檢查全過 = 可直接綁;否則看 `issues`(共用流程含角色佔位 → 「建客製流程」捷徑)。 */
  @Field(() => Boolean)
  canBind!: boolean;

  @Field(() => [WorkflowBindingIssueModel])
  issues!: WorkflowBindingIssueModel[];
}

@ObjectType()
export class FormWorkflowOptionsPayload {
  @Field(() => [FormWorkflowOption])
  items!: FormWorkflowOption[];

  @Field(() => Int)
  totalCount!: number;
}

/** 表單的流程綁定(`FormModel.workflowBinding`;表單管理列表的流程綁定欄)。 */
@ObjectType()
export class FormWorkflowBinding {
  @Field(() => ID)
  workflowKey!: string;

  /** 流程已讀不到時為 null。 */
  @Field(() => String, { nullable: true })
  workflowName!: string | null;

  /**
   * false = 「綁定的流程已失效」:流程已被收回分派、讀不到、或沒有已發布版本 ——
   * 這時送出一律被擋(Spec 6b §3),列表要提示管理員重新綁定或解除。
   */
  @Field(() => Boolean)
  isValid!: boolean;
}
