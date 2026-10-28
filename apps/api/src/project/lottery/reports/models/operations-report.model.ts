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

/** 區塊 3 兌獎:期間內登記的,狀態看期末那一刻(有效 = 期末時還沒撤銷;其中店內持有 / 已送兌;已撤銷另列)。 */
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

/**
 * 區塊 4 庫存異動(期初 + 進貨 + 調入 − 調出 − 淨銷售 − 報廢 − 新增待查 + 待查轉回 + 遺失尋回 = 期末;
 * 核對 = 左邊 − 期末,應為 0)。待標註的跳號(拆本前)不算張數與成本。成本欄、調入 / 調出 / 在途的調貨金額
 * 沒有 `reports.show-cost` = null。
 */
@ObjectType("LotteryOperationsInventory")
export class LotteryOperationsInventoryModel {
  /** 期初庫存(期間起點那一刻:這家店、未售、在庫存或檯面) */
  @Field(() => Int)
  openingTickets!: number;

  @Field(() => Float, { nullable: true })
  openingCost!: number | null;

  /** 進貨本數(進貨 − 作廢) */
  @Field(() => Int)
  purchaseBooks!: number;

  /** 其中作廢的本數(進貨單作廢在作廢那天扣回) */
  @Field(() => Int)
  purchaseVoidBooks!: number;

  /** 進貨張數(標準張數;作廢扣回) */
  @Field(() => Int)
  purchaseTickets!: number;

  /** 進貨成本(單張成本合計) */
  @Field(() => Float, { nullable: true })
  purchaseCost!: number | null;

  /** 調入(依點收時間;作廢反向) */
  @Field(() => Int)
  transferInTickets!: number;

  /** 調入的成本 = 調貨金額 */
  @Field(() => Float, { nullable: true })
  transferInAmount!: number | null;

  /** 調出(依出貨時間;退回 / 駁回 / 作廢回到出貨店的反向) */
  @Field(() => Int)
  transferOutTickets!: number;

  /** 調出的原成本(調出前的單張成本合計) */
  @Field(() => Float, { nullable: true })
  transferOutCost!: number | null;

  /** 調出的調貨金額 */
  @Field(() => Float, { nullable: true })
  transferOutAmount!: number | null;

  /** 調貨損益 = 調出的調貨金額 − 原成本(跟著出貨時間) */
  @Field(() => Float, { nullable: true })
  transferGain!: number | null;

  /** 淨銷售張數(同區塊 1);成本 = 已售成本 */
  @Field(() => Int)
  salesTickets!: number;

  @Field(() => Float, { nullable: true })
  salesCost!: number | null;

  @Field(() => Int)
  scrapTickets!: number;

  @Field(() => Float, { nullable: true })
  scrapCost!: number | null;

  /** 新增待查(期間內從這家店的庫存變成待查) */
  @Field(() => Int)
  newInvestigatingTickets!: number;

  @Field(() => Float, { nullable: true })
  newInvestigatingCost!: number | null;

  /** 待查轉回(待查 → 回到這家店的庫存) */
  @Field(() => Int)
  investigateRecoveredTickets!: number;

  @Field(() => Float, { nullable: true })
  investigateRecoveredCost!: number | null;

  /** 遺失尋回(已確認遺失 → 回到這家店的庫存) */
  @Field(() => Int)
  lostRecoveredTickets!: number;

  @Field(() => Float, { nullable: true })
  lostRecoveredCost!: number | null;

  /**
   * 待標註調整(規格 11.2、第 20 章方案 A):這家店庫存要扣的待標註變了、但不是自己進出列造成的(待標註改扣在
   * 別家店 / 待查那一組),加上這家店標跳號 / 取消跳號的張(`report-pending-adjustment.ts`)
   */
  @Field(() => Int)
  pendingAdjustTickets!: number;

  @Field(() => Float, { nullable: true })
  pendingAdjustCost!: number | null;

  /** 期末庫存(期間終點那一刻) */
  @Field(() => Int)
  endingTickets!: number;

  @Field(() => Float, { nullable: true })
  endingCost!: number | null;

  /** 核對 = 期初加減各列 − 期末(0 = 對得上) */
  @Field(() => Int)
  checkTickets!: number;

  @Field(() => Float, { nullable: true })
  checkCost!: number | null;

  /** 期末在途(已出貨、期末前還沒點收;不算任何一家店的庫存,列在出貨店) */
  @Field(() => Int)
  inTransitTickets!: number;

  /** 期末在途的調貨金額 */
  @Field(() => Float, { nullable: true })
  inTransitAmount!: number | null;

  /** 期末待查(張、成本、本數) */
  @Field(() => Int)
  investigatingTickets!: number;

  @Field(() => Float, { nullable: true })
  investigatingCost!: number | null;

  @Field(() => Int)
  investigatingBooks!: number;

  /** 期末待查的本(合計工作表依本去重複) */
  @Field(() => [ID])
  investigatingBookIds!: string[];

  /** 確認遺失(期間內待查 → 遺失;新增待查時已扣過庫存,不在加減裡) */
  @Field(() => Int)
  lostTickets!: number;

  @Field(() => Float, { nullable: true })
  lostCost!: number | null;

  /** 跳號(拆本標註 − 取消;實際不存在的張號,不在加減裡、不計成本) */
  @Field(() => Int)
  skippedTickets!: number;
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

/** 5b 現金移動的一類(抽屜、小金庫各自的增減:+ 流入、− 流出;沖正那一筆兩端對調,自然是反向)。 */
@ObjectType("LotteryOperationsCashMovement")
export class LotteryOperationsCashMovementModel {
  /** `deposit` 投庫 / `withdraw` 出庫 / `bank_deposit` 存銀行 / `refund` 退貨退款 / `transfer_out` 調貨支出 / `transfer_in` 調貨收入 / `correction` 現金更正 */
  @Field(() => String)
  type!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  drawer!: number;

  @Field(() => Float)
  vault!: number;
}

/** 區塊 5 現金:5a 差額與更正(+ 錢比帳多、− 錢比帳少)、5b 現金移動。 */
@ObjectType("LotteryOperationsCash")
export class LotteryOperationsCashModel {
  /** 期間內送出、期末那一刻有效(待審核或已核准)的交班結帳班數 */
  @Field(() => Int)
  shiftCount!: number;

  /** 其中期末時待審核的班數 */
  @Field(() => Int)
  pendingShiftCount!: number;

  /** 各班結帳差額(送出當下的差額) */
  @Field(() => Float)
  shiftDifference!: number;

  /** 期間內記的事後更正(依原因類別;對那一班抽屜應有的影響) */
  @Field(() => [LotteryReportPostCloseModel])
  postClose!: LotteryReportPostCloseModel[];

  /** 期間內送出、期末時有效的日結張數 */
  @Field(() => Int)
  dailyCloseCount!: number;

  /** 日結的小金庫差額 */
  @Field(() => Float)
  vaultDifference!: number;

  /** 5b 現金移動(固定順序;不含事後更正那幾筆) */
  @Field(() => [LotteryOperationsCashMovementModel])
  movements!: LotteryOperationsCashMovementModel[];
}

/** 銀行交易依類型合計的一列(同一類型合一列;沖正算在同一列,說明含沖正 N 筆)。 */
@ObjectType("LotteryOperationsBankType")
export class LotteryOperationsBankTypeModel {
  @Field(() => String)
  type!: string;

  /** 收的合計 */
  @Field(() => Float)
  inAmount!: number;

  /** 支的合計 */
  @Field(() => Float)
  outAmount!: number;

  /** 其中沖正的筆數 */
  @Field(() => Int)
  reversalCount!: number;
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

/** 區塊 7 未結清的一種(期末那一刻的餘額)。 */
@ObjectType("LotteryOperationsOutstandingItem")
export class LotteryOperationsOutstandingItemModel {
  /**
   * `purchaseToPay` 待付進貨款 / `purchaseToRefund` 待退進貨款 / `transferToReceive` 待收調貨款 /
   * `transferToPay` 待付調貨款 / `transferPayerRefund` 調貨待退(收貨店多付)/ `transferPayeeRefund` 調貨該退(出貨店多收)
   */
  @Field(() => String)
  kind!: string;

  /** 單數 */
  @Field(() => Int)
  count!: number;

  @Field(() => Float)
  amount!: number;

  /** 單號(最多 5 張;其他的看 `count`) */
  @Field(() => [String])
  serialNos!: string[];
}

/** 區塊 7 未結清(依單據的收付現況;固定 6 種、固定順序)。 */
@ObjectType("LotteryOperationsOutstanding")
export class LotteryOperationsOutstandingModel {
  @Field(() => [LotteryOperationsOutstandingItemModel])
  items!: LotteryOperationsOutstandingItemModel[];
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

  /** 有沒盤完的本的盤點次數(盤點單數) */
  @Field(() => Int)
  uncountedStocktakes!: number;

  /** 那些盤點單沒盤的本數合計(報表標示「N 本未盤」) */
  @Field(() => Int)
  uncountedBooks!: number;

  /** 期間內送出交班結帳、到期末那一刻還沒被日結涵蓋計算的班 */
  @Field(() => Int)
  uncoveredShifts!: number;

  /** 那些班的名稱(最多 5 個) */
  @Field(() => [String])
  uncoveredShiftLabels!: string[];

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
