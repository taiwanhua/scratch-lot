import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../data-scope/json-object.scalar";
import {
  FormFieldError,
  FormFieldState,
  FormSubmissionSummary,
  FormVersionModel,
} from "../../models/form-common.model";

/** 單號格式(`@repo/domain/form` 的 `SerialFormat`)。 */
@ObjectType()
export class FormSerialFormat {
  /** 前綴(英數 0–10 字,可空)。 */
  @Field(() => String)
  prefix!: string;

  /** 流水號多久重新起算:`none` / `year` / `month`(租戶時區)。 */
  @Field(() => String)
  period!: string;

  /** 流水號補零的位數(1–10)。 */
  @Field(() => Int)
  digits!: number;

  /** 分隔符(`-` `_` `/` `.` 或空字串);null = 預設 `-`。 */
  @Field(() => String, { nullable: true })
  separator!: string | null;
}

/** 客製表單的來源。 */
@ObjectType()
export class FormForkSourceModel {
  @Field(() => ID)
  formKey!: string;

  @Field(() => Int)
  version!: number;
}

/** 共用表單分派給某租戶的狀態(只有 root 看得到這份清單)。 */
@ObjectType()
export class FormAssignment {
  @Field(() => ID)
  tenantOrgId!: string;

  @Field(() => String, { nullable: true })
  tenantName!: string | null;

  /** 租戶自己的開關(`org_form.meta.enabled`)。 */
  @Field(() => Boolean)
  enabled!: boolean;
}

/**
 * 這張表單**對這位操作者**允許的設計端動作,已含權限判斷(業務模組那一種 `abilities`,GQL-07):
 * 前端直接用,不再與 `usePermissions` 相乘。
 */
@ObjectType()
export class FormAbilities {
  /** 改名稱、開 / 存草稿、發布、重試、退役(`system.forms.edit` + 是自己擁有的表單)。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 分派 / 收回(`system.forms.assign` + 站在根組織 + 共用表單)。 */
  @Field(() => Boolean)
  canAssign!: boolean;

  /** 租戶內開關(`system.forms.set-enabled` + 站在租戶內 + 本租戶有這張的 `org_form`)。 */
  @Field(() => Boolean)
  canSetEnabled!: boolean;

  /** 以它的某一版為基底建新表單(`system.forms.create`)。 */
  @Field(() => Boolean)
  canFork!: boolean;
}

@ObjectType()
export class FormModel {
  @Field(() => ID)
  id!: string;

  /** 全域唯一,建立後不可改。 */
  @Field(() => ID)
  key!: string;

  @Field(() => String)
  moduleKey!: string;

  /** 模組顯示名(模組不存在時為 null)。 */
  @Field(() => String, { nullable: true })
  moduleName!: string | null;

  @Field(() => String)
  name!: string;

  /** 共用表單(root 管,`ownerOrgId = null`)。 */
  @Field(() => Boolean)
  isShared!: boolean;

  /** 客製表單的擁有租戶。 */
  @Field(() => ID, { nullable: true })
  ownerOrgId!: string | null;

  @Field(() => String, { nullable: true })
  ownerOrgName!: string | null;

  @Field(() => FormForkSourceModel, { nullable: true })
  forkedFrom!: FormForkSourceModel | null;

  /** 目前已發布版本號;null = 尚未發布或已退役目前版本。 */
  @Field(() => Int, { nullable: true })
  currentVersion!: number | null;

  @Field(() => String, { nullable: true })
  tabLabelTemplate!: string | null;

  /** 允許存草稿(表單設定);沒設過的舊表單為 true。 */
  @Field(() => Boolean)
  allowDraft!: boolean;

  /** 單號格式(第一次送出時給號);null = 不給號。 */
  @Field(() => FormSerialFormat, { nullable: true })
  serial!: FormSerialFormat | null;

  /** 作廢原因的欄位管理類別 key(表單設定);null = 作廢原因自由填寫。 */
  @Field(() => String, { nullable: true })
  voidReasonCategoryKey!: string | null;

  /** 有一份草稿(版本面板的「編輯草稿」)。 */
  @Field(() => Boolean)
  hasDraft!: boolean;

  /** 站在租戶內時,本租戶對這張的開關(`org_form.meta.enabled`);root 視角為 null。 */
  @Field(() => Boolean, { nullable: true })
  tenantEnabled!: boolean | null;

  /** 分派清單(只有 root 視角的共用表單有;其餘為空陣列)。 */
  @Field(() => [FormAssignment])
  assignments!: FormAssignment[];

  @Field(() => FormAbilities)
  abilities!: FormAbilities;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class FormsPayload {
  @Field(() => [FormModel])
  items!: FormModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class FormPayload {
  @Field(() => FormModel)
  form!: FormModel;
}

/** 版本面板的版本清單(新到舊;不分頁)。 */
@ObjectType()
export class FormVersionsPayload {
  @Field(() => [FormVersionModel])
  items!: FormVersionModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 匯出的專案設定檔(`exportFormSeed`):內容就是可以直接登記進專案的 TypeScript。 */
@ObjectType()
export class ExportFormSeedPayload {
  /** 固定 `<表單 key>.<revision>.seed.ts`。 */
  @Field(() => String)
  fileName!: string;

  /** 檔案內容(TypeScript 原始碼)。 */
  @Field(() => String)
  source!: string;
}

/** 設計器「預覽」:對草稿跑計算與條件的結果,不建提交。 */
@ObjectType()
export class FormPreviewPayload {
  /** 計算欄位已由後端算好、隱藏欄位已清空的值。 */
  @Field(() => GraphQLJSONObject)
  values!: Record<string, unknown>;

  @Field(() => [FormFieldState])
  fieldStates!: FormFieldState[];

  @Field(() => FormSubmissionSummary)
  summary!: FormSubmissionSummary;

  /** 若此刻送出會出現的值錯誤(不擋預覽)。 */
  @Field(() => [FormFieldError])
  fieldErrors!: FormFieldError[];
}

/** 退役權限被多少提交用到(三層檢查的依據)。 */
@ObjectType()
export class RetiredPermissionUsage {
  @Field(() => Int)
  draftCount!: number;

  @Field(() => [Int])
  draftVersions!: number[];

  @Field(() => Int)
  completedCount!: number;

  @Field(() => [Int])
  completedVersions!: number[];
}

/** 一筆已退役的欄位級權限(`source = dynamic`、`retiredAt` 有值)。 */
@ObjectType()
export class RetiredFormPermission {
  @Field(() => ID)
  key!: string;

  /** 「<表單名> / <欄位 label> 可見 / 可改」。 */
  @Field(() => String)
  name!: string;

  @Field(() => String)
  moduleKey!: string;

  @Field(() => ID)
  formKey!: string;

  @Field(() => String, { nullable: true })
  formName!: string | null;

  @Field(() => String)
  fieldKey!: string;

  /** `show` / `edit`。 */
  @Field(() => String)
  action!: string;

  @Field(() => GraphQLISODateTime)
  retiredAt!: Date;

  @Field(() => RetiredPermissionUsage)
  usage!: RetiredPermissionUsage;
}

@ObjectType()
export class RetiredFormPermissionsPayload {
  @Field(() => [RetiredFormPermission])
  items!: RetiredFormPermission[];

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class DeleteRetiredPermissionPayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => ID)
  deletedKey!: string;

  /** 刪除當下的使用狀況(`completedCount > 0` 表示這些單裡的該欄位從此只有 root 看得到)。 */
  @Field(() => RetiredPermissionUsage)
  usage!: RetiredPermissionUsage;
}
