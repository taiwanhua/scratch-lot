import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/**
 * 表單引擎的共用 GraphQL 型別(設計端與執行端都回;GQL-01 / GQL-02 命名一律帶 `Form` 前綴)。
 * 欄位定義(`fields` / `layout` / `summaryMap` / `prefills`)與值(`values`)以 `JSONObject` 進出:
 * 形狀正本是 `@repo/domain/form`,驗證只在 api 做一次(同資料範圍條件樹的理由)。
 */

/** 版本狀態(成員值即落庫字串;語意見 `database/schemas/form-version.schema.ts`)。 */
export enum FormVersionStatusEnum {
  DRAFT = "draft",
  PUBLISHING = "publishing",
  PUBLISHED = "published",
  RETIRED = "retired",
}

registerEnumType(FormVersionStatusEnum, {
  name: "FormVersionStatus",
  description: "表單版本狀態:草稿 / 發布中(中斷可重試)/ 已發布(供新增)/ 已退役",
});

/** 使用者的最小參照(發布者、建立者、修訂的操作者)。 */
@ObjectType()
export class FormUserRef {
  @Field(() => ID)
  id!: string;

  /** 使用者已被刪除時為 null(前端顯示「—」)。 */
  @Field(() => String, { nullable: true })
  name!: string | null;
}

/** 表單的一版(草稿或已發布 / 退役版);定義四塊的形狀見 `@repo/domain/form` 的型別。 */
@ObjectType()
export class FormVersionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  formKey!: string;

  /** 正式版號;草稿為 null(發布步驟 2 才配)。 */
  @Field(() => Int, { nullable: true })
  version!: number | null;

  @Field(() => FormVersionStatusEnum)
  status!: FormVersionStatusEnum;

  /** 草稿的樂觀鎖:存草稿 / 發布要帶它當 `expectedDraftRevision`。 */
  @Field(() => Int)
  draftRevision!: number;

  /** 以哪一版為基底開的草稿;全新為 null。 */
  @Field(() => Int, { nullable: true })
  baseVersion!: number | null;

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

  @Field(() => String, { nullable: true })
  changelog!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  publishedAt!: Date | null;

  @Field(() => FormUserRef, { nullable: true })
  publishedBy!: FormUserRef | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

/** 定義檢查器的一筆錯誤 / 警告(`@repo/domain/form` 的 `DefinitionIssue`)。 */
@ObjectType()
export class FormDefinitionIssue {
  @Field(() => String)
  code!: string;

  /** 給設計者看的繁中說明。 */
  @Field(() => String)
  message!: string;

  /** 定位:`{ fieldKey?, exprSlot?, exprPath?, layoutPath?, summarySlot?, prefillIndex?, property? }`。 */
  @Field(() => GraphQLJSONObject)
  location!: Record<string, unknown>;
}

/** 檢查器的結果:有錯不能發布,警告可發布。 */
@ObjectType()
export class FormValidationReport {
  @Field(() => [FormDefinitionIssue])
  errors!: FormDefinitionIssue[];

  @Field(() => [FormDefinitionIssue])
  warnings!: FormDefinitionIssue[];
}

/** 發布時新建的依表單新增權限:不自動授予,發布成功畫面提示到角色管理授予。 */
@ObjectType()
export class FormCreatePermission {
  /** `<模組>.create-<formKey>` */
  @Field(() => String)
  key!: string;

  /** 「<表單名> 新增」 */
  @Field(() => String)
  name!: string;
}

/** 單一版本的查詢 / 寫入回傳。 */
@ObjectType()
export class FormVersionPayload {
  @Field(() => FormVersionModel)
  formVersion!: FormVersionModel;

  /** 草稿的檢查器結果(存草稿、讀草稿時附上;已發布版為 null)。 */
  @Field(() => FormValidationReport, { nullable: true })
  validation!: FormValidationReport | null;

  /**
   * 只有發布(`publishFormVersion`)會給:這次發布新建的依表單新增權限(模組開啟依表單分開新增權限且第一次發布);
   * 其餘情況(已存在、模組沒開、非發布的端點)為 null。
   */
  @Field(() => FormCreatePermission, { nullable: true })
  createdPermission?: FormCreatePermission | null;
}

/** 一欄在這次渲染的狀態(後端依條件與讀者權限算好)。 */
@ObjectType()
export class FormFieldState {
  @Field(() => String)
  key!: string;

  /** `visibleWhen` 的結果(沒有條件 = true)。 */
  @Field(() => Boolean)
  visible!: boolean;

  /** `readonlyWhen` 的結果(沒有條件 = false;權限造成的唯讀看 `abilities.canEditField`)。 */
  @Field(() => Boolean)
  readonly!: boolean;

  /** 讀者沒有這欄的 `show`(含依賴鏈):值已投影成 `"[redacted]"`。 */
  @Field(() => Boolean)
  redacted!: boolean;
}

/** 值錯誤的一筆(與 `VALIDATION_FAILED` 的 `extensions.fieldErrors` 同形)。 */
@ObjectType()
export class FormFieldError {
  @Field(() => String)
  fieldKey!: string;

  @Field(() => String)
  code!: string;

  @Field(() => String)
  message!: string;
}

/** 摘要槽快照(`form_submissions.summary`)。 */
@ObjectType()
export class FormSubmissionSummary {
  @Field(() => String, { nullable: true })
  title!: string | null;

  /** `YYYY-MM-DD` 或 ISO 時間(`summaryMap.date` 沒對欄位時 = 送出時間)。 */
  @Field(() => String, { nullable: true })
  date!: string | null;

  /** 十進位字串;`summaryMap.amount` 沒對欄位時為 null。 */
  @Field(() => String, { nullable: true })
  amount!: string | null;
}
