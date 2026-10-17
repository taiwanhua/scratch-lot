import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";
import {
  FormFieldState,
  FormSubmissionSummary,
  FormUserRef,
} from "../../models/form-common.model";

/**
 * 提交狀態(成員值即落庫字串;正本 `@repo/domain/workflow` 的 `SUBMISSION_STATUSES`;
 * 與表單模組 seed 的資料範圍 `status` 選項一一對應;不綁流程的表單只用到草稿 / 已完成)。
 */
export enum FormSubmissionStatusEnum {
  DRAFT = "draft",
  REVIEWING = "reviewing",
  RETURNED = "returned",
  WITHDRAWN = "withdrawn",
  COMPLETED = "completed",
  REJECTED = "rejected",
  VOIDED = "voided",
}

registerEnumType(FormSubmissionStatusEnum, {
  name: "FormSubmissionStatus",
  description:
    "提交狀態:草稿 / 審核中 / 已退回 / 已撤回 / 已完成 / 已駁回 / 已作廢(不綁流程的表單送出即完成)",
});

/** 列表排序。 */
export enum FormSubmissionSort {
  SUBMITTED_AT_DESC = "SUBMITTED_AT_DESC",
  SUBMITTED_AT_ASC = "SUBMITTED_AT_ASC",
  UPDATED_AT_DESC = "UPDATED_AT_DESC",
}

registerEnumType(FormSubmissionSort, {
  name: "FormSubmissionSort",
  description: "提交列表的排序(預設送出時間新到舊;草稿沒有送出時間,排在最後)",
});

/** 新增選單的一張表單(`moduleForms` 的交集結果;能不能用它新增看 `canCreate`)。 */
@ObjectType()
export class FormSummary {
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  moduleKey!: string;

  /** 新增時綁的版本。 */
  @Field(() => Int)
  currentVersion!: number;

  @Field(() => String, { nullable: true })
  tabLabelTemplate!: string | null;

  /** 允許存草稿(表單設定;沒設過 = true):false 時新增頁不顯示 [存草稿]。 */
  @Field(() => Boolean)
  allowDraft!: boolean;

  /**
   * 讀者能不能用這張表單新增(`canCreateWithForm`;B9b 模組看 `create-<formKey>`,其餘看模組 `create`)。
   * 列表的表單篩選、頁籤模板要整份清單;[+ 新增] 與新增頁只認 `canCreate = true` 的表單。
   */
  @Field(() => Boolean)
  canCreate!: boolean;
}

/** 顯示名的一項(選項 / 引用):來源還在且讀者有權 → 現名;否則快照 + `available: false`。 */
@ObjectType()
export class FormDisplayItem {
  /** 選項的 value 或引用的 id。 */
  @Field(() => String)
  value!: string;

  @Field(() => String, { nullable: true })
  label!: string | null;

  /** false = 來源已刪或讀者無權,前端在快照後標「(來源不可用)」。 */
  @Field(() => Boolean)
  available!: boolean;
}

/** 一欄的顯示名(類別 / lookup 選項、`reference`;靜態選項的 label 從版本定義取,不在這裡)。 */
@ObjectType()
export class FormDisplayValue {
  @Field(() => String)
  fieldKey!: string;

  @Field(() => [FormDisplayItem])
  items!: FormDisplayItem[];
}

/**
 * 一次送出 / 修改的上下文(唯讀檢視重算條件用;表達式的 `ctx.*`):`orgId` = 當時的目前組織、
 * `orgIds` = 當時的所屬組織(全部;舊修訂 = 空陣列)、`tenantId` = 當時的租戶(根組織 / 舊修訂 = null)。
 */
@ObjectType()
export class FormSubmissionContext {
  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => String)
  timezone!: string;

  @Field(() => ID, { nullable: true })
  userId!: string | null;

  @Field(() => ID, { nullable: true })
  orgId!: string | null;

  @Field(() => [ID])
  orgIds!: string[];

  @Field(() => ID, { nullable: true })
  tenantId!: string | null;
}

/** 修訂紀錄的一筆(值要看時以 `formSubmission(id, revision)` 讀,差異由相鄰兩筆算)。 */
@ObjectType()
export class FormSubmissionRevisionMeta {
  @Field(() => Int)
  revision!: number;

  /** 這個修訂填寫當時綁的版本(歷史修訂用它的定義渲染;舊資料 = 提交目前的版本)。 */
  @Field(() => Int)
  version!: number;

  /** 修訂的來由:`upgrade` = 舊版資料升級到新版(改綁 + 補值 + 重算,不驗證);一般送出 / 修改為 null。 */
  @Field(() => String, { nullable: true })
  kind!: string | null;

  /** 升級產生的修訂:誰升級(`at` / `user` 是沿用的 ctx,不是升級的人與時間)。 */
  @Field(() => FormUserRef, { nullable: true })
  upgradedBy!: FormUserRef | null;

  /** 升級產生的修訂:什麼時候升級。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  upgradedAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => FormUserRef, { nullable: true })
  user!: FormUserRef | null;
}

/**
 * 這筆提交**對這位操作者**允許的動作,已含權限判斷(業務模組那一種 `abilities`,GQL-07):前端直接用。
 */
@ObjectType()
export class FormSubmissionAbilities {
  /** 草稿:建立者本人 + 模組 `create`;已完成:模組 `edit`。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /**
   * [存草稿]:草稿 / 被退回 / 撤回、建立者本人 + 模組 `create`,且表單允許存草稿(表單設定)。
   * false 時編輯頁只有 [送出](關掉前已存在的草稿照樣可以送出、刪除)。
   */
  @Field(() => Boolean)
  canSaveDraft!: boolean;

  /** 草稿:建立者本人 + 模組 `create`;不綁流程的已完成 / 已駁回:模組 `delete`。 */
  @Field(() => Boolean)
  canDelete!: boolean;

  /** 撤回:申請人本人、審核中(是否已有審核意見以實例的 `abilities.canWithdraw` 為準)。 */
  @Field(() => Boolean)
  canWithdraw!: boolean;

  /** 作廢:綁流程且已核准(`completed` + 走過流程);申請人本人或有模組 `edit`。 */
  @Field(() => Boolean)
  canVoid!: boolean;

  /** 複製為新單:已作廢;讀得到這筆且可新增該表單(模組 `create`)。 */
  @Field(() => Boolean)
  canCopy!: boolean;

  /**
   * 權限層面改得動的欄位 key(使用者填的欄位、看得到、有 `edit-…`(若該欄設了));
   * `canEdit` 為 false 時為空陣列。條件唯讀看 `fieldStates.readonly`。
   */
  @Field(() => [String])
  canEditField!: string[];
}

@ObjectType()
export class FormSubmissionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  moduleKey!: string;

  @Field(() => ID)
  formKey!: string;

  @Field(() => String, { nullable: true })
  formName!: string | null;

  /** 綁的表單版本。 */
  @Field(() => Int)
  version!: number;

  @Field(() => FormSubmissionStatusEnum)
  status!: FormSubmissionStatusEnum;

  /** 目前修訂號(草稿 0、送出 1、之後每改一次 +1)。 */
  @Field(() => Int)
  revision!: number;

  /** 這次回傳的是哪一個修訂的值(`formSubmission(id, revision)`;省略 = 目前)。 */
  @Field(() => Int)
  viewedRevision!: number;

  /**
   * 值(欄位 key → 存值,形狀見 Spec §5「值的存法」)。讀者沒有 `show` 的欄位(含因依賴而受保護的
   * 計算欄位)為 `"[redacted]"`;唯讀讀取不重算、不清空存值。
   */
  @Field(() => GraphQLJSONObject)
  values!: Record<string, unknown>;

  /** 各欄的顯示 / 唯讀條件(用該修訂的 `ctx` 算)與是否被遮蔽。 */
  @Field(() => [FormFieldState])
  fieldStates!: FormFieldState[];

  @Field(() => [FormDisplayValue])
  displayValues!: FormDisplayValue[];

  @Field(() => FormSubmissionSummary, { nullable: true })
  summary!: FormSubmissionSummary | null;

  /** 這次回傳的修訂的上下文;草稿為 null。 */
  @Field(() => FormSubmissionContext, { nullable: true })
  ctx!: FormSubmissionContext | null;

  /**
   * 這次回傳的修訂用哪一版的定義渲染(`revisions[r].version ?? version`;目前 = `version`)。
   * 舊版資料升級過的提交,歷史修訂可能綁在較舊的版本。
   */
  @Field(() => Int)
  viewedVersion!: number;

  /**
   * 修訂紀錄(field resolver 惰性讀;列表與詳情不載入 `revisions[]`,只有修訂紀錄跳窗問才查)。
   * 只審過某些修訂的讀者只列那幾筆。
   */
  @Field(() => [FormSubmissionRevisionMeta])
  revisions?: FormSubmissionRevisionMeta[];

  /** 寫入的樂觀鎖:存草稿 / 送出 / 修改都帶它當 `expectedEditVersion`。 */
  @Field(() => Int)
  editVersion!: number;

  @Field(() => ID)
  orgId!: string;

  @Field(() => FormUserRef, { nullable: true })
  createdBy!: FormUserRef | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  submittedAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  /** 進行中或最後一個流程實例;null = 沒走過流程(`completed` 後可修改)。 */
  @Field(() => ID, { nullable: true })
  currentInstanceId!: string | null;

  /** 實例被阻擋(列表 chip 顯示「審核中(待處理)」)。 */
  @Field(() => Boolean)
  blocked!: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  voidedAt!: Date | null;

  @Field(() => String, { nullable: true })
  voidReason!: string | null;

  /** 「複製為新單」建出的那筆。 */
  @Field(() => ID, { nullable: true })
  replacedById!: string | null;

  /** 這筆草稿是從哪一筆複製來的。 */
  @Field(() => ID, { nullable: true })
  copiedFrom!: string | null;

  /** 使用者碰過的欄位 key(草稿填寫時用來決定預設值還要不要跟著重算)。 */
  @Field(() => [String])
  touched!: string[];

  /**
   * 複製為新單時被清空的欄位(來源的引用已讀不到);只有 `copySubmissionToDraft` 的回傳有值,
   * 其他讀取為空陣列。
   */
  @Field(() => [String])
  clearedFields!: string[];

  @Field(() => FormSubmissionAbilities)
  abilities!: FormSubmissionAbilities;
}

@ObjectType()
export class FormSubmissionsPayload {
  @Field(() => [FormSubmissionModel])
  items!: FormSubmissionModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class FormSubmissionPayload {
  @Field(() => FormSubmissionModel)
  submission!: FormSubmissionModel;
}

@ObjectType()
export class DeleteFormSubmissionPayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => ID)
  deletedId!: string;
}

@ObjectType()
export class FormSubmissionAttachmentUrlPayload {
  @Field(() => String)
  url!: string;
}

/** lookup 的一筆:`values` 只含讀者讀得到的欄位(受保護無權的省略;舊版本沒有的為 null)。 */
@ObjectType()
export class FormLookupRecord {
  /** 來源資料的 id(引用存它)。 */
  @Field(() => ID)
  id!: string;

  /** 選項 / 引用要存的值(`valueField`,預設 id)。 */
  @Field(() => String, { nullable: true })
  value!: string | null;

  /** 顯示名(`labelField`)。 */
  @Field(() => String, { nullable: true })
  label!: string | null;

  /** 帶入規則的來源欄位 → 值(語意值;`form_submission` 來源依每筆自己的版本)。 */
  @Field(() => GraphQLJSONObject)
  values!: Record<string, unknown>;
}

@ObjectType()
export class FormLookupPayload {
  @Field(() => [FormLookupRecord])
  items!: FormLookupRecord[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class FormLookupRecordPayload {
  /** 讀不到(不存在或無權)為 null。 */
  @Field(() => FormLookupRecord, { nullable: true })
  record!: FormLookupRecord | null;
}

/** 選項欄的一個當前選項(存值時寫 `{ value, label }`,Spec §5「值的存法」)。 */
@ObjectType()
export class FormFieldOption {
  @Field(() => String)
  value!: string;

  @Field(() => String)
  label!: string;
}

@ObjectType()
export class FormFieldOptionsPayload {
  /** 只列啟用中的選項(停用的只在顯示既有值時算「來源還在」)。 */
  @Field(() => [FormFieldOption])
  items!: FormFieldOption[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}
