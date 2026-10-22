import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 張數 + 金額。 */
@ObjectType("LotteryReportQty")
export class LotteryReportQtyModel {
  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  amount!: number;
}

/** 手動標記售出:一種原因一列(欄位管理「手動標記原因」;名稱照目前的選項,停用的顯示代碼)。 */
@ObjectType("LotteryReportReasonQty")
export class LotteryReportReasonQtyModel {
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String)
  reason!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  amount!: number;
}

/** 銷售依遊戲展開的一列。 */
@ObjectType("LotteryOperationsGameSales")
export class LotteryOperationsGameSalesModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 售出(刷條碼 + 手動 + 盤點補登)張數 */
  @Field(() => Int)
  sold!: number;

  /** 撤銷張數 */
  @Field(() => Int)
  undone!: number;

  /** 淨銷售金額 */
  @Field(() => Float)
  netAmount!: number;

  /** 已售張數的單張成本合計(沒有 `reports.show-cost` = null) */
  @Field(() => Float, { nullable: true })
  cost!: number | null;
}

/** 區塊 1 銷售 + 區塊 2 毛利的成本(規格 11.2)。 */
@ObjectType("LotteryOperationsSales")
export class LotteryOperationsSalesModel {
  /** 刷條碼售出(含快速銷售) */
  @Field(() => LotteryReportQtyModel)
  scan!: LotteryReportQtyModel;

  /** 手動標記(依原因分列) */
  @Field(() => [LotteryReportReasonQtyModel])
  manual!: LotteryReportReasonQtyModel[];

  /** 盤點補登 */
  @Field(() => LotteryReportQtyModel)
  stocktake!: LotteryReportQtyModel;

  /** 撤銷(當下撤銷 + 撤銷售出申請完成) */
  @Field(() => LotteryReportQtyModel)
  undo!: LotteryReportQtyModel;

  /** 淨銷售 = 售出 − 撤銷 */
  @Field(() => LotteryReportQtyModel)
  net!: LotteryReportQtyModel;

  /** 區塊 2:已售張數的單張成本合計(售出 − 撤銷;沒有 `reports.show-cost` = null) */
  @Field(() => Float, { nullable: true })
  cost!: number | null;

  @Field(() => [LotteryOperationsGameSalesModel])
  games!: LotteryOperationsGameSalesModel[];
}

/** 區塊 3 兌獎:有效的(扣掉已撤銷)與已撤銷另列。 */
@ObjectType("LotteryOperationsRedemption")
export class LotteryOperationsRedemptionModel {
  @Field(() => LotteryReportQtyModel)
  valid!: LotteryReportQtyModel;

  @Field(() => LotteryReportQtyModel)
  inStore!: LotteryReportQtyModel;

  @Field(() => LotteryReportQtyModel)
  sent!: LotteryReportQtyModel;

  @Field(() => LotteryReportQtyModel)
  revoked!: LotteryReportQtyModel;
}

/** 區塊 4 庫存異動。成本欄沒有 `reports.show-cost` = null。 */
@ObjectType("LotteryOperationsInventory")
export class LotteryOperationsInventoryModel {
  @Field(() => Int)
  purchaseBooks!: number;

  @Field(() => Int)
  purchaseTickets!: number;

  @Field(() => Float, { nullable: true })
  purchaseCost!: number | null;

  @Field(() => Int)
  transferInTickets!: number;

  /** 調入的調貨金額 */
  @Field(() => Float)
  transferInAmount!: number;

  @Field(() => Int)
  transferOutTickets!: number;

  /** 調出的調貨金額 */
  @Field(() => Float)
  transferOutAmount!: number;

  /** 調貨損益 = 調出的調貨金額 − 原成本 */
  @Field(() => Float, { nullable: true })
  transferGain!: number | null;

  @Field(() => Int)
  scrapTickets!: number;

  @Field(() => Float, { nullable: true })
  scrapCost!: number | null;

  @Field(() => Int)
  lostTickets!: number;

  @Field(() => Float, { nullable: true })
  lostCost!: number | null;

  @Field(() => Int)
  recoveredTickets!: number;

  @Field(() => Float, { nullable: true })
  recoveredCost!: number | null;

  /** 跳號(張,不計成本) */
  @Field(() => Int)
  skippedTickets!: number;

  /** 期末庫存(期間結束那一刻在這家店、未售的張:庫存 + 檯面) */
  @Field(() => Int)
  endingTickets!: number;

  @Field(() => Float, { nullable: true })
  endingCost!: number | null;

  /** 期末待查(本) */
  @Field(() => Int)
  investigatingBooks!: number;
}

/** 事後更正的一個原因類別(`redemption` 兌獎 / `stocktake` 盤點補登 / `refund` 退貨退款 / `cashCorrection` 現金更正)。 */
@ObjectType("LotteryReportPostClose")
export class LotteryReportPostCloseModel {
  @Field(() => String)
  category!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  amount!: number;
}

/** 區塊 5 現金。 */
@ObjectType("LotteryOperationsCash")
export class LotteryOperationsCashModel {
  /** 期間內送出交班結帳的班數 */
  @Field(() => Int)
  shiftCount!: number;

  /** 各班結帳差額合計 */
  @Field(() => Float)
  shiftDifference!: number;

  /** 這些班的事後更正(依原因類別;指向已關帳月份、關帳後才記的不算,另歸前期更正) */
  @Field(() => [LotteryReportPostCloseModel])
  postClose!: LotteryReportPostCloseModel[];

  /** 退貨退款(不含事後更正) */
  @Field(() => Float)
  refund!: number;

  /** 調貨支出(現金) */
  @Field(() => Float)
  transferExpense!: number;

  /** 調貨收入(現金) */
  @Field(() => Float)
  transferIncome!: number;

  @Field(() => Float)
  deposit!: number;

  @Field(() => Float)
  bankDeposit!: number;

  /** 期間內送出的日結張數 */
  @Field(() => Int)
  dailyCloseCount!: number;

  /** 日結的小金庫差異合計 */
  @Field(() => Float)
  vaultDifference!: number;
}

/** 銀行交易依類型合計的一列。 */
@ObjectType("LotteryOperationsBankType")
export class LotteryOperationsBankTypeModel {
  @Field(() => String)
  type!: string;

  /** `in` 收 / `out` 支 */
  @Field(() => String)
  direction!: string;

  @Field(() => Float)
  amount!: number;
}

/** 區塊 6 銀行:這家店使用的一個帳戶。 */
@ObjectType("LotteryOperationsBankAccount")
export class LotteryOperationsBankAccountModel {
  @Field(() => ID)
  accountId!: string;

  @Field(() => String)
  label!: string;

  /** 共用(不只這家店用) */
  @Field(() => Boolean)
  shared!: boolean;

  /** 歸屬這家店的交易,依類型合計 */
  @Field(() => [LotteryOperationsBankTypeModel])
  types!: LotteryOperationsBankTypeModel[];

  /** 期末餘額(整個帳戶) */
  @Field(() => Float)
  endingBalance!: number;
}

/** 區塊 7 未結清(依單據的收付現況)。 */
@ObjectType("LotteryOperationsOutstanding")
export class LotteryOperationsOutstandingModel {
  @Field(() => Float)
  purchaseToPay!: number;

  @Field(() => Float)
  purchaseToRefund!: number;

  @Field(() => Float)
  transferToReceive!: number;

  @Field(() => Float)
  transferToPay!: number;
}

/** 跳過盤點:一種原因一列。 */
@ObjectType("LotteryOperationsSkipReason")
export class LotteryOperationsSkipReasonModel {
  @Field(() => String)
  reason!: string;

  @Field(() => Int)
  count!: number;
}

/** 區塊 8 註記。 */
@ObjectType("LotteryOperationsNotes")
export class LotteryOperationsNotesModel {
  @Field(() => [LotteryOperationsSkipReasonModel])
  skippedStocktakes!: LotteryOperationsSkipReasonModel[];

  /** 有沒盤完的本的盤點單張數 */
  @Field(() => Int)
  uncountedStocktakes!: number;

  /** 那些盤點單沒盤的本數合計(報表標示「N 本未盤」) */
  @Field(() => Int)
  uncountedBooks!: number;

  /** 沒有被日結涵蓋計算的班 */
  @Field(() => Int)
  uncoveredShifts!: number;

  /** 前期更正:期間內記的、指向已關帳月份的更正 */
  @Field(() => Int)
  priorPeriodCount!: number;

  @Field(() => Float)
  priorPeriodAmount!: number;

  /** 期間涵蓋、尚未關帳的月份(`YYYY-MM`) */
  @Field(() => [String])
  openMonths!: string[];
}

/** 一家店實際用的期間(對齊日結時逐店不同)。 */
@ObjectType("LotteryReportStorePeriod")
export class LotteryReportStorePeriodModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;

  /** `period` 照選的期間 / `dailyClose` 對齊日結 / `fullDay` 要對齊但當天沒有日結,改用整天 */
  @Field(() => String)
  alignment!: string;
}

/** 營運報表的一家店。 */
@ObjectType("LotteryOperationsStore")
export class LotteryOperationsStoreModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => LotteryReportStorePeriodModel)
  period!: LotteryReportStorePeriodModel;

  @Field(() => LotteryOperationsSalesModel)
  sales!: LotteryOperationsSalesModel;

  @Field(() => LotteryOperationsRedemptionModel)
  redemption!: LotteryOperationsRedemptionModel;

  @Field(() => LotteryOperationsInventoryModel)
  inventory!: LotteryOperationsInventoryModel;

  @Field(() => LotteryOperationsCashModel)
  cash!: LotteryOperationsCashModel;

  @Field(() => [LotteryOperationsBankAccountModel])
  bankAccounts!: LotteryOperationsBankAccountModel[];

  @Field(() => LotteryOperationsOutstandingModel)
  outstanding!: LotteryOperationsOutstandingModel;

  @Field(() => LotteryOperationsNotesModel)
  notes!: LotteryOperationsNotesModel;
}

/** 營運報表(規格 11.2;分店最多 50 家)。 */
@ObjectType("LotteryOperationsReport")
export class LotteryOperationsReportModel {
  /** 最後一個已關帳月份(`YYYY-MM`);沒關過 = null */
  @Field(() => String, { nullable: true })
  closedThrough!: string | null;

  /** 操作者有沒有 `reports.show-cost`(成本欄是 null 時區分「沒權限」與「沒有資料」) */
  @Field(() => Boolean)
  canShowCost!: boolean;

  @Field(() => [LotteryOperationsStoreModel])
  stores!: LotteryOperationsStoreModel[];
}

/** 條件畫面:各店實際期間 + 已關帳到哪(RE-01 對齊日結的逐店期間、RE-03 月份的已關帳 / 尚未關帳)。 */
@ObjectType("LotteryReportPeriods")
export class LotteryReportPeriodsModel {
  @Field(() => String, { nullable: true })
  closedThrough!: string | null;

  @Field(() => [LotteryReportStorePeriodModel])
  stores!: LotteryReportStorePeriodModel[];
}
