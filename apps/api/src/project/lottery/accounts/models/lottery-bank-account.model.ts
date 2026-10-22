import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { ShareOrgModel } from "../../../../sharing/share-org.model";

/** 名稱參照(分店、使用者)。 */
@ObjectType("LotteryAccountsRef")
export class LotteryAccountsRefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

@ObjectType("LotteryBankAccountAbilities")
export class LotteryBankAccountAbilitiesModel {
  /** `accounts.edit-bank-account` 且歸屬組織在可見範圍(共用進來的只能看)。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 同 `canEdit`,且沒有任何交易。 */
  @Field(() => Boolean)
  canDelete!: boolean;

  /** `accounts.record-bank-transaction` 且帳戶使用中。 */
  @Field(() => Boolean)
  canRecordTransaction!: boolean;

  /** `accounts.reverse-bank-transaction`。 */
  @Field(() => Boolean)
  canReverse!: boolean;
}

/**
 * 銀行帳戶(欄位語意正本 `docs/modules/project/accounts.md`「api 介面」)。
 * `balance` 不存,依交易即時算(期初 + 收 − 支);負數只警告。
 * `shareOrgs` = 使用組織;`usageOrgs` 是它的顯示名稱(含下層的組織名稱不展開)。
 */
@ObjectType("LotteryBankAccount")
export class LotteryBankAccountModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  bankCode!: string;

  @Field(() => String, { nullable: true })
  branchName!: string | null;

  @Field(() => String)
  accountNo!: string;

  @Field(() => String)
  accountName!: string;

  /** 戶名 + 帳號末 5 碼(選單、頁籤顯示)。 */
  @Field(() => String)
  label!: string;

  @Field(() => Int)
  openingBalance!: number;

  @Field(() => GraphQLISODateTime)
  openingDate!: Date;

  /** `active` 使用中 / `inactive` 停用。 */
  @Field(() => String)
  status!: string;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => Int)
  balance!: number;

  /** 有交易 → 期初餘額、期初日期鎖定,不能刪除。 */
  @Field(() => Boolean)
  hasTransactions!: boolean;

  @Field(() => [ShareOrgModel])
  shareOrgs!: ShareOrgModel[];

  @Field(() => [LotteryAccountsRefModel])
  usageOrgs!: LotteryAccountsRefModel[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => LotteryBankAccountAbilitiesModel)
  abilities!: LotteryBankAccountAbilitiesModel;
}

@ObjectType()
export class LotteryBankAccountPayload {
  @Field(() => LotteryBankAccountModel)
  item!: LotteryBankAccountModel;
}

@ObjectType()
export class LotteryBankAccountsPayload {
  @Field(() => [LotteryBankAccountModel])
  items!: LotteryBankAccountModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class DeleteLotteryBankAccountPayload {
  @Field(() => ID)
  id!: string;
}

@ObjectType("LotteryBankTransactionAbilities")
export class LotteryBankTransactionAbilitiesModel {
  /** `accounts.reverse-bank-transaction`、還沒被沖正、本身不是沖正。 */
  @Field(() => Boolean)
  canReverse!: boolean;
}

/** 銀行交易(只新增;`reversedById` 有值 = 已被沖正)。 */
@ObjectType("LotteryBankTransaction")
export class LotteryBankTransactionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  accountId!: string;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  @Field(() => String)
  type!: string;

  /** `in` 收 / `out` 支。 */
  @Field(() => String)
  direction!: string;

  @Field(() => Int)
  amount!: number;

  /** 這一筆之後的餘額(依時間累加)。 */
  @Field(() => Int)
  balanceAfter!: number;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  branch!: LotteryAccountsRefModel | null;

  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => ID, { nullable: true })
  refId!: string | null;

  @Field(() => String, { nullable: true })
  settlementSide!: string | null;

  @Field(() => String, { nullable: true })
  summary!: string | null;

  @Field(() => String, { nullable: true })
  handler!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => ID, { nullable: true })
  reversalOf!: string | null;

  @Field(() => ID, { nullable: true })
  reversedById!: string | null;

  /** 沖正的那一筆:原交易的發生時間(畫面標「原交易 9/28」;規格 10.4「更正」);不是沖正 = null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  reversalOfAt!: Date | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  createdBy!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => LotteryBankTransactionAbilitiesModel)
  abilities!: LotteryBankTransactionAbilitiesModel;
}

@ObjectType()
export class LotteryBankTransactionPayload {
  @Field(() => LotteryBankTransactionModel)
  item!: LotteryBankTransactionModel;
}

/** 交易清單:期間內的收 / 支合計一起回(帳戶詳情的兩張卡)。 */
@ObjectType()
export class LotteryBankTransactionsPayload {
  @Field(() => [LotteryBankTransactionModel])
  items!: LotteryBankTransactionModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  totalIn!: number;

  @Field(() => Int)
  totalOut!: number;
}
