import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 名稱參照(分店、收銀點、經銷商、使用者)。 */
@ObjectType("LotteryInventoryRef")
export class LotteryInventoryRefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/** 一家分店持有這本的張數(不算跳號)。 */
@ObjectType("LotteryInventoryHolding")
export class LotteryInventoryHoldingModel {
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  @Field(() => Int)
  count!: number;
}

/**
 * 庫存分頁的一本(以本為單位;規格 7.3)。待標註、剩餘、持有、狀態都即時計算。
 * `state`:`unopened` 未拆 / `on_counter` 檯面中 / `sold_out` 售完。
 */
@ObjectType("LotteryInventoryBook")
export class LotteryInventoryBookModel {
  @Field(() => ID)
  id!: string;

  /** 本編號 `5164-0056527`。 */
  @Field(() => String)
  bookKey!: string;

  /** 本號 7 位。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 面額(單張金額)。 */
  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  standardTickets!: number;

  @Field(() => String)
  firstTicketNo!: string;

  @Field(() => String)
  lastTicketNo!: string;

  /** 所在分店。 */
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  /** 各分店持有張數(拆開的本顯示「台北 70 / 新竹 30」)。 */
  @Field(() => [LotteryInventoryHoldingModel])
  holdings!: LotteryInventoryHoldingModel[];

  /** 剩餘(未售)張數。 */
  @Field(() => Int)
  remainingCount!: number;

  /** 總張數(不算跳號)。 */
  @Field(() => Int)
  totalCount!: number;

  /** 待標註張數(還沒標的跳號)。 */
  @Field(() => Int)
  pendingSkipCount!: number;

  /** 更正跳號時改完要等於的張數 = 迄號 − 標準張數。 */
  @Field(() => Int)
  requiredSkipCount!: number;

  @Field(() => [String])
  skippedTicketNos!: string[];

  @Field(() => String)
  state!: string;

  /** `normal` / `revoked`(進貨單作廢)。 */
  @Field(() => String)
  status!: string;

  /** 批購日。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  purchasedAt!: Date | null;

  /** 進貨甲類(名稱 = 「姓名 #證號」)。 */
  @Field(() => LotteryInventoryRefModel, { nullable: true })
  purchaseDealer!: LotteryInventoryRefModel | null;
}

@ObjectType("LotteryInventoryBooksPayload")
export class LotteryInventoryBooksPayload {
  @Field(() => [LotteryInventoryBookModel])
  items!: LotteryInventoryBookModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 本的詳情頁的一張(格子與選張用;`version` 給尋回 / 報廢的條件更新)。 */
@ObjectType("LotteryInventoryTicket")
export class LotteryInventoryTicketModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  ticketNo!: string;

  /** `unsold` / `sold` / `skipped` / `scrapped` / `investigating` / `lost`。 */
  @Field(() => String)
  status!: string;

  /** `stock` / `counter` / `in_transit`。 */
  @Field(() => String)
  locationKind!: string;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  cashPoint!: LotteryInventoryRefModel | null;

  /** 目前所在分店。 */
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  /** 責任分店(待查或遺失時)。 */
  @Field(() => LotteryInventoryRefModel, { nullable: true })
  responsibleOrg!: LotteryInventoryRefModel | null;

  /** 被單據鎖定(調貨中 / 撤銷審核中)。 */
  @Field(() => Boolean)
  locked!: boolean;

  @Field(() => Int)
  version!: number;
}

/** 張在哪裡:分店 + 位置 + 收銀點。 */
@ObjectType("LotteryInventoryPlace")
export class LotteryInventoryPlaceModel {
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  @Field(() => String)
  locationKind!: string;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  cashPoint!: LotteryInventoryRefModel | null;
}

/** 「所在」卡:未售的張依地方分組(例:中山店 · 店內櫃台 #066–100)。 */
@ObjectType("LotteryInventoryLocation")
export class LotteryInventoryLocationModel {
  @Field(() => LotteryInventoryPlaceModel)
  place!: LotteryInventoryPlaceModel;

  @Field(() => [String])
  ticketNos!: string[];
}

/**
 * 事件時間軸的一列:同一時間、同一類型、同一人 / 單據、同一個從 → 到的張合成一列(例:移櫃 #041–065)。
 * 單據顯示 `refSerialNo`(找不到單號時只有 `refType`)。
 */
@ObjectType("LotteryInventoryEvent")
export class LotteryInventoryEventModel {
  @Field(() => GraphQLISODateTime)
  at!: Date;

  /** 張數事件類型(`@repo/domain/project/lottery` 的 `TICKET_EVENT_TYPES`)。 */
  @Field(() => String)
  type!: string;

  @Field(() => [String])
  ticketNos!: string[];

  /** 這一列是不是整本(所有張都在)。 */
  @Field(() => Boolean)
  wholeBook!: boolean;

  @Field(() => LotteryInventoryPlaceModel, { nullable: true })
  from!: LotteryInventoryPlaceModel | null;

  @Field(() => LotteryInventoryPlaceModel)
  to!: LotteryInventoryPlaceModel;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  by!: LotteryInventoryRefModel | null;

  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => ID, { nullable: true })
  refId!: string | null;

  @Field(() => String, { nullable: true })
  refSerialNo!: string | null;

  @Field(() => String, { nullable: true })
  reasonKey!: string | null;

  @Field(() => String, { nullable: true })
  reasonNote!: string | null;
}

/** 來源:進貨單 / 調貨單(調入)。 */
@ObjectType("LotteryInventorySource")
export class LotteryInventorySourceModel {
  /** `purchase` 進貨 / `transfer_in` 調入(張數事件類型)。 */
  @Field(() => String)
  type!: string;

  @Field(() => ID, { nullable: true })
  refId!: string | null;

  @Field(() => String, { nullable: true })
  refSerialNo!: string | null;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => [String])
  ticketNos!: string[];
}

/** 成本(要 `inventory.show-cost`)。 */
@ObjectType("LotteryInventoryCost")
export class LotteryInventoryCostModel {
  /** 批購金額率(整數 %)。 */
  @Field(() => Int)
  rate!: number;

  @Field(() => Int)
  cost!: number;

  /** 單張成本(成本 ÷ 標準張數;顯示時四捨五入)。 */
  @Field(() => Float)
  unitCost!: number;
}

/** 整本都待查 / 遺失時的狀態列(最近一筆待查 / 遺失事件)。 */
@ObjectType("LotteryInventoryInvestigation")
export class LotteryInventoryInvestigationModel {
  /** `investigating` / `lost`。 */
  @Field(() => String)
  status!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  at!: Date | null;

  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => String, { nullable: true })
  refSerialNo!: string | null;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  responsibleOrg!: LotteryInventoryRefModel | null;
}

/** 本的詳情頁上的按鈕(api 依權限算好,元件只讀)。 */
@ObjectType("LotteryInventoryBookAbilities")
export class LotteryInventoryBookAbilitiesModel {
  /** `inventory.mark-skipped` 且這本有跳號。 */
  @Field(() => Boolean)
  canCorrectSkips!: boolean;

  @Field(() => Boolean)
  canRecover!: boolean;

  @Field(() => Boolean)
  canScrap!: boolean;

  @Field(() => Boolean)
  canShowCost!: boolean;
}

/** 本的詳情(`inventory.book-page`;規格 7.3)。 */
@ObjectType("LotteryInventoryBookDetail")
export class LotteryInventoryBookDetailModel {
  @Field(() => LotteryInventoryBookModel)
  book!: LotteryInventoryBookModel;

  @Field(() => [LotteryInventoryTicketModel])
  tickets!: LotteryInventoryTicketModel[];

  @Field(() => [LotteryInventoryLocationModel])
  locations!: LotteryInventoryLocationModel[];

  @Field(() => [LotteryInventoryEventModel])
  events!: LotteryInventoryEventModel[];

  @Field(() => [LotteryInventorySourceModel])
  sources!: LotteryInventorySourceModel[];

  /** 沒有 `inventory.show-cost` → null。 */
  @Field(() => LotteryInventoryCostModel, { nullable: true })
  cost!: LotteryInventoryCostModel | null;

  /** 整本(可用的張)都待查或遺失 → 狀態列;否則 null。 */
  @Field(() => LotteryInventoryInvestigationModel, { nullable: true })
  investigation!: LotteryInventoryInvestigationModel | null;

  @Field(() => LotteryInventoryBookAbilitiesModel)
  abilities!: LotteryInventoryBookAbilitiesModel;
}

@ObjectType("LotteryInventoryBookPayload")
export class LotteryInventoryBookPayload {
  @Field(() => LotteryInventoryBookDetailModel)
  item!: LotteryInventoryBookDetailModel;
}

/** 查刮刮樂的一個結果(同一個本號對到多款遊戲時有多筆)。 */
@ObjectType("LotteryTicketLookupItem")
export class LotteryTicketLookupItemModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => ID)
  ticketId!: string;

  @Field(() => String)
  ticketNo!: string;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  responsibleOrg!: LotteryInventoryRefModel | null;
}

@ObjectType("LotteryTicketLookupPayload")
export class LotteryTicketLookupPayload {
  @Field(() => [LotteryTicketLookupItemModel])
  items!: LotteryTicketLookupItemModel[];
}

/** 待查·遺失分頁的一列:一本 × 一種狀態(待查 / 遺失)。 */
@ObjectType("LotteryInvestigationRow")
export class LotteryInvestigationRowModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** `investigating` / `lost`。 */
  @Field(() => String)
  status!: string;

  @Field(() => LotteryInventoryRefModel, { nullable: true })
  responsibleOrg!: LotteryInventoryRefModel | null;

  /** 最近一筆待查 / 遺失事件的單據。 */
  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => String, { nullable: true })
  refSerialNo!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  at!: Date | null;

  /** 這幾張的單張成本加總(四捨五入到元);沒有 `inventory.show-cost` → null。 */
  @Field(() => Int, { nullable: true })
  cost!: number | null;

  @Field(() => [LotteryInventoryTicketModel])
  tickets!: LotteryInventoryTicketModel[];
}

@ObjectType("LotteryInvestigationsPayload")
export class LotteryInvestigationsPayload {
  @Field(() => [LotteryInvestigationRowModel])
  items!: LotteryInvestigationRowModel[];

  @Field(() => Boolean)
  canRecover!: boolean;
}

/** 遊戲(矩陣的欄、庫存概況的列)。 */
@ObjectType("LotteryInventoryGame")
export class LotteryInventoryGameModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;
}

/** 預計要給本數的一格(分店 × 遊戲):已給 = 整本 N 本 + 零碎 N 張。 */
@ObjectType("LotteryAllocationCell")
export class LotteryAllocationCellModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  gameId!: string;

  /** 沒有設定 → null。 */
  @Field(() => Int, { nullable: true })
  plannedBooks!: number | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => Int)
  givenBooks!: number;

  @Field(() => Int)
  givenExtraTickets!: number;
}

/** 預計要給本數(規格 7.6):庫存管理的矩陣、遊戲詳情、乙類詳情共用。 */
@ObjectType("LotteryAllocationsPayload")
export class LotteryAllocationsPayload {
  @Field(() => [LotteryInventoryRefModel])
  stores!: LotteryInventoryRefModel[];

  @Field(() => [LotteryInventoryGameModel])
  games!: LotteryInventoryGameModel[];

  @Field(() => [LotteryAllocationCellModel])
  cells!: LotteryAllocationCellModel[];

  /** `inventory.edit-allocations`;false = 唯讀。 */
  @Field(() => Boolean)
  canEdit!: boolean;
}

@ObjectType("LotteryAllocationPayload")
export class LotteryAllocationPayload {
  @Field(() => LotteryAllocationCellModel)
  item!: LotteryAllocationCellModel;
}

/** 庫存概況的一列(分店 × 遊戲):未拆(本)、檯面(張)、已售(張)。 */
@ObjectType("LotteryStockOverviewRow")
export class LotteryStockOverviewRowModel {
  @Field(() => LotteryInventoryRefModel)
  org!: LotteryInventoryRefModel;

  @Field(() => LotteryInventoryGameModel)
  game!: LotteryInventoryGameModel;

  @Field(() => Int)
  unopenedBooks!: number;

  @Field(() => Int)
  counterTickets!: number;

  @Field(() => Int)
  soldTickets!: number;
}

@ObjectType("LotteryStockOverviewPayload")
export class LotteryStockOverviewPayload {
  @Field(() => [LotteryStockOverviewRowModel])
  items!: LotteryStockOverviewRowModel[];
}

/** 更正跳號 / 尋回 / 報廢的結果。 */
@ObjectType("LotteryInventoryActionPayload")
export class LotteryInventoryActionPayload {
  /** 處理的張數。 */
  @Field(() => Int)
  count!: number;

  /** 報廢的損失(批購成本,四捨五入到元);沒有 `inventory.show-cost` 或不是報廢 → null。 */
  @Field(() => Int, { nullable: true })
  lossCost!: number | null;
}
