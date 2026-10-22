import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 班次結帳歷史的一列(規格 11.3、14.9;Figma RE-05)。 */
@ObjectType("LotteryShiftCheckoutRow")
export class LotteryShiftCheckoutRowModel {
  @Field(() => ID)
  checkoutId!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 結帳時間(送出交班結帳) */
  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;

  /** 負責人(開班的人) */
  @Field(() => String)
  leader!: string;

  /** 協同(同一筆人力需求裡協同任務填的人;從排班取得) */
  @Field(() => [String])
  helpers!: string[];

  /** 任務快照的職責:`leader` 負責 / `helper` 協同;未對應排班或對不到 = null */
  @Field(() => String, { nullable: true })
  taskRole!: string | null;

  /** 任務快照的崗位名稱(欄位管理「崗位」;找不到選項顯示代碼) */
  @Field(() => String, { nullable: true })
  taskPosition!: string | null;

  /** 任務內容(欄位管理「執行任務」的名稱) */
  @Field(() => String, { nullable: true })
  taskName!: string | null;

  @Field(() => Float)
  expected!: number;

  @Field(() => Float)
  counted!: number;

  @Field(() => Float)
  difference!: number;

  /** 差額原因(名稱快照;有說明時接在後面) */
  @Field(() => String, { nullable: true })
  diffReason!: string | null;

  /** 事後更正淨額(那一班的全部事後更正) */
  @Field(() => Float)
  postClose!: number;

  /** 盤點:`skip` 跳過 / `reuse` 沿用 / `new` 現在盤點 */
  @Field(() => String)
  stocktakeMode!: string;

  /** 跳過盤點的原因 */
  @Field(() => String, { nullable: true })
  skipReason!: string | null;

  /** 盤點單沒盤的本數(0 = 盤完) */
  @Field(() => Int)
  uncountedBooks!: number;

  /** 審核:`pending` 待審核 / `confirmed` 已核准 / `returned` 已退回 */
  @Field(() => String)
  status!: string;
}

/** 班次結帳歷史報表(規格 11.3;分店最多 20 家)。 */
@ObjectType("LotteryShiftCheckoutsReport")
export class LotteryShiftCheckoutsReportModel {
  @Field(() => [LotteryShiftCheckoutRowModel])
  rows!: LotteryShiftCheckoutRowModel[];
}

/** 條件的收銀點下拉:選的分店的收銀點(含停用的,歷史紀錄要找得到)。 */
@ObjectType("LotteryReportCashPoint")
export class LotteryReportCashPointModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  name!: string;
}
