import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";

/** 清單分頁預設值(與其他清單同一組)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 表單清單:root 看全部;租戶看分派來的 + 自己的客製表單(`docs/modules/forms.md`)。 */
@InputType()
export class FormsInput {
  /** 只列某個表單模組的表單;缺席 = 全部模組。 */
  @Field(() => String, { nullable: true })
  moduleKey?: string;

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

/** 建共用表單(只有站在根組織才能建;租戶走 `forkForm`)。 */
@InputType()
export class CreateFormInput {
  /** `^[a-z][a-z0-9_]{0,39}$`,全域唯一,**建立後不可改**。 */
  @Field(() => ID)
  key!: string;

  /** 表單模組(`modules.engine = "form"`)。 */
  @Field(() => String)
  moduleKey!: string;

  @Field(() => String)
  name!: string;
}

/** 單號格式(形狀與檢查正本 `@repo/domain/form` 的 `SerialFormat` / `serialFormatIssues`)。 */
@InputType()
export class FormSerialFormatInput {
  @Field(() => String)
  prefix!: string;

  /** `none` / `year` / `month`。 */
  @Field(() => String)
  period!: string;

  @Field(() => Int)
  digits!: number;

  /** 缺席 / null = 預設 `-`。 */
  @Field(() => String, { nullable: true })
  separator?: string | null;
}

/**
 * 改表單的名稱 / 頁籤模板 / 允許存草稿 / 單號格式;缺席 = 不動,`tabLabelTemplate: null` = 清空(改回模組層模板),
 * `allowDraft: null` = 不動,`serial: null` = 不給號(已給出的號碼不收回),
 * `voidReasonCategoryKey: null` / 空白 = 清空(作廢原因改回自由填寫)。
 */
@InputType()
export class UpdateFormInput {
  @Field(() => ID)
  key!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  tabLabelTemplate?: string | null;

  @Field(() => Boolean, { nullable: true })
  allowDraft?: boolean | null;

  @Field(() => FormSerialFormatInput, { nullable: true })
  serial?: FormSerialFormatInput | null;

  /** 作廢原因的欄位管理類別 key;要是存在的類別(`VALIDATION_FAILED`,`fields: ["voidReasonCategoryKey"]`)。 */
  @Field(() => String, { nullable: true })
  voidReasonCategoryKey?: string | null;
}

/** 以某表單的某一版為基底建新表單(客製副本 + 一份草稿,同模組)。 */
@InputType()
export class ForkFormInput {
  @Field(() => ID)
  sourceKey!: string;

  /** 來源的已發布或已退役版本號(草稿不能當基底)。 */
  @Field(() => Int)
  sourceVersion!: number;

  /** 新表單的 key(客製預設 `<來源 key>_<orgs.slug>`,由前端帶入可改);建立後不可改。 */
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;
}

@InputType()
export class CreateFormVersionDraftInput {
  @Field(() => ID)
  formKey!: string;

  /** 以哪一版為基底(已發布或已退役);缺席 / null = 全新空白。 */
  @Field(() => Int, { nullable: true })
  baseVersion?: number | null;
}

/** 表單定義的四塊(形狀正本 `@repo/domain/form`;以 JSON 進出,api 一次驗完)。 */
@InputType()
export class FormDefinitionInput {
  /** `FieldDef[]`。 */
  @Field(() => [GraphQLJSONObject])
  fields!: Record<string, unknown>[];

  /** `Layout`。 */
  @Field(() => GraphQLJSONObject)
  layout!: Record<string, unknown>;

  /** `{ title, date, amount? } → fieldKey`。 */
  @Field(() => GraphQLJSONObject)
  summaryMap!: Record<string, unknown>;

  /** `Prefill[]`。 */
  @Field(() => [GraphQLJSONObject])
  prefills!: Record<string, unknown>[];
}

@InputType()
export class SaveFormVersionDraftInput extends FormDefinitionInput {
  @Field(() => ID)
  formKey!: string;

  /** 讀到的 `draftRevision`;不符 → `CONFLICT`(`DRAFT_REVISION_MISMATCH`)。 */
  @Field(() => Int)
  expectedDraftRevision!: number;
}

@InputType()
export class ValidateFormVersionInput extends FormDefinitionInput {
  @Field(() => ID)
  formKey!: string;
}

@InputType()
export class PublishFormVersionInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Int)
  expectedDraftRevision!: number;

  /** 發布說明,必填。 */
  @Field(() => String)
  changelog!: string;
}

/** 刪除表單草稿(`expectedDraftRevision` 樂觀鎖;發布中不可)。 */
@InputType()
export class DeleteFormVersionDraftInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Int)
  expectedDraftRevision!: number;
}

/** 退役目前版本:帶當時看到的版本號(`currentVersion` 已指向別的版本 → 409)。 */
@InputType()
export class RetireCurrentVersionInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Int)
  expectedVersion!: number;
}

/** 把共用表單的某個已發布版本匯出成專案設定檔(唯讀;只有站在根組織才能做)。 */
@InputType()
export class ExportFormSeedInput {
  @Field(() => ID)
  formKey!: string;

  /** 要匯出的版本號:必須是已發布的版本,不會以目前版本代替。 */
  @Field(() => Int)
  version!: number;

  /** 專案內這張表單的發布識別:小寫英數開頭,後接小寫英數 / 底線 / 連字號,最長 64。 */
  @Field(() => String)
  revision!: string;

  /** 發布說明,必填(隨設定交付,安裝時當成該版的變更說明)。 */
  @Field(() => String)
  changelog!: string;
}

@InputType()
export class AssignFormToTenantsInput {
  @Field(() => ID)
  formKey!: string;

  /** 租戶頂層 id;已分派的略過(冪等)。 */
  @Field(() => [ID])
  tenantOrgIds!: string[];
}

@InputType()
export class RevokeFormFromTenantInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => ID)
  tenantOrgId!: string;
}

@InputType()
export class SetTenantFormEnabledInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Boolean)
  enabled!: boolean;
}

@InputType()
export class PreviewFormVersionInput {
  @Field(() => ID)
  formKey!: string;

  /** 測試值(欄位 key → 值);缺席的欄位當空值。 */
  @Field(() => GraphQLJSONObject, { nullable: true })
  values?: Record<string, unknown> | null;

  /** 缺席或 null = 草稿;有值 = 該已發布 / 已退役版本(版本面板檢視歷史版本時的預覽)。 */
  @Field(() => Int, { nullable: true })
  version?: number | null;
}

@InputType()
export class DeleteRetiredPermissionInput {
  @Field(() => ID)
  permissionKey!: string;

  /** 只剩已完成的提交用到時,要帶 true 才刪(否則 `PERMISSION_NOT_DELETABLE` + `CONFIRM_REQUIRED`)。 */
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  confirmCompletedUsage?: boolean;
}
