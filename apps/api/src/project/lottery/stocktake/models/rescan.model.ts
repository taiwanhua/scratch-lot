import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/**
 * 全店重刷(張數店規格 8.3–8.5a、13.1 全店重刷頁、13.2 看板;Figma CS-01c、CS-10a–d)的 GraphQL 形狀。
 * 位置的 `cashPointId` = null 是庫存。
 */

/** 刷到的一張與它的結果(`RescanOutcome`,按刷完後的結果另加 `investigated`)。 */
@ObjectType("LotteryRescanItem")
export class LotteryRescanItemModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  ticketNo!: string;

  /** `RescanOutcome` 或 `investigated`(沒刷到 → 待查) */
  @Field(() => String)
  outcome!: string;

  /** `matched`:互換的配對張張號 */
  @Field(() => String, { nullable: true })
  partnerTicketNo!: string | null;

  /** 處理時的位置(刷完後的結果用;null = 庫存) */
  @Field(() => ID, { nullable: true })
  cashPointId!: string | null;
}

/** 重刷的一個位置。 */
@ObjectType("LotteryRescanPlace")
export class LotteryRescanPlaceModel {
  @Field(() => ID, { nullable: true })
  cashPointId!: string | null;

  /** 收銀點名稱;庫存 = 空字串(畫面寫「庫存」) */
  @Field(() => String)
  name!: string;

  /** `pending` 還沒刷 / `scanning` 刷到一半 / `released` 刷到一半但 1 小時沒刷 / `done` 刷完 */
  @Field(() => String)
  state!: string;

  /** 刷到一半的人(scanning / released) */
  @Field(() => String, { nullable: true })
  scanningByName!: string | null;

  /** 刷到一半的人是我 */
  @Field(() => Boolean)
  mine!: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  doneAt!: Date | null;

  @Field(() => String, { nullable: true })
  doneByName!: string | null;

  @Field(() => Int)
  scannedCount!: number;

  /** 刷到的張與結果(還沒刷完的位置 = 照現在的清單預先算出的結果;刷完 = 寫下的結果,不含沒問題) */
  @Field(() => [LotteryRescanItemModel])
  items!: LotteryRescanItemModel[];
}

/** 一次全店重刷(重刷頁;CS-10b / CS-10d)。 */
@ObjectType("LotteryRescan")
export class LotteryRescanModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** `in_progress` / `finished` / `cancelled` */
  @Field(() => String)
  status!: string;

  /** 取消的原因:`manual`([取消重刷])/ `expired`(1 小時沒動作自動取消) */
  @Field(() => String, { nullable: true })
  cancelCause!: string | null;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => String)
  startedByName!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  finishedAt!: Date | null;

  /** 剩幾分鐘自動取消(進行中才有意義) */
  @Field(() => Int)
  minutesLeft!: number;

  /** 開始重刷的人或店長、而且還在進行中 */
  @Field(() => Boolean)
  canCancel!: boolean;

  @Field(() => Int)
  doneCount!: number;

  @Field(() => [LotteryRescanPlaceModel])
  places!: LotteryRescanPlaceModel[];

  /** 刷完的位置寫下的結果(不含沒問題;結果摘要用) */
  @Field(() => [LotteryRescanItemModel])
  results!: LotteryRescanItemModel[];
}

/** 刷到一張的回應:這張的結果(重複刷到 = `duplicate`)與整個重刷。 */
@ObjectType("LotteryRescanScanPayload")
export class LotteryRescanScanPayload {
  @Field(() => LotteryRescanItemModel)
  item!: LotteryRescanItemModel;

  @Field(() => Boolean)
  duplicate!: boolean;

  @Field(() => LotteryRescanModel)
  rescan!: LotteryRescanModel;
}

/** 看板 / 盤點頁的全店重刷提醒(8.3):遊戲與為什麼要重刷。 */
@ObjectType("LotteryRescanReminder")
export class LotteryRescanReminderModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 待查·未對號(上次重刷完成後記的) */
  @Field(() => Int)
  investigateCount!: number;

  /** 標記異常的張數(上次重刷完成後送出的盤點) */
  @Field(() => Int)
  flaggedCount!: number;
}

/** 看板頂部的進行中重刷(13.2:「遊戲 X 全店重刷中,暫停移櫃 · 已刷 1/3 個位置(還沒刷:…)」)。 */
@ObjectType("LotteryRescanBrief")
export class LotteryRescanBriefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  startedByName!: string;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => Int)
  minutesLeft!: number;

  @Field(() => Int)
  doneCount!: number;

  /** 各位置與狀態(還沒刷完的列在橫幅;盤點頁 B5 讓 P × X 那一組變灰) */
  @Field(() => [LotteryRescanPlaceModel])
  places!: LotteryRescanPlaceModel[];
}
