import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/**
 * 張數盤點(張數店規格 8.1、8.2、13.1 張數盤點頁)與盤點中登記(8.5a)的 GraphQL 形狀。
 */

/** 盤點頁的一組「收銀點 × 遊戲」(張數盤點;Figma CS-09a)。 */
@ObjectType("LotteryStocktakeCountGroup")
export class LotteryStocktakeCountGroupModel {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /**
   * 這一組現在的未售張數(畫面數之前不顯示,按 [確定] 後才顯示;送出時以開始數那一刻比對)。
   */
  @Field(() => Int)
  unsoldCount!: number;

  /** 這一組未售的張在哪幾本(本號 7 位,依本號排)。 */
  @Field(() => [String])
  bookNos!: string[];
}

/** 差異核對的一組(張數盤點;Figma CS-09c)。 */
@ObjectType("LotteryStocktakeReviewCountLine")
export class LotteryStocktakeReviewCountLineModel {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 開始數那一刻的未售張數。 */
  @Field(() => Int)
  systemCount!: number;

  @Field(() => Int)
  presentCount!: number;

  /** `match` / `short` / `over`(`countDiffOf`)。 */
  @Field(() => String)
  kind!: string;

  /** 差幾張(沒差 = 0)。 */
  @Field(() => Int)
  diffCount!: number;

  /** 這次盤點真的 [算售出] 的張數。 */
  @Field(() => Int)
  saleCount!: number;

  /**
   * 這一組要重數(8.5a B6:開始數之後被別張盤點 / 重刷 / 補點處理過;或處理對不上目前的差異)。
   */
  @Field(() => Boolean)
  stale!: boolean;

  /** 還沒處理完(少的還沒分完、多的還沒 [標記異常])。 */
  @Field(() => Boolean)
  unhandled!: boolean;
}

/** [算售出 N 張] 的結果(立即生效)。 */
@ObjectType("LotteryStocktakeCountBackfill")
export class LotteryStocktakeCountBackfillModel {
  /** 這次算售出的 id(盤點內容記下,送出時核對是自己算售出的)。 */
  @Field(() => ID)
  refId!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => Int)
  amount!: number;

  @Field(() => ID)
  shiftId!: string;

  /** 記成那一班的事後更正(那個收銀點沒有開著的班)。 */
  @Field(() => Boolean)
  postClose!: boolean;
}

/** 檢視頁的一組(張數盤點)。 */
@ObjectType("LotteryStocktakeDetailCountLine")
export class LotteryStocktakeDetailCountLineModel {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => GraphQLISODateTime)
  countedAt!: Date;

  @Field(() => Int)
  systemCount!: number;

  @Field(() => Int)
  presentCount!: number;

  /** 之前的每次輸入(例:第一次數 11、改成 12 → [11])。 */
  @Field(() => [Int])
  recounts!: number[];

  @Field(() => Int)
  saleCount!: number;

  @Field(() => Int)
  saleAmount!: number;

  @Field(() => Int)
  investigateCount!: number;

  @Field(() => Int)
  flaggedCount!: number;
}

/** 檢視頁:送出時還沒數的組。 */
@ObjectType("LotteryStocktakeDetailUncountedGroup")
export class LotteryStocktakeDetailUncountedGroupModel {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;
}

/** 盤點中登記的一筆(8.5a;Figma ST-13-2a~d、ST-17a-2a / 2b、ST-01-2)。 */
@ObjectType("LotteryStocktakeSession")
export class LotteryStocktakeSessionModel {
  @Field(() => ID)
  sessionId!: string;

  /** `shift` / `daily` / `adhoc` */
  @Field(() => String)
  type!: string;

  /** `normal` / `renumber`(補點編號;被擋時寫「補點編號 · 全店」) */
  @Field(() => String)
  purpose!: string;

  /** 全店盤點(全部收銀點與庫存)。 */
  @Field(() => Boolean)
  wholeStore!: boolean;

  /** 單一收銀點盤點的那台;全店 = null。 */
  @Field(() => ID, { nullable: true })
  cashPointId!: string | null;

  /** 單一收銀點盤點的那台名稱;全店 = null(畫面寫「全店」)。 */
  @Field(() => String, { nullable: true })
  cashPointName!: string | null;

  @Field(() => ID)
  byId!: string;

  @Field(() => String)
  byName!: string;

  /** 自己的登記(可 [繼續] / [放棄])。 */
  @Field(() => Boolean)
  mine!: boolean;

  /** 店長可以 [結束這個盤點](別人的、還有效的;店長 = 有店面管理「編輯」)。 */
  @Field(() => Boolean)
  canEnd!: boolean;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => GraphQLISODateTime)
  lastActiveAt!: Date;

  /** 自動失效的時間(最後一次操作 + 1 小時)。 */
  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;

  /** 剩幾分鐘自動結束(失效 = 0)。 */
  @Field(() => Int)
  minutesLeft!: number;

  /** 還有效(沒失效、沒被店長結束)。 */
  @Field(() => Boolean)
  live!: boolean;

  /** 被店長結束(進度保留,本人回來仍可 [繼續])。 */
  @Field(() => Boolean)
  ended!: boolean;

  /** 盤點進度(只有自己的才給;`serializeStocktakeDraft` 的字串)。 */
  @Field(() => String, { nullable: true })
  draft!: string | null;
}

/** 這家店的盤點中登記(看板、盤點頁、交班第 ① 步)。 */
@ObjectType("LotteryStocktakeSessions")
export class LotteryStocktakeSessionsModel {
  @Field(() => GraphQLISODateTime)
  serverNow!: Date;

  /** 有效的登記與自己的登記(含失效、被結束的;給 [繼續])。 */
  @Field(() => [LotteryStocktakeSessionModel])
  items!: LotteryStocktakeSessionModel[];
}
