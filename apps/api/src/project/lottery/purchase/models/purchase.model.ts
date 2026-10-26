import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 選項(id + 顯示名)。 */
@ObjectType("LotteryPurchaseOption")
export class LotteryPurchaseOptionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  label!: string;
}

/** 甲類的受託人(新增頁:本人批購 = 否時選)。 */
@ObjectType("LotteryPurchaseTrustee")
export class LotteryPurchaseTrusteeModel {
  @Field(() => ID)
  dealerId!: string;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  label!: string;
}

/** 販售中的遊戲(新增頁刷條碼帶入:整本金額、張數、預設批購金額率)。 */
@ObjectType("LotteryPurchaseGame")
export class LotteryPurchaseGameModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  ticketsPerBook!: number;

  @Field(() => Int)
  bookPrice!: number;

  @Field(() => Int)
  defaultRate!: number;
}

/** 待購買的叫貨單(同一家分店)與它每個遊戲叫了幾本。 */
@ObjectType("LotteryPurchaseRequisitionLine")
export class LotteryPurchaseRequisitionLineModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => Int)
  books!: number;
}

@ObjectType("LotteryPurchaseRequisition")
export class LotteryPurchaseRequisitionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => [LotteryPurchaseRequisitionLineModel])
  lines!: LotteryPurchaseRequisitionLineModel[];
}

/** 進貨分店某個遊戲的預計要給本數與已給、在途(新增頁「超過預計要給本數只警告」;規格 7.6)。 */
@ObjectType("LotteryPurchaseAllocation")
export class LotteryPurchaseAllocationModel {
  @Field(() => ID)
  gameId!: string;

  /** 預計要給本數;沒設定 = null(不警告)。 */
  @Field(() => Int, { nullable: true })
  plannedBooks!: number | null;

  /** 已給(整本)。 */
  @Field(() => Int)
  givenBooks!: number;

  /** 在途本數(叫貨單待購買 + 進貨 / 調貨還沒點收)。 */
  @Field(() => Int)
  inTransitBooks!: number;
}

/** 新增頁的選項(規格 8.2 單頭):依進貨分店。 */
@ObjectType("LotteryPurchaseOptions")
export class LotteryPurchaseOptionsModel {
  /** 營業中的甲類。 */
  @Field(() => [LotteryPurchaseOptionModel])
  dealers!: LotteryPurchaseOptionModel[];

  /** 甲類啟用中的受託人。 */
  @Field(() => [LotteryPurchaseTrusteeModel])
  trustees!: LotteryPurchaseTrusteeModel[];

  /** 扣款帳戶:使用中、使用組織包含進貨分店。 */
  @Field(() => [LotteryPurchaseOptionModel])
  accounts!: LotteryPurchaseOptionModel[];

  /** 這家分店待購買的叫貨單。 */
  @Field(() => [LotteryPurchaseRequisitionModel])
  requisitions!: LotteryPurchaseRequisitionModel[];

  /** 販售中的遊戲。 */
  @Field(() => [LotteryPurchaseGameModel])
  games!: LotteryPurchaseGameModel[];

  /** 進貨分店每個販售中遊戲的預計要給本數 / 已給 / 在途。 */
  @Field(() => [LotteryPurchaseAllocationModel])
  allocations!: LotteryPurchaseAllocationModel[];
}

/** 點收區塊的一本(明細一列)。 */
@ObjectType("LotteryPurchaseReceivingRow")
export class LotteryPurchaseReceivingRowModel {
  @Field(() => String)
  rowId!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  lastTicketNo!: number;

  @Field(() => Int)
  tickets!: number;

  @Field(() => Int)
  bookPrice!: number;

  @Field(() => Int)
  rate!: number;

  @Field(() => Int)
  amount!: number;

  @Field(() => Boolean)
  received!: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  receivedAt!: Date | null;

  /** 點收批次([完成這次點收] 時給);還沒完成這一次或舊資料 = null。 */
  @Field(() => ID, { nullable: true })
  batchId!: string | null;
}

/** 一次點收(按一次 [完成這次點收]):進貨點收單照它印、補印照它重排版。 */
@ObjectType("LotteryPurchaseReceivingBatch")
export class LotteryPurchaseReceivingBatchModel {
  @Field(() => ID)
  batchId!: string;

  /** 第幾次點收(依完成時間,從 1 起)。 */
  @Field(() => Int)
  no!: number;

  @Field(() => GraphQLISODateTime)
  completedAt!: Date;

  /** 這一次點收的列。 */
  @Field(() => [String])
  rowIds!: string[];
}

/** 點收區塊的一組(同一個遊戲)。 */
@ObjectType("LotteryPurchaseReceivingGroup")
export class LotteryPurchaseReceivingGroupModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 從叫貨單帶入時叫了幾本;沒有叫貨單 / 叫貨單沒有這個遊戲 = null。 */
  @Field(() => Int, { nullable: true })
  requestedBooks!: number | null;

  /** 已點收幾本。 */
  @Field(() => Int)
  receivedBooks!: number;

  @Field(() => Int)
  subtotal!: number;

  @Field(() => [LotteryPurchaseReceivingRowModel])
  rows!: LotteryPurchaseReceivingRowModel[];
}

/** 進貨單檢視頁的點收區塊(規格 8.2、8.3)。 */
@ObjectType("LotteryPurchaseReceiving")
export class LotteryPurchaseReceivingModel {
  @Field(() => ID)
  submissionId!: string;

  /** 操作者現在能不能點收:單據在審核中,而且點收任務在他手上。 */
  @Field(() => Boolean)
  canReceive!: boolean;

  @Field(() => Int)
  receivedCount!: number;

  @Field(() => Int)
  totalCount!: number;

  @Field(() => [LotteryPurchaseReceivingGroupModel])
  groups!: LotteryPurchaseReceivingGroupModel[];

  /** 每一次點收(依完成時間由舊到新)。 */
  @Field(() => [LotteryPurchaseReceivingBatchModel])
  batches!: LotteryPurchaseReceivingBatchModel[];
}

/** 點收一本的結果。 */
@ObjectType("ReceiveLotteryPurchaseBookPayload")
export class ReceiveLotteryPurchaseBookPayload {
  /** 點收的那一列。 */
  @Field(() => String)
  rowId!: string;

  @Field(() => LotteryPurchaseReceivingModel)
  receiving!: LotteryPurchaseReceivingModel;
}

/** 列表的點收進度與結算(規格 8.2 列表欄位)。 */
@ObjectType("LotteryPurchaseProgress")
export class LotteryPurchaseProgressModel {
  @Field(() => ID)
  purchaseId!: string;

  @Field(() => Int)
  receivedCount!: number;

  @Field(() => Int)
  totalCount!: number;

  /** 結算:`to_pay` 待付 / `to_refund` 待退;已結清或不參與收付 = null。 */
  @Field(() => String, { nullable: true })
  settlementKind!: string | null;

  @Field(() => Int)
  settlementAmount!: number;

  /** 參與收付(送出之後、沒有駁回 / 作廢)。 */
  @Field(() => Boolean)
  inSettlement!: boolean;
}

/** 甲類詳情「批購紀錄」的一列(有效進貨單)。 */
@ObjectType("LotteryDealerPurchase")
export class LotteryDealerPurchaseModel {
  @Field(() => ID)
  purchaseId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 進貨分店名稱(單上的值)。 */
  @Field(() => String)
  branchName!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  purchaseDate!: Date | null;

  @Field(() => Boolean)
  selfPurchase!: boolean;

  /** 受託人名稱(本人批購 = 空)。 */
  @Field(() => String, { nullable: true })
  trusteeName!: string | null;

  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  purchaseTotal!: number;

  @Field(() => String)
  status!: string;
}

/** [完成這次點收] 的結果。 */
@ObjectType("CompleteLotteryPurchaseReceivingPayload")
export class CompleteLotteryPurchaseReceivingPayload {
  /** 這一次的點收批次;這一次沒有可以收進批次的列(都已在別的批次)= null,不印 */
  @Field(() => LotteryPurchaseReceivingBatchModel, { nullable: true })
  batch!: LotteryPurchaseReceivingBatchModel | null;

  @Field(() => LotteryPurchaseReceivingModel)
  receiving!: LotteryPurchaseReceivingModel;
}

@InputType()
export class CompleteLotteryPurchaseReceivingInput {
  @Field(() => ID)
  submissionId!: string;

  /** 「這一次」點收的列(畫面記的:上次 [完成這次點收] 或打開頁面之後點收的)。 */
  @Field(() => [String])
  rowIds!: string[];
}

@InputType()
export class ReceiveLotteryPurchaseBookInput {
  @Field(() => ID)
  submissionId!: string;

  /** 刷到的碼(背面編號 / 正面編號 / 正面條碼;刷這本的最後一張)。 */
  @Field(() => String)
  code!: string;

  /**
   * 選的遊戲(正面的碼對到單上好幾款遊戲同本號時,畫面請操作者選;背面編號不看)。
   * 缺席 / null = 沒選:對到好幾款遊戲 → `PURCHASE_SCAN_AMBIGUOUS_GAME`。
   */
  @Field(() => ID, { nullable: true })
  gameId?: string | null;
}
