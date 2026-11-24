import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { ShareOrgInput } from "../../../../sharing/share-org.model";
import { LotteryWholesaleCustomerStatusEnum } from "../models/lottery-wholesale-customer.model";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./lottery-dealer.input";

/** 批售客戶清單:篩選狀態、關鍵字(店名、證號、聯絡人、電話)。 */
@InputType()
export class LotteryWholesaleCustomersInput {
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => LotteryWholesaleCustomerStatusEnum, { nullable: true })
  status?: LotteryWholesaleCustomerStatusEnum | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 同名提醒:租戶內店名相同(前後空白去掉後完全相同)、還沒刪除的批售客戶;`excludeId` = 正在編輯的那一筆。 */
@InputType()
export class LotteryWholesaleCustomerSameNamesInput {
  @Field(() => String)
  storeName!: string;

  @Field(() => ID, { nullable: true })
  excludeId?: string | null;
}

@InputType({ isAbstract: true })
abstract class LotteryWholesaleCustomerFieldsInput {
  @Field(() => String, { nullable: true })
  storeName?: string | null;

  @Field(() => String, { nullable: true })
  licenseNo?: string | null;

  @Field(() => String, { nullable: true })
  contactName?: string | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  @Field(() => LotteryWholesaleCustomerStatusEnum, { nullable: true })
  status?: LotteryWholesaleCustomerStatusEnum | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /**
   * 共用給(資料共用,ADR-0014):整份清單;要有 `dealers.wholesale-customers.edit`(沒有 → `FORBIDDEN`)。
   * 組織要在同一個租戶(可以是自己看不到的),否則 `VALIDATION_FAILED`(fields: ["shareOrgs"])。
   * 新增:缺席 / `null` = 不共用;編輯:缺席 = 不動、`[]` = 不共用、`null` → `VALIDATION_FAILED`。
   */
  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}

/** 新增批售客戶(需 `dealers.wholesale-customers.create`):店名必填。 */
@InputType()
export class CreateLotteryWholesaleCustomerInput extends LotteryWholesaleCustomerFieldsInput {}

/** 編輯批售客戶(需 `dealers.wholesale-customers.edit`):缺席 = 不動、`null` = 清空;店名、狀態送 `null` 視同缺席。 */
@InputType()
export class UpdateLotteryWholesaleCustomerInput extends LotteryWholesaleCustomerFieldsInput {
  @Field(() => ID)
  id!: string;
}

/** 刪除批售客戶(需 `dealers.wholesale-customers.edit`):被任何批售單(含草稿)引用的不能刪除,只能停用。 */
@InputType()
export class DeleteLotteryWholesaleCustomerInput {
  @Field(() => ID)
  id!: string;
}
