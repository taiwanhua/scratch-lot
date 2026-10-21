import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

import { ShareOrgInput } from "../../../../sharing/share-org.model";

/** 帳戶清單(範圍 = 看得到的帳戶:可見範圍 + 使用組織包含自己的)。篩選缺席 / null = 不篩(GQL-06)。 */
@InputType()
export class LotteryBankAccountsInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 50 })
  pageSize?: number;

  /** `active` / `inactive`。 */
  @Field(() => String, { nullable: true })
  status?: string | null;
}

/**
 * 新增帳戶(`accounts.create-bank-account`)。`branchName` / `note` 缺席或 null = 不填;
 * `shareOrgs`(使用組織)缺席 = 不共用。新增一律是使用中。
 */
@InputType()
export class CreateLotteryBankAccountInput {
  @Field(() => String)
  bankCode!: string;

  @Field(() => String, { nullable: true })
  branchName?: string | null;

  @Field(() => String)
  accountNo!: string;

  @Field(() => String)
  accountName!: string;

  @Field(() => Int)
  openingBalance!: number;

  /** 時點(admin 以租戶時區那一天 00:00 送)。 */
  @Field(() => GraphQLISODateTime)
  openingDate!: Date;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}

/**
 * 編輯帳戶(`accounts.edit-bank-account`)。**缺席 = 不動**;`branchName` / `note` 送 null = 清空;
 * 其他欄位送 null 視同缺席。有交易之後改 `openingBalance` / `openingDate` →
 * `VALIDATION_FAILED`(`reason = BANK_ACCOUNT_HAS_TRANSACTIONS`)。
 */
@InputType()
export class UpdateLotteryBankAccountInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  bankCode?: string | null;

  @Field(() => String, { nullable: true })
  branchName?: string | null;

  @Field(() => String, { nullable: true })
  accountNo?: string | null;

  @Field(() => String, { nullable: true })
  accountName?: string | null;

  @Field(() => Int, { nullable: true })
  openingBalance?: number | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  openingDate?: Date | null;

  /** `active` / `inactive`。 */
  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /** 使用組織(整份替換;空清單 = 不共用)。 */
  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}

/** 交易清單:期間缺席 = 不限;類型缺席 = 全部。 */
@InputType()
export class LotteryBankTransactionsInput {
  @Field(() => ID)
  accountId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  /** 不含(`occurredAt < to`)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;

  @Field(() => String, { nullable: true })
  type?: string | null;
}

/**
 * 登記交易(`accounts.record-bank-transaction`)。`direction` 只有調整 / 其他要給(其他類型給了也照類型);
 * 批貨 / 調貨的 `branchOrgId` 必填;批貨收入 / 調貨收入的單據(`refType` + `refId`)必填、
 * 只收有待退或待收的單據;兌獎入帳的單據選填(不算進單據淨額)。
 */
@InputType()
export class RecordLotteryBankTransactionInput {
  @Field(() => ID)
  accountId!: string;

  @Field(() => String)
  type!: string;

  @Field(() => String, { nullable: true })
  direction?: string | null;

  @Field(() => Int)
  amount!: number;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  @Field(() => ID, { nullable: true })
  branchOrgId?: string | null;

  @Field(() => String, { nullable: true })
  summary?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => String, { nullable: true })
  refType?: string | null;

  @Field(() => ID, { nullable: true })
  refId?: string | null;
}

/** 沖正(`accounts.reverse-bank-transaction`):原因必填。 */
@InputType()
export class ReverseLotteryBankTransactionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  reason!: string;
}
