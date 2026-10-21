import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 一邊的一顆方向按鈕:先填的金額(≤ 0 = 停用)、操作者能不能按。 */
@ObjectType("LotterySettlementButton")
export class LotterySettlementButtonModel {
  /** `out` 支出(付款 / 退款)、`in` 收入(收到退款 / 收款)。 */
  @Field(() => String)
  button!: string;

  @Field(() => Int)
  defaultAmount!: number;

  /** 有這一邊的權限且先填的金額 > 0。 */
  @Field(() => Boolean)
  canUse!: boolean;
}

@ObjectType("LotterySettlementSide")
export class LotterySettlementSideModel {
  @Field(() => String)
  side!: string;

  /** 「哪一店」:總部、收貨店、出貨店。 */
  @Field(() => String)
  label!: string;

  /** `payer` 付款方 / `payee` 收款方。 */
  @Field(() => String)
  role!: string;

  /** 可用的付款方式:`bank` / `cash`。 */
  @Field(() => [String])
  methods!: string[];

  @Field(() => LotteryAccountsRefModel)
  branch!: LotteryAccountsRefModel;

  @Field(() => Int)
  totalOut!: number;

  @Field(() => Int)
  totalIn!: number;

  /** 付款方 = 已付淨額(支出 − 收入);收款方 = 已收淨額(收入 − 支出)。 */
  @Field(() => Int)
  net!: number;

  /** 操作者有這一邊的權限(按鈕、沖正)。 */
  @Field(() => Boolean)
  canSettle!: boolean;

  /** 用現金時可以選的抽屜:這一邊的分店開著班的收銀點(小金庫不在這份,一律可選)。 */
  @Field(() => [LotteryAccountsRefModel])
  cashDrawers!: LotteryAccountsRefModel[];

  @Field(() => [LotterySettlementButtonModel])
  buttons!: LotterySettlementButtonModel[];
}

/** 收付歷程的一筆(銀行交易或現金流水)。 */
@ObjectType("LotterySettlementRecord")
export class LotterySettlementRecordModel {
  @Field(() => ID)
  id!: string;

  /** `bank` / `cash`。 */
  @Field(() => String)
  method!: string;

  @Field(() => String)
  side!: string;

  /** 交易 / 流水類型(例 `purchase_expense`、`transfer_in`)。 */
  @Field(() => String)
  type!: string;

  /** 這一邊的方向:`out` 支出 / `in` 收入。 */
  @Field(() => String)
  direction!: string;

  @Field(() => Int)
  amount!: number;

  /** 銀行:帳戶名稱(戶名 + 末 5 碼);現金:null。 */
  @Field(() => String, { nullable: true })
  accountLabel!: string | null;

  /** 經手人 / 收款人。 */
  @Field(() => String, { nullable: true })
  handler!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  createdBy!: LotteryAccountsRefModel | null;

  @Field(() => ID, { nullable: true })
  reversalOf!: string | null;

  @Field(() => ID, { nullable: true })
  reversedById!: string | null;

  /** 有這一邊的權限、還沒被沖正、本身不是沖正。 */
  @Field(() => Boolean)
  canReverse!: boolean;
}

/** `SettlementPanel` 要的全部:金額列、各邊、收付歷程。 */
@ObjectType("LotterySettlement")
export class LotterySettlementModel {
  @Field(() => String)
  moduleKey!: string;

  @Field(() => String)
  label!: string;

  /** `purchase` / `transfer`。 */
  @Field(() => String)
  kind!: string;

  @Field(() => ID)
  refId!: string;

  @Field(() => String)
  docNo!: string;

  @Field(() => String)
  counterparty!: string;

  /** 應付(進貨單)或調貨金額(調貨單)。 */
  @Field(() => Int)
  payable!: number;

  /** 收貨店已付 − 出貨店已收(> 0 才顯示「N 待出貨店入帳」);只有兩邊的單據有值。 */
  @Field(() => Int)
  pendingPayee!: number;

  @Field(() => [LotterySettlementSideModel])
  sides!: LotterySettlementSideModel[];

  @Field(() => [LotterySettlementRecordModel])
  records!: LotterySettlementRecordModel[];
}

@ObjectType()
export class LotterySettlementPayload {
  @Field(() => LotterySettlementModel)
  item!: LotterySettlementModel;
}

/** 待結清款項的一列(一張單據的一邊)。 */
@ObjectType("LotteryOutstandingSettlement")
export class LotteryOutstandingSettlementModel {
  @Field(() => String)
  moduleKey!: string;

  /** 類型名稱(進貨單、調貨單)。 */
  @Field(() => String)
  label!: string;

  @Field(() => ID)
  refId!: string;

  @Field(() => String)
  docNo!: string;

  @Field(() => String)
  side!: string;

  @Field(() => String)
  sideLabel!: string;

  @Field(() => LotteryAccountsRefModel)
  branch!: LotteryAccountsRefModel;

  @Field(() => String)
  counterparty!: string;

  @Field(() => Int)
  payable!: number;

  /** 這一邊的淨額(付款方已付 / 收款方已收)。 */
  @Field(() => Int)
  net!: number;

  /** `to_pay` 待付 / `to_refund` 待退 / `to_receive` 待收。 */
  @Field(() => String)
  kind!: string;

  /** 差額(= 按鈕先填的金額)。 */
  @Field(() => Int)
  amount!: number;

  /** 要按的那一顆:`out` / `in`。 */
  @Field(() => String)
  button!: string;

  /** 送出至今的天數。 */
  @Field(() => Int)
  daysOutstanding!: number;

  /** 操作者有這一邊的權限(沿用單據的 settle / pay / receive)。 */
  @Field(() => Boolean)
  canSettle!: boolean;
}

@ObjectType()
export class LotteryOutstandingSettlementsPayload {
  @Field(() => [LotteryOutstandingSettlementModel])
  items!: LotteryOutstandingSettlementModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 收付寫入的結果:那一筆的 id 與單據的最新現況。 */
@ObjectType()
export class RecordLotterySettlementPayload {
  @Field(() => ID)
  recordId!: string;

  @Field(() => LotterySettlementModel)
  item!: LotterySettlementModel;
}

/** 付款視窗「帳戶」的選項(使用中、使用組織包含這一邊的分店;`name` = 戶名 + 帳號末 5 碼)。 */
@ObjectType()
export class LotterySettlementAccountsPayload {
  @Field(() => [LotteryAccountsRefModel])
  items!: LotteryAccountsRefModel[];

  @Field(() => Int)
  totalCount!: number;
}
