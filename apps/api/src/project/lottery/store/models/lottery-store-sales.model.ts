import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 刷到的一張(規格 6.3「刷到時」;本號對到兩款以上遊戲時每款一筆 → 選遊戲)。 */
@ObjectType("LotteryStoreScanItem")
export class LotteryStoreScanItemModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 本號 7 位。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  ticketNo!: string;

  /** 張的狀態(`unsold` / `sold` / …)。 */
  @Field(() => String)
  status!: string;

  /** `stock` / `counter` / `in_transit`。 */
  @Field(() => String)
  locationKind!: string;

  /** 在檯面時的收銀點。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  cashPoint!: LotteryAccountsRefModel | null;

  /** 那個收銀點開著的班的負責人(「店外攤位(陳大文的班)」);沒開班 = null。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  counterShiftOwner!: LotteryAccountsRefModel | null;

  /** 待查 / 遺失時的責任分店。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  responsibleOrg!: LotteryAccountsRefModel | null;

  /** 處理方式(`StoreScanOutcome`)。 */
  @Field(() => String)
  outcome!: string;

  /** `outcome = blocked` 的原因(`StoreScanBlockReason`)。 */
  @Field(() => String, { nullable: true })
  blockReason!: string | null;

  /** 已售時的售出時間(「已於 hh:mm 售出」)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  soldAt!: Date | null;

  /** 未拆的本的待標註張數(拆本並售出要先標跳號)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 未對號(張數店:已售·未對號、待查·未對號、遺失·未對號)。 */
  @Field(() => Boolean)
  unmatched!: boolean;

  /** 這次要先對號再處理(張數店規格 6.7;售出提示加「已對號」)。 */
  @Field(() => Boolean)
  match!: boolean;
}

@ObjectType()
export class LotteryStoreScanPayload {
  @Field(() => [LotteryStoreScanItemModel])
  items!: LotteryStoreScanItemModel[];
}

/**
 * [最近售出] 的一次依張數賣出(張數店規格 13.2、14.2 `lotteryStoreRecentSales`):一個遊戲一列「遊戲 × N 張」。
 */
@ObjectType("LotteryStoreCountSaleRow")
export class LotteryStoreCountSaleRowModel {
  /** 這一次依張數賣的 id(`refType: count_sale` 的 `refId`;撤銷用)。 */
  @Field(() => ID)
  refId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 這一筆賣了幾張。 */
  @Field(() => Int)
  count!: number;

  /** 已撤幾張。 */
  @Field(() => Int)
  undoneCount!: number;

  /** 現在可以撤幾張(這一筆現在帶著的已售·未對號,沒被鎖、之後沒有異動)。 */
  @Field(() => Int)
  undoableCount!: number;
}

/** 一筆售出(售出提示、[最近售出]、撤銷確認視窗)。 */
@ObjectType("LotteryStoreSale")
export class LotteryStoreSaleModel {
  @Field(() => ID)
  ticketId!: string;

  /** 撤銷用的版本(張目前的版本)。 */
  @Field(() => Int)
  version!: number;

  /** 顯示用張編號 `5164-056527-012`。 */
  @Field(() => String)
  ticketKey!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => GraphQLISODateTime)
  soldAt!: Date;

  /** 錢算進的那一班的收銀點。 */
  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => ID)
  shiftId!: string;

  /** 已撤銷。 */
  @Field(() => Boolean)
  undone!: boolean;

  /** 不能當下撤銷的原因(`SaleUndoBlock`);可以 = null。 */
  @Field(() => String, { nullable: true })
  undoBlock!: string | null;

  /**
   * 這次先對號了(張數店規格 7.1 售出提示加「已對號」;7.3 刷退的票:這張接手了 `soldAt` 那一筆依張數售出)。
   */
  @Field(() => Boolean)
  matched!: boolean;

  /** 依張數賣出合成的一列(張數店);刷條碼、手動的 = null。 */
  @Field(() => LotteryStoreCountSaleRowModel, { nullable: true })
  countSale!: LotteryStoreCountSaleRowModel | null;
}

/** 依張數標記售出的一個遊戲(張數店規格 7.2、13.1;成功提示「遊戲 X × 3 張」)。 */
@ObjectType("LotteryStoreCountSale")
export class LotteryStoreCountSaleModel {
  @Field(() => ID)
  refId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  count!: number;

  @Field(() => Int)
  amount!: number;
}

@ObjectType()
export class LotteryStoreCountSalesPayload {
  @Field(() => [LotteryStoreCountSaleModel])
  items!: LotteryStoreCountSaleModel[];
}

@ObjectType()
export class LotteryStoreSalesPayload {
  @Field(() => [LotteryStoreSaleModel])
  items!: LotteryStoreSaleModel[];
}

@ObjectType()
export class LotteryStoreSalePayload {
  @Field(() => LotteryStoreSaleModel)
  item!: LotteryStoreSaleModel;
}

/** 展開卡片 / 拆本精靈的一張(這本在這家店的張;跳號不列)。 */
@ObjectType("LotteryStoreCardTicket")
export class LotteryStoreCardTicketModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  ticketNo!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => String)
  status!: string;

  @Field(() => String)
  locationKind!: string;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  cashPoint!: LotteryAccountsRefModel | null;

  /** 最近一次售出算進的班(「本班售出」)。 */
  @Field(() => ID, { nullable: true })
  soldShiftId!: string | null;

  /** 售出來源(`scan` / `manual` / `stocktake` / `count`);沒售出 = null。 */
  @Field(() => String, { nullable: true })
  soldSource!: string | null;

  @Field(() => Boolean)
  locked!: boolean;

  /** 未對號(張數店;格子畫虛線、「系統預設帶入的張號」)。 */
  @Field(() => Boolean)
  unmatched!: boolean;
}

/** 看板展開的卡片(規格 6.2)或拆本的本(規格 6.4)。 */
@ObjectType("LotteryStoreBookCard")
export class LotteryStoreBookCardModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  firstTicketNo!: string;

  @Field(() => String)
  lastTicketNo!: string;

  /** 待標註張數(迄號 − 標準張數 − 已標跳號)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 這本在這家店還沒拆。 */
  @Field(() => Boolean)
  unopened!: boolean;

  /** 這本在這家店的未對號張數(已售·未對號、待查·遺失·未對號;張數店規格 14.2「表頭多回未對號計數」)。 */
  @Field(() => Int)
  unmatchedCount!: number;

  @Field(() => [LotteryStoreCardTicketModel])
  tickets!: LotteryStoreCardTicketModel[];
}

@ObjectType()
export class LotteryStoreBookCardPayload {
  @Field(() => LotteryStoreBookCardModel)
  item!: LotteryStoreBookCardModel;
}

/**
 * 拆本 / 上檯面「先選本」的一本:本店有未售、在庫存、沒被鎖的張的本(使用者 10/27 定案 D、M1)。
 * `sealed` = 這家店原封不動(標「未拆」、要標跳號);其他標「拆過 · 庫存 N 張」,不標跳號、只分配庫存的張。
 */
@ObjectType("LotteryStoreStockBook")
export class LotteryStoreStockBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  firstTicketNo!: string;

  @Field(() => String)
  lastTicketNo!: string;

  /** 這家店庫存裡未售、沒被鎖的張數(不含跳號;原封不動的本扣掉待標註)。 */
  @Field(() => Int)
  ticketCount!: number;

  /** 這次拆本要標的跳號張數(只有原封不動的本;其他 = 0,待標註之後在本的詳情補標)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 這家店原封不動:從沒拆過、這家店的張全是未售在庫存。 */
  @Field(() => Boolean)
  sealed!: boolean;
}

@ObjectType()
export class LotteryStoreStockBooksPayload {
  @Field(() => [LotteryStoreStockBookModel])
  items!: LotteryStoreStockBookModel[];
}

/** 拆本、移櫃、收回寫了幾張。 */
@ObjectType()
export class LotteryStoreCounterPayload {
  @Field(() => Int)
  count!: number;
}
