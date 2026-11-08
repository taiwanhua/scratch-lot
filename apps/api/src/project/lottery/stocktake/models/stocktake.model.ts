import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";
import {
  LotteryRescanBriefModel,
  LotteryRescanReminderModel,
} from "./rescan.model";
import {
  LotteryStocktakeCountGroupModel,
  LotteryStocktakeDetailCountLineModel,
  LotteryStocktakeDetailUncountedGroupModel,
  LotteryStocktakeReviewCountLineModel,
} from "./stocktake-count.model";

/** 收銀點的一班(盤點頁每個收銀點旁的應有現金;補登售出算到哪一班)。 */
@ObjectType("LotteryStocktakeShift")
export class LotteryStocktakeShiftModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  ownerName!: string;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 已送出交班結帳。 */
  @Field(() => Boolean)
  closed!: boolean;

  /** 抽屜目前的應有現金(開著的班才有)。 */
  @Field(() => Int, { nullable: true })
  expectedCash!: number | null;
}

@ObjectType("LotteryStocktakeCashPoint")
export class LotteryStocktakeCashPointModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  /** 開著的班;沒有 = null([補登兌獎] 停用)。 */
  @Field(() => LotteryStocktakeShiftModel, { nullable: true })
  shift!: LotteryStocktakeShiftModel | null;

  /** 最近一班(沒有開著的班時,補登售出記成它的事後更正);從來沒開過班 = null。 */
  @Field(() => LotteryStocktakeShiftModel, { nullable: true })
  lastShift!: LotteryStocktakeShiftModel | null;
}

/** 檯面上的一張(未售 / 已售)。 */
@ObjectType("LotteryStocktakeTicket")
export class LotteryStocktakeTicketModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => String)
  ticketNo!: string;

  @Field(() => Int)
  version!: number;

  /** `unsold` / `sold`(補點編號另有待查 / 遺失·未對號) */
  @Field(() => String)
  status!: string;

  /** 未對號(系統預設帶入的張號;格子虛線;張數店規格 13.2) */
  @Field(() => Boolean)
  unmatched!: boolean;

  /** 撤銷售出申請審核中(「撤銷審核中」,不算差異)。 */
  @Field(() => Boolean)
  pendingReversal!: boolean;
}

/** 一本 × 收銀點的檯面。 */
@ObjectType("LotteryStocktakeBook")
export class LotteryStocktakeBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 補點編號:不在的張最多可以 [標跳號] 幾張(這本的待標註;其他盤點 = 0;張數店規格 9.3 第 3 點)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 本號 7 位。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => [LotteryStocktakeTicketModel])
  tickets!: LotteryStocktakeTicketModel[];
}

/** 本店還沒拆的本。 */
@ObjectType("LotteryStocktakeUnopenedBook")
export class LotteryStocktakeUnopenedBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  ticketCount!: number;
}

/** 待查清單的一張。 */
@ObjectType("LotteryStocktakeLostTicket")
export class LotteryStocktakeLostTicketModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  ticketNo!: string;

  /** 這本在這家店的張數(整本都待查時顯示「整本」)。 */
  @Field(() => Int)
  bookTicketCount!: number;

  /** 改成待查的時間;找不到事件 = null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  since!: Date | null;

  /** 怎麼變成待查的:`transfer`(調貨在途刪除)/ `stocktake`(盤點時不在)/ 其他 = null。 */
  @Field(() => String, { nullable: true })
  source!: string | null;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameName!: string;

  /**
   * 待查·未對號(張數盤點 [待查] 由系統預設帶入的張號):不提供 [找到了],只有 [確認遺失]、[繼續待查]
   * (張數店規格 7.9、13.2);依「遊戲 × 來源盤點」一組。
   */
  @Field(() => Boolean)
  unmatched!: boolean;

  /** 來源盤點單(`source = stocktake` 時;未對號依它分組)。 */
  @Field(() => ID, { nullable: true })
  sourceId!: string | null;

  /** 來源盤點的類型(`shift` / `daily` / `adhoc`;找不到 = null)。 */
  @Field(() => String, { nullable: true })
  sourceType!: string | null;

  /** 待查時在哪個收銀點(張數盤點 [待查] 的那一組;庫存 / 不明 = null)。 */
  @Field(() => String, { nullable: true })
  sourceCashPointName!: string | null;
}

/** 盤點頁(ST-13):收銀點、檯面上的本、未拆的本、待查清單。 */
@ObjectType("LotteryStocktakeSheet")
export class LotteryStocktakeSheetModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 伺服器現在的時間(畫面以它換算 `countedAt`,不受裝置時鐘影響)。 */
  @Field(() => GraphQLISODateTime)
  serverNow!: Date;

  @Field(() => [LotteryStocktakeCashPointModel])
  cashPoints!: LotteryStocktakeCashPointModel[];

  @Field(() => [LotteryStocktakeBookModel])
  books!: LotteryStocktakeBookModel[];

  @Field(() => [LotteryStocktakeUnopenedBookModel])
  unopenedBooks!: LotteryStocktakeUnopenedBookModel[];

  @Field(() => [LotteryStocktakeLostTicketModel])
  lostTickets!: LotteryStocktakeLostTicketModel[];

  /** 盤點制度:`numbered`(檯面逐張)/ `count`(張數店與轉換中:檯面數張數,張數店規格 8.1)。 */
  @Field(() => String)
  countMode!: string;

  /** `normal` / `renumber`(補點編號:張數店的全店編號盤點,`countMode` = `numbered`;張數店規格 9.3)。 */
  @Field(() => String)
  purpose!: string;

  /** 張數盤點的組(收銀點 × 遊戲,依收銀點順序、遊戲);編號盤點 = 空,檯面照舊在 `books`。 */
  @Field(() => [LotteryStocktakeCountGroupModel])
  countGroups!: LotteryStocktakeCountGroupModel[];
}

@ObjectType("LotteryStocktakeSummary")
export class LotteryStocktakeSummaryModel {
  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  backfillCount!: number;

  @Field(() => Int)
  backfillAmount!: number;

  @Field(() => Int)
  newInvestigate!: number;

  @Field(() => Int)
  flagged!: number;

  @Field(() => Int)
  confirmLost!: number;

  /** 確認遺失的批購成本(沒有 `inventory.show-cost` = null)。 */
  @Field(() => Int, { nullable: true })
  confirmLostCost!: number | null;

  /** 送出時範圍內還沒盤的本數(沒盤完可以送出;盤點紀錄標「N 本未盤」)。 */
  @Field(() => Int)
  uncountedCount!: number;

  /** 補點編號自動對號的張數(不算差異;張數店規格 9.3 第 2 點)。 */
  @Field(() => Int)
  renumberMatched!: number;
}

/** 差異核對的一張(ST-14)。 */
@ObjectType("LotteryStocktakeDiff")
export class LotteryStocktakeDiffModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => String)
  ticketNo!: string;

  /** 補登售出用(條件更新)。 */
  @Field(() => Int)
  version!: number;

  /** `missing`(系統未售、實際不在)/ `extra`(系統已售、實際還在) */
  @Field(() => String)
  kind!: string;

  /** 這次盤點已補登售出。 */
  @Field(() => Boolean)
  backfilled!: boolean;
}

@ObjectType("LotteryStocktakeReviewLine")
export class LotteryStocktakeReviewLineModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 補點編號:不在的張最多可以 [標跳號] 幾張(這本的待標註;其他盤點 = 0)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  @Field(() => Int)
  systemCount!: number;

  @Field(() => Int)
  presentCount!: number;

  @Field(() => [LotteryStocktakeDiffModel])
  diffs!: LotteryStocktakeDiffModel[];

  /** 撤銷審核中(不算差異)。 */
  @Field(() => [String])
  pendingReversalTicketNos!: string[];

  /** 畫面上的處理已對不到(這幾張已被處理,請重新核對)。 */
  @Field(() => [String])
  staleTicketNos!: string[];
}

/** 差異核對 / 送出前檢查(ST-14、ST-15)。 */
@ObjectType("LotteryStocktakeReview")
export class LotteryStocktakeReviewModel {
  @Field(() => [LotteryStocktakeReviewLineModel])
  lines!: LotteryStocktakeReviewLineModel[];

  /** 張數盤點的組(編號盤點 = 空)。 */
  @Field(() => [LotteryStocktakeReviewCountLineModel])
  countLines!: LotteryStocktakeReviewCountLineModel[];

  /** 補點編號的自動對號(不算差異;其他盤點 = 空)。 */
  @Field(() => [LotteryStocktakeRenumberMatchModel])
  renumberMatches!: LotteryStocktakeRenumberMatchModel[];

  /** 補點編號還沒盤的本(含未拆的本還沒回答在 / 不在;要 0 才能送出)。 */
  @Field(() => Int)
  renumberMissing!: number;

  /** 送出時還沒數的組 / 本(交班盤點的張數店不能沒盤完送出)。 */
  @Field(() => Int)
  uncountedCount!: number;

  @Field(() => Int)
  staleCount!: number;

  @Field(() => Int)
  unhandledCount!: number;

  @Field(() => LotteryStocktakeSummaryModel)
  summary!: LotteryStocktakeSummaryModel;
}

/** 補點編號的一組自動對號(張數店規格 9.3 第 2 點):實際在的未對號張 ↔ 實際不在的未售張,不算差異。 */
@ObjectType("LotteryStocktakeRenumberMatch")
export class LotteryStocktakeRenumberMatchModel {
  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 位置(收銀點;庫存 = null) */
  @Field(() => ID, { nullable: true })
  cashPointId!: string | null;

  @Field(() => String, { nullable: true })
  cashPointName!: string | null;

  /** 實際在的那張 */
  @Field(() => String)
  ticketNo!: string;

  @Field(() => String)
  bookNo!: string;

  /** 實際不在、接手系統預設帶入狀態的那張 */
  @Field(() => String)
  partnerTicketNo!: string;

  @Field(() => String)
  partnerBookNo!: string;
}

/** 補登售出的一張(立即生效)。 */
@ObjectType("LotteryStocktakeBackfill")
export class LotteryStocktakeBackfillModel {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => String)
  ticketNo!: string;

  /** 寫入的售出事件 id(盤點內容記下,送出時核對)。 */
  @Field(() => String)
  eventId!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => ID)
  shiftId!: string;

  /** 記成那一班的事後更正(那個收銀點沒有開著的班)。 */
  @Field(() => Boolean)
  postClose!: boolean;
}

/** 看板頂部:上次盤點(距離超過 24 小時提醒「建議盤點一次」)。 */
@ObjectType("LotteryStocktakeStatus")
export class LotteryStocktakeStatusModel {
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastSubmittedAt!: Date | null;

  @Field(() => Boolean)
  remind!: boolean;

  /** 進行中的全店重刷(看板橫幅、盤點頁 B5;張數店規格 8.5a、13.2) */
  @Field(() => [LotteryRescanBriefModel])
  rescans!: LotteryRescanBriefModel[];

  /** 要提醒全店重刷的遊戲(張數店規格 8.3) */
  @Field(() => [LotteryRescanReminderModel])
  rescanReminders!: LotteryRescanReminderModel[];
}

/** 盤點紀錄分頁的一列(ST-29)。 */
@ObjectType("LotteryStocktakeListItem")
export class LotteryStocktakeListItemModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => String)
  type!: string;

  @Field(() => String)
  status!: string;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;

  @Field(() => LotteryStocktakeSummaryModel)
  summary!: LotteryStocktakeSummaryModel;
}

@ObjectType("LotteryStocktakesPayload")
export class LotteryStocktakesPayload {
  @Field(() => [LotteryStocktakeListItemModel])
  items!: LotteryStocktakeListItemModel[];

  @Field(() => Int)
  total!: number;
}

@ObjectType("LotteryStocktakeDetailDiff")
export class LotteryStocktakeDetailDiffModel {
  @Field(() => String)
  ticketNo!: string;

  @Field(() => String)
  kind!: string;

  @Field(() => String)
  action!: string;

  @Field(() => Boolean)
  postClose!: boolean;

  @Field(() => Int)
  amount!: number;
}

@ObjectType("LotteryStocktakeDetailLine")
export class LotteryStocktakeDetailLineModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  method!: string;

  @Field(() => GraphQLISODateTime)
  countedAt!: Date;

  @Field(() => Int)
  systemCount!: number;

  @Field(() => Int)
  presentCount!: number;

  @Field(() => [LotteryStocktakeDetailDiffModel])
  diffs!: LotteryStocktakeDetailDiffModel[];
}

@ObjectType("LotteryStocktakeDetailUnopened")
export class LotteryStocktakeDetailUnopenedModel {
  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  ticketCount!: number;

  @Field(() => Boolean)
  present!: boolean;
}

@ObjectType("LotteryStocktakeDetailLostReview")
export class LotteryStocktakeDetailLostReviewModel {
  @Field(() => String)
  label!: string;

  @Field(() => String)
  action!: string;

  @Field(() => String, { nullable: true })
  reasonLabel!: string | null;

  @Field(() => String, { nullable: true })
  reasonNote!: string | null;
}

/** 送出時範圍內還沒盤的一本(不比對;檢視頁列出)。 */
@ObjectType("LotteryStocktakeDetailUncounted")
export class LotteryStocktakeDetailUncountedModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  cashPointId!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => String)
  bookNo!: string;
}

/** 盤點確認申請檢視頁(ST-30)的盤點單。 */
@ObjectType("LotteryStocktakeDetail")
export class LotteryStocktakeDetailModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  type!: string;

  @Field(() => String)
  status!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 單一收銀點的盤點;全店 = null。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  scopeCashPoint!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => GraphQLISODateTime)
  submittedAt!: Date;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  submittedBy!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  confirmedAt!: Date | null;

  @Field(() => [LotteryStocktakeDetailLineModel])
  lines!: LotteryStocktakeDetailLineModel[];

  @Field(() => [LotteryStocktakeDetailUnopenedModel])
  unopened!: LotteryStocktakeDetailUnopenedModel[];

  @Field(() => [LotteryStocktakeDetailLostReviewModel])
  lostReview!: LotteryStocktakeDetailLostReviewModel[];

  /** 送出時範圍內還沒盤的本(沒盤完可以送出;不比對)。 */
  @Field(() => [LotteryStocktakeDetailUncountedModel])
  uncountedBooks!: LotteryStocktakeDetailUncountedModel[];

  /** 盤點制度(`numbered` / `count`)。 */
  @Field(() => String)
  countMode!: string;

  /** 張數盤點的組(含 [重數] 前的每次輸入)。 */
  @Field(() => [LotteryStocktakeDetailCountLineModel])
  countLines!: LotteryStocktakeDetailCountLineModel[];

  /** 張數盤點送出時還沒數的組。 */
  @Field(() => [LotteryStocktakeDetailUncountedGroupModel])
  uncountedGroups!: LotteryStocktakeDetailUncountedGroupModel[];

  @Field(() => LotteryStocktakeSummaryModel)
  summary!: LotteryStocktakeSummaryModel;

  /** 盤點內容(退回後打開盤點頁時帶入原內容)。 */
  @Field(() => String)
  draft!: string;
}

@ObjectType("LotteryStocktakeBackfillPayload")
export class LotteryStocktakeBackfillPayload {
  @Field(() => [LotteryStocktakeBackfillModel])
  items!: LotteryStocktakeBackfillModel[];
}
