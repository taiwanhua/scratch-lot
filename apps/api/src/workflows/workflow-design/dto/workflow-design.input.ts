import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";

/** 清單分頁預設值(與其他清單同一組)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 流程清單:root 看共用流程;租戶看分派來的(已發布)+ 自己的客製流程。 */
@InputType()
export class WorkflowsInput {
  /** 比對 key 與名稱(部分比對、不分大小寫)。 */
  @Field(() => String, { nullable: true })
  keyword?: string;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 建流程:站在根組織 = 共用流程;站在租戶內 = 客製流程(自動建本租戶的 `org_workflow`)。 */
@InputType()
export class CreateWorkflowInput {
  /** `^[a-z][a-z0-9_]{0,39}$`(同表單 key),全域唯一,**建立後不可改**。 */
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;
}

/** 改流程名稱(key 建立後不可改)。 */
@InputType()
export class UpdateWorkflowInput {
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;
}

/** 以某流程的某一版為基底建新流程(副本 + 一份草稿;站在租戶內 = 客製,自動 `org_workflow`)。 */
@InputType()
export class ForkWorkflowInput {
  @Field(() => ID)
  sourceKey!: string;

  /** 來源的已發布或已退役版本號(草稿不能當基底)。 */
  @Field(() => Int)
  sourceVersion!: number;

  /** 新流程的 key(客製預設 `<來源 key>_<orgs.slug>`,由前端帶入可改)。 */
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;
}

@InputType()
export class WorkflowKeyInput {
  @Field(() => ID)
  workflowKey!: string;
}

@InputType()
export class CreateWorkflowVersionDraftInput {
  @Field(() => ID)
  workflowKey!: string;

  /** 以哪一版為基底(已發布或已退役);缺席 / `null` = 空白草稿。 */
  @Field(() => Int, { nullable: true })
  baseVersion?: number | null;
}

/** 連線(關卡 key → 關卡 key)。 */
@InputType()
export class WorkflowEdgeInput {
  @Field(() => String)
  from!: string;

  @Field(() => String)
  to!: string;
}

/** 流程定義:節點(`StepDef`,含 `kind: review | join`)+ 連線;`edges` 缺席 / `null` / 空陣列 = 直線。 */
@InputType()
export class WorkflowDefinitionInput {
  @Field(() => [GraphQLJSONObject])
  steps!: Record<string, unknown>[];

  @Field(() => [WorkflowEdgeInput], { nullable: true })
  edges?: WorkflowEdgeInput[] | null;

  /**
   * 設計器的「檢查用表單」(表單 key)。存草稿:缺席 = 不動已存的值、`null` / 空字串 = 清掉;
   * 檢查器(`validateWorkflowVersion`)在外層 `checkFormKey` 缺席時才看這裡。
   */
  @Field(() => ID, { nullable: true })
  checkFormKey?: string | null;

  /**
   * 整個流程的知會對象(`AssigneeSource` 的 JSON,來源同審核者三種):單據完成、被駁回、被作廢時通知。
   * 存草稿:缺席 = 不動已存的值、`null` = 清掉。關卡的知會在各關的 `cc`。
   */
  @Field(() => GraphQLJSONObject, { nullable: true })
  cc?: Record<string, unknown> | null;
}

@InputType()
export class SaveWorkflowVersionDraftInput {
  @Field(() => ID)
  workflowKey!: string;

  /** 樂觀鎖:草稿目前的 `draftRevision`;不符 → `CONFLICT`。 */
  @Field(() => Int)
  expectedDraftRevision!: number;

  @Field(() => WorkflowDefinitionInput)
  definition!: WorkflowDefinitionInput;
}

@InputType()
export class PublishWorkflowVersionInput {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => Int)
  expectedDraftRevision!: number;

  /** 必填。 */
  @Field(() => String)
  changelog!: string;
}

/** 刪除草稿(`expectedDraftRevision` 樂觀鎖;發布進行中 / 中斷時不可)。 */
@InputType()
export class DeleteWorkflowVersionDraftInput {
  @Field(() => ID)
  workflowKey!: string;

  /** 草稿目前的 `draftRevision`;不符 → `CONFLICT`(`DRAFT_REVISION_MISMATCH`)。 */
  @Field(() => Int)
  expectedDraftRevision!: number;
}

/** 設計器即時檢查(不落庫)。 */
@InputType()
export class ValidateWorkflowVersionInput {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => WorkflowDefinitionInput)
  definition!: WorkflowDefinitionInput;

  /**
   * 「檢查用表單」:跳過條件對它的目前版本驗。缺席 / `null` 時改看 `definition.checkFormKey`;
   * 兩者都沒有 = 用第一個 `field` 來源的表單。
   */
  @Field(() => ID, { nullable: true })
  checkFormKey?: string | null;
}

/** 把共用流程的某個已發布版本匯出成專案設定檔(唯讀;只有站在根組織才能做)。 */
@InputType()
export class ExportWorkflowSeedInput {
  @Field(() => ID)
  workflowKey!: string;

  /** 要匯出的版本號:必須是已發布的版本,不會以目前版本代替。 */
  @Field(() => Int)
  version!: number;

  /** 專案內這個流程的發布識別:小寫英數開頭,後接小寫英數 / 底線 / 連字號,最長 64。 */
  @Field(() => String)
  revision!: string;

  /** 發布說明,必填(隨設定交付,安裝時當成該版的變更說明)。 */
  @Field(() => String)
  changelog!: string;
}

/** root 分派共用流程給租戶(建 `org_workflow`);已分派的略過。 */
@InputType()
export class AssignWorkflowToTenantsInput {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => [ID])
  tenantOrgIds!: string[];
}

@InputType()
export class RevokeWorkflowFromTenantInput {
  @Field(() => ID)
  workflowKey!: string;

  @Field(() => ID)
  tenantOrgId!: string;
}

/** 本租戶的某張表單送出後走哪個流程(`org_form_workflow` upsert;換流程 = 改指向)。 */
@InputType()
export class BindFormWorkflowInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => ID)
  workflowKey!: string;
}

/** 解除本租戶某張表單的流程綁定(刪 `org_form_workflow`)。 */
@InputType()
export class UnbindFormWorkflowInput {
  @Field(() => ID)
  formKey!: string;
}
