import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";
import { LotteryRedemptionModel } from "../../redemption/models/redemption.model";

/** 應有現金一項裡的一筆紀錄(可點回單據)。 */
@ObjectType("LotteryCheckoutCashEntry")
export class LotteryCheckoutCashEntryModel {
  /** `redemption` 兌獎紀錄 / `movement` 現金流水 / `submission` 單據 */
  @Field(() => String)
  refType!: string;

  @Field(() => ID)
  refId!: string;

  /** 顯示文字(張編號、單號…;沒有 = 空字串) */
  @Field(() => String)
  label!: string;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  /** 帶正負號 */
  @Field(() => Int)
  amount!: number;
}

/** 應有現金的一項(規格 6.9 公式的一項;金額帶正負號)。 */
@ObjectType("LotteryCheckoutCashItem")
export class LotteryCheckoutCashItemModel {
  @Field(() => String)
  kind!: string;

  /** 筆數 / 張數 */
  @Field(() => Int)
  count!: number;

  @Field(() => Int)
  amount!: number;

  @Field(() => [LotteryCheckoutCashEntryModel])
  entries!: LotteryCheckoutCashEntryModel[];
}

/** 審核中、會影響這一班現金的單據(規格 6.9「⚠ 審核中」)。 */
@ObjectType("LotteryCheckoutPendingImpact")
export class LotteryCheckoutPendingImpactModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  formKey!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => Int)
  amount!: number;
}

@ObjectType("LotteryCheckoutDenomination")
export class LotteryCheckoutDenominationModel {
  @Field(() => Int)
  value!: number;

  @Field(() => Int)
  count!: number;
}

/** 可以沿用的盤點(30 分鐘內、這個收銀點或全店、沒被駁回)。 */
@ObjectType("LotteryCheckoutReusableStocktake")
export class LotteryCheckoutReusableStocktakeModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  /** 只盤一個收銀點時的名稱;全店 = null */
  @Field(() => String, { nullable: true })
  scopeName!: string | null;

  /** 差異張數(有處理的) */
  @Field(() => Int)
  diffCount!: number;
}

/** 交班精靈要的那一班(頁首「交班結帳 · 店內櫃台 王小明 · 08:02 開班」)。 */
@ObjectType("LotteryCheckoutShift")
export class LotteryCheckoutShiftModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => LotteryAccountsRefModel)
  openedBy!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 已送出交班結帳(退回後修改時是已結束的班)。 */
  @Field(() => Boolean)
  closed!: boolean;
}

/** 交班精靈的資料(規格 6.9;Figma ST-17a/b、ST-18、ST-19a/b)。 */
@ObjectType("LotteryCheckoutWizard")
export class LotteryCheckoutWizardModel {
  @Field(() => LotteryCheckoutShiftModel)
  shift!: LotteryCheckoutShiftModel;

  /** 操作者能送出(負責人或店長 + `store.checkout`)。 */
  @Field(() => Boolean)
  canSubmit!: boolean;

  /** 有 `store.skip-stocktake`(第 ① 步才有「跳過盤點」)。 */
  @Field(() => Boolean)
  canSkipStocktake!: boolean;

  /** 可以沿用的盤點;沒有 = null */
  @Field(() => LotteryCheckoutReusableStocktakeModel, { nullable: true })
  reusableStocktake!: LotteryCheckoutReusableStocktakeModel | null;

  /** 第 ② 步:這一班的兌獎(有效的,登記時間舊到新)。 */
  @Field(() => [LotteryRedemptionModel])
  redemptions!: LotteryRedemptionModel[];

  @Field(() => Int)
  redemptionTotal!: number;

  /** 第 ③ 步:應有現金逐項(含期初)。 */
  @Field(() => [LotteryCheckoutCashItemModel])
  expectedItems!: LotteryCheckoutCashItemModel[];

  @Field(() => Int)
  expected!: number;

  @Field(() => [LotteryCheckoutPendingImpactModel])
  pendingImpacts!: LotteryCheckoutPendingImpactModel[];

  /** 第 ④ 步:可以選的接班人(這家店啟用中的成員,不含自己;名稱排序)。 */
  @Field(() => [LotteryAccountsRefModel])
  successorOptions!: LotteryAccountsRefModel[];

  @Field(() => GraphQLISODateTime)
  serverNow!: Date;
}

/** 班次結帳歷史紀錄的一列(ST-27)。 */
@ObjectType("LotteryCheckoutListItem")
export class LotteryCheckoutListItemModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => String)
  type!: string;

  /** 結帳單狀態(待核准 / 已確認 / 已退回)。 */
  @Field(() => String)
  status!: string;

  /** 申請的狀態(表單引擎:reviewing / returned / completed…);列表的「狀態」欄顯示它。 */
  @Field(() => String)
  submissionStatus!: string;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  cashPoint!: LotteryAccountsRefModel | null;

  /** 交班人(申請人)。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  submittedBy!: LotteryAccountsRefModel | null;

  @Field(() => Int)
  expected!: number;

  @Field(() => Int)
  counted!: number;

  @Field(() => Int)
  difference!: number;

  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;
}

@ObjectType()
export class LotteryCheckoutsPayload {
  @Field(() => [LotteryCheckoutListItemModel])
  items!: LotteryCheckoutListItemModel[];

  @Field(() => Int)
  total!: number;
}

/** 日結涵蓋計算的一班(檢視頁「涵蓋計算的班」)。 */
@ObjectType("LotteryCheckoutCoveredShift")
export class LotteryCheckoutCoveredShiftModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => String)
  cashPointName!: string;

  /** 這一班交班結帳的差額(實點 − 應有;日結單依收銀點彙總) */
  @Field(() => Int)
  difference!: number;
}

/**
 * 結帳確認申請檢視頁(交班 ST-28a / 日結 ST-28b):結帳單明細。日結時應有 / 實點 / 差額 / 面額 / 應有各項是**小金庫**,
 * 另有涵蓋計算期間、涵蓋的班與存入銀行。
 */
@ObjectType("LotteryCheckoutDetail")
export class LotteryCheckoutDetailModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  type!: string;

  @Field(() => String)
  status!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  cashPoint!: LotteryAccountsRefModel | null;

  @Field(() => ID, { nullable: true })
  shiftId!: string | null;

  /** 交班:收銀點的印表機(結帳單列印的預設;null = 分店預設) */
  @Field(() => ID, { nullable: true })
  cashPointPrinterId!: string | null;

  /** 交班:這一班的開班 / 結束時間(結帳單的「班次」);日結 = null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  shiftOpenedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  shiftClosedAt!: Date | null;

  /** 盤點方式:reuse / new / skip */
  @Field(() => String)
  stocktakeMode!: string;

  /** 盤點單(沿用或自己建立的):那張申請的提交 id、單號、開始盤的時間、範圍;跳過 = null */
  @Field(() => LotteryCheckoutReusableStocktakeModel, { nullable: true })
  stocktake!: LotteryCheckoutReusableStocktakeModel | null;

  @Field(() => String, { nullable: true })
  skipReason!: string | null;

  @Field(() => String, { nullable: true })
  skipReasonNote!: string | null;

  @Field(() => [LotteryCheckoutCashItemModel])
  expectedItems!: LotteryCheckoutCashItemModel[];

  @Field(() => Int)
  expected!: number;

  @Field(() => [LotteryCheckoutDenominationModel])
  denominations!: LotteryCheckoutDenominationModel[];

  @Field(() => Int)
  counted!: number;

  @Field(() => Int)
  difference!: number;

  @Field(() => String, { nullable: true })
  diffReason!: string | null;

  @Field(() => String, { nullable: true })
  diffReasonNote!: string | null;

  @Field(() => [LotteryCheckoutPendingImpactModel])
  pendingImpacts!: LotteryCheckoutPendingImpactModel[];

  @Field(() => Int)
  leftForNext!: number;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  successor!: LotteryAccountsRefModel | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  submittedBy!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  confirmedAt!: Date | null;

  /** 日結:涵蓋計算期間(第一次日結的起點 = null) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  coveredFrom!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  coveredTo!: Date | null;

  /** 日結:涵蓋計算的班(交班結帳的單號、收銀點) */
  @Field(() => [LotteryCheckoutCoveredShiftModel])
  coveredShifts!: LotteryCheckoutCoveredShiftModel[];

  /** 日結:存入銀行的金額(0 = 不存)與帳戶 */
  @Field(() => Int)
  bankDepositAmount!: number;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  bankAccount!: LotteryAccountsRefModel | null;

  /** 結帳內容(交班 `serializeCheckoutDraft` / 日結 `serializeDailyCloseDraft`;退回後打開精靈帶入)。 */
  @Field(() => String)
  draft!: string;
}
