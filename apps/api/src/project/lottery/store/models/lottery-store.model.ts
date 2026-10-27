import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 收銀點標題列上的那一班(開著的)。 */
@ObjectType("LotteryStoreShift")
export class LotteryStoreShiftModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  /** 負責人(開班的人)。 */
  @Field(() => LotteryAccountsRefModel)
  openedBy!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 負責人是操作者本人。 */
  @Field(() => Boolean)
  isMine!: boolean;

  @Field(() => Int)
  openingFloat!: number;

  /** 抽屜目前的應有現金(`expectedDrawerCash`)。 */
  @Field(() => Int)
  expectedCash!: number;

  /** 本班已售張數(售出 − 撤銷)。 */
  @Field(() => Int)
  soldCount!: number;

  /** 本班已售金額(售出 − 撤銷)。 */
  @Field(() => Int)
  soldAmount!: number;

  /** 開班時選「沒有排班(臨時代班)」:畫面標「未對應排班」。 */
  @Field(() => Boolean)
  unmatchedEntry!: boolean;
}

/** 看板卡片:某本 × 某收銀點的檯面。 */
@ObjectType("LotteryStoreBoardBook")
export class LotteryStoreBoardBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 遊戲顏色(標籤色票代號;沒設 = null)。 */
  @Field(() => String, { nullable: true })
  color!: string | null;

  /** 面額(單張金額)。 */
  @Field(() => Int)
  unitPrice!: number;

  /** 本號 7 位。 */
  @Field(() => String)
  bookNo!: string;

  /** 剩餘(這個收銀點檯面上未售的張)。 */
  @Field(() => Int)
  remaining!: number;

  /** 總張數(這本放在這個收銀點的張,不含跳號)。 */
  @Field(() => Int)
  total!: number;

  /** 今日售出(租戶時區的今天)。 */
  @Field(() => Int)
  soldToday!: number;

  /** 剩很少的提示。 */
  @Field(() => Boolean)
  isLowStock!: boolean;
}

/** 看板的一個收銀點(依排序)。 */
@ObjectType("LotteryStoreCashPoint")
export class LotteryStoreCashPointModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  positionKey!: string;

  /** 開著的班;未開班 = null。 */
  @Field(() => LotteryStoreShiftModel, { nullable: true })
  shift!: LotteryStoreShiftModel | null;

  @Field(() => [LotteryStoreBoardBookModel])
  books!: LotteryStoreBoardBookModel[];
}

/** 看板(一家店)。 */
@ObjectType("LotteryStoreBoard")
export class LotteryStoreBoardModel {
  @Field(() => LotteryAccountsRefModel)
  org!: LotteryAccountsRefModel;

  /** 啟用中的收銀點(依排序、名稱)。 */
  @Field(() => [LotteryStoreCashPointModel])
  cashPoints!: LotteryStoreCashPointModel[];

  /** 操作者在這家店開著的班(頂部「你開著的班」)。 */
  @Field(() => [LotteryStoreShiftModel])
  myOpenShifts!: LotteryStoreShiftModel[];

  /** 小金庫目前的應有(出庫視窗顯示)。 */
  @Field(() => Int)
  vaultExpected!: number;
}

@ObjectType()
export class LotteryStoreBoardPayload {
  @Field(() => LotteryStoreBoardModel)
  item!: LotteryStoreBoardModel;
}

/** 排班填進的一筆執行任務(職責 + 任務內容 + 人力需求的崗位)。 */
@ObjectType("LotteryStoreEntryTask")
export class LotteryStoreEntryTaskModel {
  /** `leader` 負責 / `helper` 協同 */
  @Field(() => String)
  role!: string;

  @Field(() => String)
  taskKey!: string;

  @Field(() => String)
  positionKey!: string;
}

/** 開班 / 改對應排班可以選的一筆排班(已發布)。 */
@ObjectType("LotteryStoreEntryOption")
export class LotteryStoreEntryOptionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  /** 範本簡稱;未套用範本 = null。 */
  @Field(() => String, { nullable: true })
  shortName!: string | null;

  @Field(() => [LotteryStoreEntryTaskModel])
  tasks!: LotteryStoreEntryTaskModel[];

  /** 收銀點崗位那一筆任務(寫進任務快照的);對不到 = null(崗位不一致)。 */
  @Field(() => LotteryStoreEntryTaskModel, { nullable: true })
  snapshot!: LotteryStoreEntryTaskModel | null;

  /** 已打這一班的上班卡。 */
  @Field(() => Boolean)
  hasStartPunch!: boolean;
}

/** 開班視窗要的資料(規格 6.2、6.6、14.9)。 */
@ObjectType("LotteryStoreOpenShiftForm")
export class LotteryStoreOpenShiftFormModel {
  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => String)
  positionKey!: string;

  /** `first` 第一班(可從小金庫領零用金)/ `handover` 上一班留給下一班。 */
  @Field(() => String)
  plan!: string;

  /** 上一班留給下一班(`handover` 時的期初)。 */
  @Field(() => Int)
  handoverAmount!: number;

  /** 上一班的負責人與結束時間(`handover` 時顯示來源)。 */
  @Field(() => LotteryAccountsRefModel, { nullable: true })
  previousOpenedBy!: LotteryAccountsRefModel | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  previousClosedAt!: Date | null;

  /** 第一班且有 `store.withdraw`:顯示「從小金庫領零用金」。 */
  @Field(() => Boolean)
  canTakeFloat!: boolean;

  /** 系統依時間找到的排班(`findEntryForShift`);找不到 = null。 */
  @Field(() => ID, { nullable: true })
  suggestedEntryId!: string | null;

  /** 這個人今天在這家店的排班(可以改選)。 */
  @Field(() => [LotteryStoreEntryOptionModel])
  entries!: LotteryStoreEntryOptionModel[];
}

@ObjectType()
export class LotteryStoreOpenShiftFormPayload {
  @Field(() => LotteryStoreOpenShiftFormModel)
  item!: LotteryStoreOpenShiftFormModel;
}

@ObjectType()
export class LotteryStoreShiftPayload {
  @Field(() => LotteryStoreShiftModel)
  item!: LotteryStoreShiftModel;

  /**
   * 這次寫的現金流水(投庫、出庫、開班領零用金):58mm 投庫單 / 出庫單的 QR 連到即時現金帳那一筆;
   * 沒寫流水(開班沒領零用金、其他動作)= null
   */
  @Field(() => ID, { nullable: true })
  movementId?: string | null;

  /** 這個收銀點的印表機(投庫單 / 出庫單列印的預設;null = 分店預設) */
  @Field(() => ID, { nullable: true })
  cashPointPrinterId?: string | null;
}

/** 開班視窗 [打卡] 的結果。 */
@ObjectType()
export class LotteryStorePunchPayload {
  @Field(() => ID, { nullable: true })
  entryId!: string | null;

  @Field(() => GraphQLISODateTime)
  at!: Date;
}

/** 班次資訊(規格 6.6、14.9;ST-42a)。 */
@ObjectType("LotteryShiftInfo")
export class LotteryShiftInfoModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => LotteryAccountsRefModel)
  openedBy!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  @Field(() => Int)
  openingFloat!: number;

  /** `vault` 從小金庫領 / `none` 第一班沒領 / `handover` 上一班留給下一班。 */
  @Field(() => String)
  openingFloatSource!: string;

  /** 對應的排班;臨時代班 = null。 */
  @Field(() => LotteryStoreEntryOptionModel, { nullable: true })
  entry!: LotteryStoreEntryOptionModel | null;

  /** 任務快照(開班 / 改對應排班時寫入)。 */
  @Field(() => LotteryStoreEntryTaskModel, { nullable: true })
  taskSnapshot!: LotteryStoreEntryTaskModel | null;

  /** 開班時記下的崗位不一致。 */
  @Field(() => Boolean)
  positionMismatch!: boolean;

  /** 已送出交班結帳(對應排班固定)。 */
  @Field(() => Boolean)
  closed!: boolean;

  /** 操作者可以改對應排班(負責人或店長、還沒交班)。 */
  @Field(() => Boolean)
  canReassign!: boolean;

  /** 改對應排班可以選的排班(負責人開班那天在這家店的排班);不能改時為空。 */
  @Field(() => [LotteryStoreEntryOptionModel])
  entryOptions!: LotteryStoreEntryOptionModel[];
}

@ObjectType()
export class LotteryShiftInfoPayload {
  @Field(() => LotteryShiftInfoModel)
  item!: LotteryShiftInfoModel;
}

/**
 * 58mm 單據 QR code 連到的頁面路由(依模組樹,不依讀者權限;`ReceiptLinksService`)。
 * 模組或祖先停用、沒有 route → null。
 */
@ObjectType("LotteryReceiptLinks")
export class LotteryReceiptLinksModel {
  /** 即時現金帳(帳戶管理;投庫單、出庫單、存款單接 `?tab=cash&movementId=`) */
  @Field(() => String, { nullable: true })
  cashLedger!: string | null;

  /** 店面管理檢視頁(交班結帳單、日結單、退貨退款收據接 `/<提交 id>`) */
  @Field(() => String, { nullable: true })
  storeView!: string | null;

  /** 調貨單檢視頁(調貨出貨單、調貨付款收據接 `/<提交 id>`) */
  @Field(() => String, { nullable: true })
  transferView!: string | null;
}
