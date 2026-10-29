import { Field, Int, ObjectType, Query, Resolver } from "@nestjs/graphql";

import { RequirePermission } from "../../permission/require-permission.decorator";
import { FORMS_PERMISSIONS } from "../form-permission-keys";
import { LookupProvidersService } from "../lookup-providers";

/** lookup 來源可回的一個欄位(設計器挑顯示欄 / 值欄 / 帶入來源欄位用)。 */
@ObjectType()
export class FormLookupProviderField {
  @Field(() => String)
  key!: string;

  /** 表單引擎的欄位型別(`text`、`number`、`date`…;帶入時驗型別相容)。 */
  @Field(() => String)
  type!: string;

  /** 專案來源宣告的欄位名;底座來源為 null(前端以 i18n 顯示)。 */
  @Field(() => String, { nullable: true })
  label!: string | null;
}

/** lookup 登錄表的一個來源(底座三種 + 專案登記的來源)。 */
@ObjectType()
export class FormLookupProvider {
  /** 來源描述的 `provider`。 */
  @Field(() => String)
  key!: string;

  /** 宣告的來源名稱;底座來源前端以 i18n 顯示。 */
  @Field(() => String)
  name!: string;

  /** 底座來源;false = 專案登記的來源。 */
  @Field(() => Boolean)
  isBase!: boolean;

  /** 換到這個來源時預設的顯示欄。 */
  @Field(() => String)
  labelField!: string;

  /** 換到這個來源時預設的值欄(選項來源用;`id` = 預設)。 */
  @Field(() => String)
  valueField!: string;

  /** 可當固定條件 `filter` 的欄位。 */
  @Field(() => [String])
  filterFields!: string[];

  /** 可回的欄位(`id` 一律可回,不列);`form_submission` 依所選表單而定,這裡為空。 */
  @Field(() => [FormLookupProviderField])
  fields!: FormLookupProviderField[];

  /** 有依操作者的預設值:引用這個來源的欄位,預設值可以選「來源提供的預設」。 */
  @Field(() => Boolean)
  operatorDefault!: boolean;
}

@ObjectType()
export class FormLookupProvidersPayload {
  @Field(() => [FormLookupProvider])
  items!: FormLookupProvider[];

  @Field(() => Int)
  totalCount!: number;
}

/**
 * 設計器的 lookup 來源清單(`docs/modules/forms.md`「lookup 登錄表」):底座來源 + 專案以
 * `LOOKUP_PROVIDER` 登記的來源。只回宣告(不含讀取權限與執行面)。
 */
@Resolver(() => FormLookupProvider)
export class LookupProvidersResolver {
  constructor(private readonly lookups: LookupProvidersService) {}

  @RequirePermission(FORMS_PERMISSIONS.view)
  @Query(() => FormLookupProvidersPayload, { name: "formLookupProviders" })
  formLookupProviders(): FormLookupProvidersPayload {
    const items = this.lookups.summaries().map((summary) => ({
      ...summary,
      filterFields: [...summary.filterFields],
      fields: summary.fields.map((field) => ({ ...field })),
    }));
    return { items, totalCount: items.length };
  }
}
