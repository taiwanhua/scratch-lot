import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 新增頁可以調的一本(出貨店裡還有未售、沒被鎖定的張)。 */
@ObjectType("LotteryTransferBook")
export class LotteryTransferBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  bookPrice!: number;

  /** 這本的成本率(批購金額率的預設值)。 */
  @Field(() => Int)
  rate!: number;

  /** 整本原封不動在出貨店(可以整本調);否則只能選張。 */
  @Field(() => Boolean)
  isWhole!: boolean;

  /** 出貨店裡可以調的張數(未售、沒被鎖定)。 */
  @Field(() => Int)
  availableCount!: number;

  /** 迄號(整本的張號區段顯示「001–101(100 張)」用;待標註的跳號在拆本前還在區段裡) */
  @Field(() => Int)
  lastTicketNo!: number;
}

/** 叫貨單(收貨分店、待購買)。 */
@ObjectType("LotteryTransferRequisition")
export class LotteryTransferRequisitionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => Int)
  books!: number;
}

/** 收貨店某個遊戲的預計要給本數與已給、在途(新增頁「超過預計要給本數只警告」;規格 7.6)。 */
@ObjectType("LotteryTransferAllocation")
export class LotteryTransferAllocationModel {
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

/** 新增頁的選項(規格 8.4):出貨店能調的本、收貨店待購買的叫貨單。 */
@ObjectType("LotteryTransferOptions")
export class LotteryTransferOptionsModel {
  @Field(() => [LotteryTransferBookModel])
  books!: LotteryTransferBookModel[];

  @Field(() => [LotteryTransferRequisitionModel])
  requisitions!: LotteryTransferRequisitionModel[];

  /** 收貨店的預計要給本數(出貨店能調的本的遊戲;沒給收貨分店 = 空)。 */
  @Field(() => [LotteryTransferAllocationModel])
  allocations!: LotteryTransferAllocationModel[];
}

/** 張數格子的一格(新增頁選張)。 */
@ObjectType("LotteryTransferTicketCell")
export class LotteryTransferTicketCellModel {
  @Field(() => String)
  ticketNo!: string;

  /** `available` 可選 / `sold` 已售 / `locked` 被鎖定 / `skipped` 跳號 / `elsewhere` 不在出貨店或不能動。 */
  @Field(() => String)
  state!: string;
}

/** 檢視頁的一列(出貨確認清單、點收區塊)。 */
@ObjectType("LotteryTransferRow")
export class LotteryTransferRowModel {
  @Field(() => String)
  rowId!: string;

  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  /** `whole` 整本 / `partial` 選張。 */
  @Field(() => String)
  mode!: string;

  /** 這列的張號(3 位;整本 = 這本跳號以外的張)。 */
  @Field(() => [String])
  ticketNos!: string[];

  @Field(() => Int)
  tickets!: number;

  @Field(() => Int)
  amount!: number;

  @Field(() => Int)
  rate!: number;

  @Field(() => Int)
  purchaseAmount!: number;

  /** 已出貨(在途或已點收)。 */
  @Field(() => Boolean)
  shipped!: boolean;

  /** 這一列全部到齊(已點收張數 = 張數)。 */
  @Field(() => Boolean)
  received!: boolean;

  /** 已點收幾張(整本的列一次整列;選張的列逐張點收,可能只到部分張)。 */
  @Field(() => Int)
  receivedTickets!: number;

  /** 最近一次點收的時間;還沒點收 = null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  receivedAt!: Date | null;

  /**
   * 這一列(這張單)最近一次「調出」的時間(第一關通過、或送出時跳過第一關的那一刻);還沒出貨 = null。
   * 退回後重送時,已在途的列不再調出、時間不變 —— 前端以它判斷「這次」才出貨的列(出貨單只印這些)。
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  shippedAt!: Date | null;

  /** 點收批次([完成這次點收] 時給;一列分好幾次點收時 = 最近一次);還沒完成這一次或舊資料 = null。 */
  @Field(() => ID, { nullable: true })
  batchId!: string | null;

  /** 點收紀錄實際搬進來的張號(3 位,由小到大;調貨點收單照它印號碼);還沒點收 = 空。 */
  @Field(() => [String])
  receivedTicketNos!: string[];
}

/** 一次點收裡的一列:這一次點收了哪幾張。 */
@ObjectType("LotteryTransferReceivingBatchRow")
export class LotteryTransferReceivingBatchRowModel {
  @Field(() => String)
  rowId!: string;

  /** 這一次點收的張號(3 位,由小到大)。 */
  @Field(() => [String])
  ticketNos!: string[];
}

/** 一次點收(按一次 [完成這次點收]):調貨點收單照它印、補印照它重排版。 */
@ObjectType("LotteryTransferReceivingBatch")
export class LotteryTransferReceivingBatchModel {
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

  /** 這一次每一列點收的張(選張的列逐張點收時,一列可能分好幾次)。 */
  @Field(() => [LotteryTransferReceivingBatchRowModel])
  rows!: LotteryTransferReceivingBatchRowModel[];
}

/** 調貨單檢視頁的出貨確認清單與點收區塊(規格 8.4)。 */
@ObjectType("LotteryTransferReceiving")
export class LotteryTransferReceivingModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  fromBranchName!: string;

  @Field(() => String)
  toBranchName!: string;

  /** 調貨金額(批購金額合計)。 */
  @Field(() => Int)
  transferAmount!: number;

  /** 操作者現在能不能點收:單據在審核中,而且點收關卡(第二關)的任務在他手上。 */
  @Field(() => Boolean)
  canReceive!: boolean;

  @Field(() => Int)
  receivedCount!: number;

  @Field(() => Int)
  totalCount!: number;

  @Field(() => [LotteryTransferRowModel])
  rows!: LotteryTransferRowModel[];

  /** 每一次點收(依完成時間由舊到新)。 */
  @Field(() => [LotteryTransferReceivingBatchModel])
  batches!: LotteryTransferReceivingBatchModel[];
}

/** [完成這次點收] 的結果。 */
@ObjectType("CompleteLotteryTransferReceivingPayload")
export class CompleteLotteryTransferReceivingPayload {
  /** 這一次的點收批次;這一次沒有可以收進批次的列(都已在別的批次)= null,不印 */
  @Field(() => LotteryTransferReceivingBatchModel, { nullable: true })
  batch!: LotteryTransferReceivingBatchModel | null;

  @Field(() => LotteryTransferReceivingModel)
  receiving!: LotteryTransferReceivingModel;
}

@InputType()
export class CompleteLotteryTransferReceivingInput {
  @Field(() => ID)
  submissionId!: string;

  /** 「這一次」點收的列(畫面記的:上次 [完成這次點收] 或打開頁面之後點收的)。 */
  @Field(() => [String])
  rowIds!: string[];
}

/** 點收的結果(刷一張 / 點選格子 / 其餘全部到齊)。 */
@ObjectType("ReceiveLotteryTransferBookPayload")
export class ReceiveLotteryTransferBookPayload {
  @Field(() => String)
  rowId!: string;

  /** 這一次點收的張號(整本的列 = 整列;選張的列 = 刷到 / 選到的張)。 */
  @Field(() => [String])
  ticketNos!: string[];

  @Field(() => LotteryTransferReceivingModel)
  receiving!: LotteryTransferReceivingModel;
}

/** 列表的本數 / 張數、點收進度與結算(規格 8.4 列表欄位)。 */
@ObjectType("LotteryTransferProgress")
export class LotteryTransferProgressModel {
  @Field(() => ID)
  transferId!: string;

  /** 整本幾本。 */
  @Field(() => Int)
  wholeBooks!: number;

  /** 選張共幾張。 */
  @Field(() => Int)
  partialTickets!: number;

  @Field(() => Int)
  receivedCount!: number;

  @Field(() => Int)
  totalCount!: number;

  /** 有列在途(已出貨、還沒點收)。 */
  @Field(() => Boolean)
  inTransit!: boolean;

  /** 結算:`to_pay` 待付 / `to_refund` 待退 / `to_receive` 待收;已結清或不參與收付 = null。 */
  @Field(() => String, { nullable: true })
  settlementKind!: string | null;

  @Field(() => Int)
  settlementAmount!: number;

  @Field(() => Boolean)
  inSettlement!: boolean;
}

@InputType()
export class ReceiveLotteryTransferBookInput {
  @Field(() => ID)
  submissionId!: string;

  /** 刷到的碼(背面編號 / 正面編號 / 正面條碼;刷這列的任何一張)。 */
  @Field(() => String)
  code!: string;

  /**
   * 選的遊戲(正面的碼對到單上好幾款遊戲同本號時,畫面請操作者選;背面編號不看)。
   * 缺席 / null = 沒選:對到好幾款遊戲 → `TRANSFER_SCAN_AMBIGUOUS_GAME`。
   */
  @Field(() => ID, { nullable: true })
  gameId?: string | null;
}

/** 選張的列在格子上點收(點選格子 [點收選取的 N 張]、[其餘全部到齊…])。 */
@InputType()
export class ReceiveLotteryTransferTicketsInput {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  rowId!: string;

  /** 要點收的張號(3 位;都要在這一列、還沒點收)。 */
  @Field(() => [String])
  ticketNos!: string[];
}
