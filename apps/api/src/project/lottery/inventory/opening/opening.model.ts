import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryInventoryRefModel } from "../models/lottery-inventory.model";

/** 期初建檔結束 / 重新開放的一筆歷程。 */
@ObjectType("LotteryStoreOpeningHistory")
export class LotteryStoreOpeningHistoryModel {
  /** `close` / `reopen`。 */
  @Field(() => String)
  action!: string;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  /** 誰(讀不到的人 = null)。 */
  @Field(() => LotteryInventoryRefModel, { nullable: true })
  by!: LotteryInventoryRefModel | null;

  /** 重新開放的原因;結束 = null。 */
  @Field(() => String, { nullable: true })
  reason!: string | null;
}

/** 手上的張在哪一個位置幾張。 */
@ObjectType("LotteryOpeningPlace")
export class LotteryOpeningPlaceModel {
  /** 收銀點;null = 庫存。 */
  @Field(() => LotteryInventoryRefModel, { nullable: true })
  cashPoint!: LotteryInventoryRefModel | null;

  @Field(() => Int)
  count!: number;
}

/** 這家店已建檔的一本(期初建檔頁下方清單)。 */
@ObjectType("LotteryOpeningBook")
export class LotteryOpeningBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  bookKey!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  lastTicketNo!: string;

  /** 導入前已賣出(現在仍是期初已售的張)。 */
  @Field(() => Int)
  openingSoldCount!: number;

  /** 在手上(未售)。 */
  @Field(() => Int)
  inHandCount!: number;

  @Field(() => [LotteryOpeningPlaceModel])
  places!: LotteryOpeningPlaceModel[];

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  openedBy!: LotteryInventoryRefModel | null;

  @Field(() => GraphQLISODateTime)
  openingAt!: Date;

  /** 這本還沒有其他動作(只有期初建檔事件)→ 可以作廢(E4)。 */
  @Field(() => Boolean)
  voidable!: boolean;
}

/** 一家分店的期初建檔狀態與已建檔的本。 */
@ObjectType("LotteryStoreOpening")
export class LotteryStoreOpeningModel {
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  /** 已結束(`closedAt` 有值)。 */
  @Field(() => Boolean)
  closed!: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  closedAt!: Date | null;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  closedBy!: LotteryInventoryRefModel | null;

  /** 第一本建檔的時間(報表區塊 8 註記「MM/DD 開始期初建檔」);還沒建 = null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  startedAt!: Date | null;

  @Field(() => [LotteryStoreOpeningHistoryModel])
  history!: LotteryStoreOpeningHistoryModel[];

  /** 已建檔的本數(不含作廢)。 */
  @Field(() => Int)
  bookCount!: number;

  /** 已建檔的本(新的在上;沒有 `inventory.opening` → 空)。 */
  @Field(() => [LotteryOpeningBookModel])
  books!: LotteryOpeningBookModel[];

  /** 能建檔、作廢:有 `inventory.opening`,而且還在進行中。 */
  @Field(() => Boolean)
  canOpen!: boolean;

  /** 能 [結束期初建檔] / [重新開放]:有 `lottery-settings.edit-org`。 */
  @Field(() => Boolean)
  canClose!: boolean;

  /** 能看成本(`inventory.show-cost`;建檔頁成本欄)。 */
  @Field(() => Boolean)
  canShowCost!: boolean;
}

@ObjectType("LotteryStoreOpeningPayload")
export class LotteryStoreOpeningPayload {
  @Field(() => LotteryStoreOpeningModel)
  item!: LotteryStoreOpeningModel;
}

/**
 * 期初建檔頁刷到一張的一個候選(一款遊戲)。背面編號只有一款;正面編號沒有遊戲代號 → 列出全部遊戲,請選遊戲。
 * `block`:null = 可以建;`exists` = 這本已經在系統裡(`bookId`);`on_purchase` = 在有效的進貨單上(`serialNo`)。
 */
@ObjectType("LotteryOpeningScanCandidate")
export class LotteryOpeningScanCandidateModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  ticketsPerBook!: number;

  @Field(() => Int)
  bookPrice!: number;

  @Field(() => Int)
  defaultRate!: number;

  /** 停售的遊戲可以建,畫面提示「這款遊戲已停售」。 */
  @Field(() => Boolean)
  discontinued!: boolean;

  @Field(() => String, { nullable: true })
  block!: string | null;

  @Field(() => ID, { nullable: true })
  bookId!: string | null;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;
}

@ObjectType("LotteryOpeningScanPayload")
export class LotteryOpeningScanPayload {
  /** 本號(7 位);碼看不懂 = null。 */
  @Field(() => String, { nullable: true })
  bookNo!: string | null;

  /** 刷到的張號 = 手上最上面那一張(預先標好比它小的)。 */
  @Field(() => String, { nullable: true })
  topTicketNo!: string | null;

  /** 碼裡有遊戲代號(背面編號)。 */
  @Field(() => Boolean)
  hasGameCode!: boolean;

  @Field(() => [LotteryOpeningScanCandidateModel])
  candidates!: LotteryOpeningScanCandidateModel[];
}

/** 建檔 / 作廢的結果。 */
@ObjectType("LotteryOpeningBookPayload")
export class LotteryOpeningBookPayload {
  @Field(() => ID)
  bookId!: string;

  /** 寫了幾張(= 迄號)。 */
  @Field(() => Int)
  count!: number;
}
