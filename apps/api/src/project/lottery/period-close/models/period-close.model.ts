import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 月份列表的一列(Figma AC-06 93:1417)。 */
@ObjectType("LotteryPeriodRow")
export class LotteryPeriodRowModel {
  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** `current` 進行中 / `open` 未關帳 / `closed` 已關帳 */
  @Field(() => String)
  status!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  closedAt!: Date | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  closedBy!: LotteryAccountsRefModel | null;

  /** 這一列有 [關帳]:最早的未關帳、已結束的月份 */
  @Field(() => Boolean)
  canClose!: boolean;
}

@ObjectType("LotteryPeriodCloses")
export class LotteryPeriodClosesModel {
  /** 新的在前 */
  @Field(() => [LotteryPeriodRowModel])
  items!: LotteryPeriodRowModel[];

  /** 下一個要關的月份(依序);沒有可以關的 = null */
  @Field(() => String, { nullable: true })
  closableMonth!: string | null;
}

@ObjectType("LotteryPeriodBankAccountSnapshot")
export class LotteryPeriodBankAccountSnapshotModel {
  @Field(() => ID)
  accountId!: string;

  @Field(() => String)
  label!: string;

  /** 月底餘額 */
  @Field(() => Int)
  balance!: number;
}

@ObjectType("LotteryPeriodDrawerSnapshot")
export class LotteryPeriodDrawerSnapshotModel {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  name!: string;

  /** 月底抽屜的錢;月底有跨月的班 = null */
  @Field(() => Int, { nullable: true })
  amount!: number | null;

  @Field(() => String, { nullable: true })
  spanningShiftLabel!: string | null;
}

@ObjectType("LotteryPeriodShiftSnapshot")
export class LotteryPeriodShiftSnapshotModel {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => String)
  label!: string;
}

@ObjectType("LotteryPeriodStoreSnapshot")
export class LotteryPeriodStoreSnapshotModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  name!: string;

  /** 月底小金庫應有 */
  @Field(() => Int)
  vault!: number;

  /** 抽屜合計(有跨月的班時只算其他收銀點) */
  @Field(() => Int)
  drawerTotal!: number;

  @Field(() => [LotteryPeriodDrawerSnapshotModel])
  drawers!: LotteryPeriodDrawerSnapshotModel[];

  /** 那個月沒有被日結涵蓋計算的班 */
  @Field(() => [LotteryPeriodShiftSnapshotModel])
  uncoveredShifts!: LotteryPeriodShiftSnapshotModel[];
}

@ObjectType("LotteryPeriodSnapshot")
export class LotteryPeriodSnapshotModel {
  @Field(() => [LotteryPeriodBankAccountSnapshotModel])
  bankAccounts!: LotteryPeriodBankAccountSnapshotModel[];

  @Field(() => [LotteryPeriodStoreSnapshotModel])
  stores!: LotteryPeriodStoreSnapshotModel[];
}

/** 檢查清單:那個月還開著(沒結帳)的班。 */
@ObjectType("LotteryPeriodOpenShift")
export class LotteryPeriodOpenShiftModel {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => String)
  label!: string;
}

/** 檢查清單:擋下關帳的單據(審核中 / 已退回待更正,時間落在那個月)。 */
@ObjectType("LotteryPeriodPendingDocument")
export class LotteryPeriodPendingDocumentModel {
  /** `sale_reversal` 撤銷售出申請 / `cash_correction` 現金更正單 / `shift_checkout` 結帳確認申請(交班)/ `daily_close` 結帳確認申請(日結) */
  @Field(() => String)
  kind!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => String)
  orgName!: string;

  /** 判斷屬於哪個月的那一班(退款班次、位置、交班的班);小金庫 / 日結 = null */
  @Field(() => String, { nullable: true })
  shiftLabel!: string | null;

  /** 判斷用的時間(開班時間、送出時間、涵蓋計算期間的終點) */
  @Field(() => GraphQLISODateTime)
  at!: Date;
}

/** 關帳彈窗(Figma AC-07 93:1664):檢查清單 + 快照預覽。 */
@ObjectType("LotteryPeriodCloseCheck")
export class LotteryPeriodCloseCheckModel {
  @Field(() => String)
  month!: string;

  /** 那個月有沒結帳的班 → 擋 */
  @Field(() => [LotteryPeriodOpenShiftModel])
  openShifts!: LotteryPeriodOpenShiftModel[];

  /** 那個月有審核中的單據 → 擋 */
  @Field(() => [LotteryPeriodPendingDocumentModel])
  pendingDocuments!: LotteryPeriodPendingDocumentModel[];

  /** 快照預覽(含沒被日結涵蓋計算的班:只警告) */
  @Field(() => LotteryPeriodSnapshotModel)
  snapshot!: LotteryPeriodSnapshotModel;

  /** 沒有擋下的項目、而且是下一個要關的月份 */
  @Field(() => Boolean)
  canClose!: boolean;
}

/** 已關帳的月份([快照])。 */
@ObjectType("LotteryPeriodClose")
export class LotteryPeriodCloseModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  month!: string;

  @Field(() => GraphQLISODateTime)
  closedAt!: Date;

  @Field(() => LotteryAccountsRefModel)
  closedBy!: LotteryAccountsRefModel;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => LotteryPeriodSnapshotModel)
  snapshot!: LotteryPeriodSnapshotModel;
}
