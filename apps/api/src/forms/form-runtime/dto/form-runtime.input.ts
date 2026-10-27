import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";
import {
  FormSubmissionSort,
  FormSubmissionStatusEnum,
} from "../models/form-submission.model";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 某表單模組的提交列表。範圍不在這裡決定:`form_submissions` 的插件自動套可見範圍 + 資料範圍規則
 * (依 moduleKey);別人的草稿不列(草稿只給建立者本人)。
 */
@InputType()
export class FormSubmissionsInput {
  @Field(() => String)
  moduleKey!: string;

  /** 只列某張表單的提交;缺席 = 模組內全部。 */
  @Field(() => ID, { nullable: true })
  formKey?: string;

  @Field(() => FormSubmissionStatusEnum, { nullable: true })
  status?: FormSubmissionStatusEnum;

  /** 只比對摘要標題(受保護欄位不會被拿來比對)。 */
  @Field(() => String, { nullable: true })
  keyword?: string;

  @Field(() => FormSubmissionSort, {
    nullable: true,
    defaultValue: FormSubmissionSort.SUBMITTED_AT_DESC,
  })
  sort?: FormSubmissionSort;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 新增 = 先建草稿拿到 id;同 `(建立者, clientRequestId)` 重試回同一筆。 */
@InputType()
export class CreateFormDraftInput {
  @Field(() => ID)
  formKey!: string;

  /** 前端在頁面開啟時產生的一次性 id(1–100 字)。 */
  @Field(() => String)
  clientRequestId!: string;

  /** 初始值(帶入後直接建);缺席 = 空白。沒碰過且空著的欄位由後端填預設值。 */
  @Field(() => GraphQLJSONObject, { nullable: true })
  values?: Record<string, unknown> | null;

  /** 使用者碰過的欄位 key(預設值不再覆蓋它們);缺席 = 都沒碰過。 */
  @Field(() => [String], { nullable: true })
  touched?: string[] | null;
}

/**
 * 存草稿。`values` 是**整張表單的狀態**:缺席的欄位 = 清空;看不到的欄位原樣送回 `"[redacted]"` 或不送都算沒動。
 */
@InputType()
export class SaveFormDraftInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  expectedEditVersion!: number;

  @Field(() => GraphQLJSONObject)
  values!: Record<string, unknown>;

  /** 使用者碰過的欄位 key(整份取代);缺席 = 保留目前存的。 */
  @Field(() => [String], { nullable: true })
  touched?: string[] | null;
}

/**
 * 新增頁的 [送出]:一個交易內建立 + 守門 + 送出,失敗時不留任何資料(不產生草稿)。
 * 欄位語意同 `CreateFormDraftInput`;同 `(建立者, clientRequestId)` 重試回同一筆。
 */
@InputType()
export class CreateAndSubmitFormSubmissionInput extends CreateFormDraftInput {}

/**
 * 送出草稿 / 被退回 / 撤回的單(全驗、重算、寫快照)。`values` 缺席 = 以存的值送出;
 * 有值 = 這次畫面上的整張表單狀態(語意同 `SaveFormDraftInput.values`),與送出在同一個交易寫入。
 */
@InputType()
export class SubmitFormSubmissionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  expectedEditVersion!: number;

  @Field(() => GraphQLJSONObject, { nullable: true })
  values?: Record<string, unknown> | null;
}

/** 已完成後修改:修訂 +1 並存完整快照;`values` 語意同 `SaveFormDraftInput`。 */
@InputType()
export class UpdateFormSubmissionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  expectedEditVersion!: number;

  /** = 目前 `revision`;不符 → `CONFLICT`(`REVISION_MISMATCH`)。 */
  @Field(() => Int)
  expectedRevision!: number;

  @Field(() => GraphQLJSONObject)
  values!: Record<string, unknown>;
}

@InputType()
export class DeleteFormSubmissionInput {
  @Field(() => ID)
  id!: string;
}

/** lookup 的目標:版本定義裡的某個欄位(選項 / 引用)或某一條帶入規則,二擇一。 */
@InputType()
export class FormLookupTargetInput {
  @Field(() => String, { nullable: true })
  fieldKey?: string | null;

  @Field(() => Int, { nullable: true })
  prefillIndex?: number | null;
}

/** provider 與 `filter` 從版本定義取,前端只帶「哪一版的哪一個目標」+ 關鍵字。 */
@InputType()
export class FormLookupInput {
  @Field(() => ID)
  formKey!: string;

  /** 版本號;省略 = 草稿(設計器預覽用,需表單管理的檢視權限)。 */
  @Field(() => Int, { nullable: true })
  version?: number | null;

  @Field(() => FormLookupTargetInput)
  target!: FormLookupTargetInput;

  @Field(() => String, { nullable: true })
  keyword?: string | null;

  /**
   * 連動篩選(`filter` 裡的 `{ var: "<欄位 key>" }`)引用欄位目前填的值:`{ <欄位 key>: 語意值 }`。
   * 只取定義裡被引用的欄位、只收純量;api 只把它當成縮小範圍的條件(仍在操作者可見範圍內),
   * 送出時再以存下的值重驗。缺了被引用欄位的值 → 查無。
   */
  @Field(() => GraphQLJSONObject, { nullable: true })
  filterValues?: Record<string, unknown> | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: DEFAULT_PAGE_SIZE })
  pageSize?: number;
}

/**
 * 選項欄(`options.kind = "fieldCategory"`)的當前選項:前端只帶「哪一版的哪一個欄位」+ 關鍵字,
 * 類別 key 從版本定義取(與 `formLookup` 同一原則)。
 */
@InputType()
export class FormFieldOptionsInput {
  @Field(() => ID)
  formKey!: string;

  /** 版本號;省略 = 草稿(設計器預覽用,需表單管理的檢視權限)。 */
  @Field(() => Int, { nullable: true })
  version?: number | null;

  @Field(() => String)
  fieldKey!: string;

  /** 比對顯示名與值(部分比對、不分大小寫);缺席 / 空字串 = 全部。 */
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  /** 每頁筆數,上限 100。 */
  @Field(() => Int, { nullable: true, defaultValue: MAX_PAGE_SIZE })
  pageSize?: number;
}

@InputType()
export class FormLookupRecordInput {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Int, { nullable: true })
  version?: number | null;

  @Field(() => FormLookupTargetInput)
  target!: FormLookupTargetInput;

  /** 同 `FormLookupInput.filterValues`。 */
  @Field(() => GraphQLJSONObject, { nullable: true })
  filterValues?: Record<string, unknown> | null;

  /** 來源資料的 id。 */
  @Field(() => ID)
  id!: string;
}

/** 撤回(申請人本人;審核中、還沒有任何被接受的審核意見)。 */
@InputType()
export class WithdrawSubmissionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  expectedEditVersion!: number;
}

/** 作廢(綁流程且已核准;申請人本人或有模組 `edit`;不需審核)。 */
@InputType()
export class VoidSubmissionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  expectedEditVersion!: number;

  /**
   * 作廢原因的選項值:表單設了作廢原因類別時必填,且要是該類別啟用中的選項(否則 `VALIDATION_FAILED`,
   * `fields: ["reasonKey"]`);沒設類別時不可給。
   */
  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  /**
   * 說明:沒設作廢原因類別時 = 理由,必填(去空白後不可為空);設了類別時選「其他」(`other`)必填、其他選項可空。
   */
  @Field(() => String)
  reasonNote!: string;
}

/** 複製為新單(來源 = 已作廢的提交;同表單目前可新增的版本)。 */
@InputType()
export class CopySubmissionToDraftInput {
  @Field(() => ID)
  id!: string;

  /** 一次性 id(1–100 字);同一個重送回同一筆新草稿。 */
  @Field(() => String)
  clientRequestId!: string;
}

/**
 * 舊版資料升級到新版(只限沒綁流程的表單):改綁 + 補值 + 重算,不驗證。
 * 同 `(操作者, clientRequestId)` 重送回第一次的結果。
 */
@InputType()
export class UpgradeFormSubmissionsInput {
  @Field(() => ID)
  formKey!: string;

  /** 升級到哪一版(必須是已發布的版本)。 */
  @Field(() => Int)
  targetVersion!: number;

  /** 補值:欄位 key → 值(存值形狀);只能是 `formUpgradePlan.fillTargets` 的欄位,只填該筆沒有值的欄位。 */
  @Field(() => GraphQLJSONObject)
  fills!: Record<string, unknown>;

  /** 一次性 id(1–100 字);同一個重送回同一個結果。 */
  @Field(() => String)
  clientRequestId!: string;
}
