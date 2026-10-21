import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/**
 * 叫貨單新增頁的一列(一個販售中的遊戲;欄位語意正本 `docs/modules/project/purchasing.md`「api 介面」)。
 * 已依規格 8.1 排好序:新遊戲(上市 30 天內)在最上面,其他依近 30 天賣出多到少。
 */
@ObjectType("LotteryRequisitionCandidate")
export class LotteryRequisitionCandidateModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;

  /** 面額(單張金額)。 */
  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  bookPrice!: number;

  /** 預設批購金額率(整數 %)。 */
  @Field(() => Int)
  defaultRate!: number;

  @Field(() => GraphQLISODateTime, { nullable: true })
  launchedAt!: Date | null;

  /** 上市 30 天內(標【新】)。 */
  @Field(() => Boolean)
  isNew!: boolean;

  /** 目前庫存(張):這家店未售的張(未拆的本 + 檯面上的)。 */
  @Field(() => Int)
  stockTickets!: number;

  /** 在途(本):叫貨單待購買 + 進貨單 / 調貨單已建立還沒點收完成。 */
  @Field(() => Int)
  inTransitBooks!: number;

  /** 近 7 天賣出張數;新遊戲還沒賣過 = null(畫面「—」)。 */
  @Field(() => Int, { nullable: true })
  sold7!: number | null;

  /** 近 30 天賣出張數;新遊戲還沒賣過 = null(畫面「—」)。 */
  @Field(() => Int, { nullable: true })
  sold30!: number | null;

  /** 預計要給本數;沒設定 = null。 */
  @Field(() => Int, { nullable: true })
  plannedBooks!: number | null;

  /** 已給本數(整本)。 */
  @Field(() => Int)
  givenBooks!: number;
}

/** 採購清單的一格:某個遊戲在某家分店要叫幾本。 */
@ObjectType("LotteryPurchaseListBranch")
export class LotteryPurchaseListBranchModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => Int)
  books!: number;
}

/** 採購清單依遊戲 × 分店加總的一列(一個遊戲)。 */
@ObjectType("LotteryPurchaseListRow")
export class LotteryPurchaseListRowModel {
  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => [LotteryPurchaseListBranchModel])
  branches!: LotteryPurchaseListBranchModel[];

  @Field(() => Int)
  totalBooks!: number;

  /** 預估批購金額(元)。 */
  @Field(() => Int)
  estimatedAmount!: number;
}

/** 一張待購買的叫貨單。 */
@ObjectType("LotteryPendingRequisition")
export class LotteryPendingRequisitionModel {
  /** 叫貨單(表單提交 id)。 */
  @Field(() => ID)
  requisitionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 叫貨分店。 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  estimatedAmount!: number;

  @Field(() => GraphQLISODateTime)
  completedAt!: Date;
}

/** 採購清單(`purchasing.requisition.purchase-list`)。 */
@ObjectType("LotteryPurchaseList")
export class LotteryPurchaseListModel {
  /** 有出現在清單上的分店(依加總順序;名稱由前端以組織樹換)。 */
  @Field(() => [ID])
  orgIds!: string[];

  @Field(() => [LotteryPurchaseListRowModel])
  rows!: LotteryPurchaseListRowModel[];

  @Field(() => [LotteryPendingRequisitionModel])
  requisitions!: LotteryPendingRequisitionModel[];
}

/** 一張已完成叫貨單的衍生狀態。 */
@ObjectType("LotteryRequisitionStateItem")
export class LotteryRequisitionStateModel {
  @Field(() => ID)
  requisitionId!: string;

  /** `pending` 待購買 / `purchased` 已進貨 / `transferred` 已調貨。 */
  @Field(() => String)
  state!: string;
}
