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
}

@ObjectType()
export class LotteryStoreScanPayload {
  @Field(() => [LotteryStoreScanItemModel])
  items!: LotteryStoreScanItemModel[];
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

  @Field(() => Boolean)
  locked!: boolean;
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

  @Field(() => [LotteryStoreCardTicketModel])
  tickets!: LotteryStoreCardTicketModel[];
}

@ObjectType()
export class LotteryStoreBookCardPayload {
  @Field(() => LotteryStoreBookCardModel)
  item!: LotteryStoreBookCardModel;
}

/**
 * 拆本 / 上檯面「先選本」的一本:本店有未售、在庫存、沒被鎖的張的本(使用者 10/27 定案 D)。
 * `opened` = 拆過(第一次拆本後):畫面標「拆過 · 庫存 N 張」,精靈不標跳號、只分配庫存的張。
 */
@ObjectType("LotteryStoreUnopenedBook")
export class LotteryStoreUnopenedBookModel {
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

  /** 這家店庫存裡未售、沒被鎖的張數(不含跳號;未拆的本扣掉待標註)。 */
  @Field(() => Int)
  ticketCount!: number;

  /** 待標註張數(拆過的本 = 0:第一次拆本已標完)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 拆過(本的 `firstOpenedAt` 有值)。 */
  @Field(() => Boolean)
  opened!: boolean;
}

@ObjectType()
export class LotteryStoreUnopenedBooksPayload {
  @Field(() => [LotteryStoreUnopenedBookModel])
  items!: LotteryStoreUnopenedBookModel[];
}

/** 拆本、移櫃、收回寫了幾張。 */
@ObjectType()
export class LotteryStoreCounterPayload {
  @Field(() => Int)
  count!: number;
}
