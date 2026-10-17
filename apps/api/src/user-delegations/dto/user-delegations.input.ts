import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/** 清單分頁預設值(GQL-03)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 我的代理清單。 */
@InputType()
export class MyDelegationsInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 可選的代理人;關鍵字比對姓名與帳號。 */
@InputType()
export class MyDelegateCandidatesInput {
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/**
 * 新增代理(只能設定自己的):起訖是時點(admin 依租戶時區選日期,起 = 當天 00:00、迄 = 結束日 24:00)。
 * 迄 <= 起、迄已過、代理人是自己 / 停用 / 不在本租戶、與自己既有代理期間重疊 → `VALIDATION_FAILED` + reason。
 */
@InputType()
export class CreateMyDelegationInput {
  @Field(() => ID)
  delegateUserId!: string;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  /** 缺席 / null / 空白 = 沒有備註 */
  @Field(() => String, { nullable: true })
  note?: string | null;
}

/**
 * 改迄日與備註(未結束的才能改;已派出的任務不變)。代理人與起日不改(要換就刪掉重設)。
 * `note` 缺席 = 不動;`null` / 空白 = 清掉。
 */
@InputType()
export class UpdateMyDelegationInput {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 刪除(未結束的才能刪;已派出的任務不變)。 */
@InputType()
export class DeleteMyDelegationInput {
  @Field(() => ID)
  id!: string;
}
