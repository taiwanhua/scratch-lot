import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";
import {
  LotteryCheckoutCashItemModel,
  LotteryCheckoutReusableStocktakeModel,
} from "../../checkout/models/checkout.model";

/** 這家店審核中 / 已退回待更正的日結(擋下新的日結)。 */
@ObjectType("LotteryDailyClosePending")
export class LotteryDailyClosePendingModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 結帳單狀態:`pending` 審核中 / `returned` 已退回 */
  @Field(() => String)
  status!: string;
}

/** 看板頂部(規格 6.1):上次日結、審核中的日結。 */
@ObjectType("LotteryDailyCloseStatus")
export class LotteryDailyCloseStatusModel {
  /** 上次日結送出的時間(涵蓋計算期間的終點);從來沒日結 = null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastClosedAt!: Date | null;

  /** 上次日結距今幾天(租戶時區的日曆日);沒有 = null */
  @Field(() => Int, { nullable: true })
  daysSince!: number | null;

  @Field(() => LotteryDailyClosePendingModel, { nullable: true })
  pending!: LotteryDailyClosePendingModel | null;
}

/** 還開著的班([日結] 停用時滑過顯示)。 */
@ObjectType("LotteryDailyCloseOpenShift")
export class LotteryDailyCloseOpenShiftModel {
  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  ownerName!: string;
}

/** 日結第 ① 步的一列:涵蓋計算的一班的交班結帳(規格 6.10;Figma ST-21)。 */
@ObjectType("LotteryDailyCloseShiftRow")
export class LotteryDailyCloseShiftRowModel {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 那張申請目前的流程實例(側邊審核用);沒有 = null */
  @Field(() => ID, { nullable: true })
  instanceId!: string | null;

  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  /** 交班人(申請人) */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  submittedBy!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;

  @Field(() => Int)
  expected!: number;

  @Field(() => Int)
  counted!: number;

  @Field(() => Int)
  difference!: number;

  /** `approved` 已核准 / `pending` 待審核 / `returned` 已退回待更正 */
  @Field(() => String)
  state!: string;

  /** 待審核:目前的審核者;已退回:要更正的人(申請人) */
  @Field(() => [String])
  waitingFor!: string[];

  /** 審核者是操作者自己(列上有 [審核]) */
  @Field(() => Boolean)
  isMine!: boolean;
}

/** 日結精靈的資料(規格 6.10;Figma ST-21–25b)。 */
@ObjectType("LotteryDailyCloseWizard")
export class LotteryDailyCloseWizardModel {
  @Field(() => LotteryAccountsRefModel)
  org!: LotteryAccountsRefModel;

  /** 涵蓋計算期間的起點(上一次日結送出);第一次日結 = null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  coveredFrom!: Date | null;

  /** 涵蓋計算期間的終點:退回後再送出 = 原本送出的時間;新的日結 = null(到現在) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  coveredTo!: Date | null;

  /** 涵蓋計算期間裡沒有日結的日子(`YYYY-MM-DD`,租戶時區) */
  @Field(() => [String])
  gapDates!: string[];

  /** 還開著的班(有的話不能日結) */
  @Field(() => [LotteryDailyCloseOpenShiftModel])
  openShifts!: LotteryDailyCloseOpenShiftModel[];

  /** 審核中 / 已退回的另一張日結(有的話不能日結) */
  @Field(() => LotteryDailyClosePendingModel, { nullable: true })
  pending!: LotteryDailyClosePendingModel | null;

  @Field(() => [LotteryDailyCloseShiftRowModel])
  shifts!: LotteryDailyCloseShiftRowModel[];

  /** 各班差額合計(第 ⑤ 步) */
  @Field(() => Int)
  differenceTotal!: number;

  /** 有 `store.checkout` */
  @Field(() => Boolean)
  canSubmit!: boolean;

  @Field(() => Boolean)
  canSkipStocktake!: boolean;

  /** 可以沿用的全店盤點(30 分鐘內);沒有 = null */
  @Field(() => LotteryCheckoutReusableStocktakeModel, { nullable: true })
  reusableStocktake!: LotteryCheckoutReusableStocktakeModel | null;

  /** 第 ③ 步:小金庫應有逐項(含期初)與合計 */
  @Field(() => [LotteryCheckoutCashItemModel])
  vaultItems!: LotteryCheckoutCashItemModel[];

  @Field(() => Int)
  vaultExpected!: number;

  /** 小金庫起算點(上次已確認日結的送出時間);沒有 = null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  vaultBaselineAt!: Date | null;

  /** 第 ④ 步:這家店可用的帳戶(使用中、使用組織包含這家店) */
  @Field(() => [LotteryAccountsRefModel])
  bankAccounts!: LotteryAccountsRefModel[];

  @Field(() => GraphQLISODateTime)
  serverNow!: Date;
}

/** 存銀行視窗(規格 6.11;Figma ST-26a / b)。 */
@ObjectType("LotteryBankDepositForm")
export class LotteryBankDepositFormModel {
  @Field(() => LotteryAccountsRefModel)
  org!: LotteryAccountsRefModel;

  @Field(() => Int)
  vaultExpected!: number;

  /** 審核中 / 已退回的日結要存入銀行的金額(已清點、等核准後存入;這次能存的上限 = 應有 − 它) */
  @Field(() => Int)
  reserved!: number;

  /** 這家店可用的帳戶;沒有 → ST-26b「本店沒有銀行帳戶」 */
  @Field(() => [LotteryAccountsRefModel])
  accounts!: LotteryAccountsRefModel[];
}

@ObjectType("LotteryBankDepositPayload")
export class LotteryBankDepositPayloadModel {
  /** 存入後的小金庫應有 */
  @Field(() => Int)
  vaultExpected!: number;

  @Field(() => ID)
  movementId!: string;

  @Field(() => ID)
  transactionId!: string;
}
