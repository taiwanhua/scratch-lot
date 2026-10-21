import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

import {
  LotteryContactRoleEnum,
  LotteryContactStatusEnum,
} from "../models/lottery-dealer.model";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./lottery-dealer.input";

/** 關係人清單:篩選身分、狀態、關鍵字(姓名、手機、身分證字號)。 */
@InputType()
export class LotteryDealerContactsInput {
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => LotteryContactRoleEnum, { nullable: true })
  role?: LotteryContactRoleEnum | null;

  @Field(() => LotteryContactStatusEnum, { nullable: true })
  status?: LotteryContactStatusEnum | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

@InputType({ isAbstract: true })
abstract class LotteryDealerContactFieldsInput {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => [LotteryContactRoleEnum], { nullable: true })
  roles?: LotteryContactRoleEnum[] | null;

  @Field(() => String, { nullable: true })
  nationalId?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  birthday?: Date | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  mobile?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  mailingAddress?: string | null;

  @Field(() => String, { nullable: true })
  residentialAddress?: string | null;

  @Field(() => Boolean, { nullable: true })
  residentialSameAsMailing?: boolean | null;

  @Field(() => LotteryContactStatusEnum, { nullable: true })
  status?: LotteryContactStatusEnum | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 新增關係人(需 `dealers.contacts.create`):姓名、身分(至少一個)、身分證字號必填。 */
@InputType()
export class CreateLotteryDealerContactInput extends LotteryDealerContactFieldsInput {}

/**
 * 編輯關係人(需 `dealers.contacts.edit`):缺席 = 不動、`null` = 清空;必填欄位送 `null` 視同缺席。
 * 取消的身分還有關聯 → `CONFLICT`(列出關聯);重送 `releaseRelationships: true` 一併解除。
 */
@InputType()
export class UpdateLotteryDealerContactInput extends LotteryDealerContactFieldsInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Boolean, { nullable: true })
  releaseRelationships?: boolean | null;
}
