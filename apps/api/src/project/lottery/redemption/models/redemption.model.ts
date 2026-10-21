import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 兌獎紀錄所屬的那一班(「王小明 08:02(已交班)」)。 */
@ObjectType("LotteryRedemptionShift")
export class LotteryRedemptionShiftModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryAccountsRefModel)
  openedBy!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 已送出交班結帳。 */
  @Field(() => Boolean)
  closed!: boolean;
}

/** 勾進的進貨單(已送兌)。 */
@ObjectType("LotteryRedemptionPurchase")
export class LotteryRedemptionPurchaseModel {
  @Field(() => ID)
  id!: string;

  /** 單號(例 `P-0034`);還沒有 = null。 */
  @Field(() => String, { nullable: true })
  serialNo!: string | null;
}

/** 一筆兌獎紀錄(兌獎紀錄分頁、[最近兌獎]、兌獎紀錄詳情)。 */
@ObjectType("LotteryRedemption")
export class LotteryRedemptionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  gameCode!: string;

  /** 遊戲名稱(本租戶找不到這個代號 = null)。 */
  @Field(() => String, { nullable: true })
  gameName!: string | null;

  /** 本號 7 位。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  ticketNo!: string;

  /** 顯示用張編號 `5164-056527-031`。 */
  @Field(() => String)
  ticketLabel!: string;

  /** 是本店的刮刮樂(`ticketId` 有值)。 */
  @Field(() => Boolean)
  isOwnStore!: boolean;

  @Field(() => Int)
  prizeAmount!: number;

  /** `in_store` 店內持有 / `sent` 已送兌 / `revoked` 已撤銷 */
  @Field(() => String)
  status!: string;

  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => LotteryRedemptionShiftModel)
  shift!: LotteryRedemptionShiftModel;

  @Field(() => GraphQLISODateTime)
  redeemedAt!: Date;

  @Field(() => LotteryAccountsRefModel)
  redeemedBy!: LotteryAccountsRefModel;

  @Field(() => LotteryRedemptionPurchaseModel, { nullable: true })
  purchase!: LotteryRedemptionPurchaseModel | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  sentAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  revokedAt!: Date | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  revokedBy!: LotteryAccountsRefModel | null;

  /** 撤銷原因的名稱(自己當下撤銷 = null,畫面顯示「當下撤銷」)。 */
  @Field(() => String, { nullable: true })
  revokeReason!: string | null;

  @Field(() => String, { nullable: true })
  revokeReasonKey!: string | null;

  @Field(() => String, { nullable: true })
  revokeNote!: string | null;

  /** [撤銷並重新登記] 的新紀錄指向的原紀錄。 */
  @Field(() => ID, { nullable: true })
  replacesId!: string | null;

  /** 交班後才登記(事後更正)。 */
  @Field(() => Boolean)
  isPostClose!: boolean;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 操作者能用哪一層撤銷:`self` / `manager`;沒有權限或已撤銷 = null(按鈕不顯示)。 */
  @Field(() => String, { nullable: true })
  revokeMode!: string | null;

  /** 已送兌:撤銷按鈕停用、提示先撤回或退回進貨單。 */
  @Field(() => Boolean)
  revokeBlockedBySent!: boolean;
}

@ObjectType()
export class LotteryRedemptionPayload {
  @Field(() => LotteryRedemptionModel)
  item!: LotteryRedemptionModel;
}

/** [撤銷並重新登記] 的結果:撤銷的原紀錄 + 新紀錄。 */
@ObjectType()
export class LotteryRedemptionReplacePayload {
  @Field(() => LotteryRedemptionModel)
  revoked!: LotteryRedemptionModel;

  @Field(() => LotteryRedemptionModel)
  item!: LotteryRedemptionModel;
}

@ObjectType()
export class LotteryRedemptionsPayload {
  @Field(() => [LotteryRedemptionModel])
  items!: LotteryRedemptionModel[];

  @Field(() => Int)
  total!: number;
}

/** 已兌過的那一筆(兌獎視窗提示「這張已兌過獎(10/13 18:02 店外攤位)」)。 */
@ObjectType("LotteryRedemptionExisting")
export class LotteryRedemptionExistingModel {
  @Field(() => GraphQLISODateTime)
  redeemedAt!: Date;

  @Field(() => String)
  cashPointName!: string;
}

/** 兌獎視窗刷到編號後的預覽(ST-11a)。 */
@ObjectType("LotteryRedemptionPreview")
export class LotteryRedemptionPreviewModel {
  @Field(() => String)
  gameCode!: string;

  @Field(() => String, { nullable: true })
  gameName!: string | null;

  /** 面額(找不到遊戲 = null)。 */
  @Field(() => Int, { nullable: true })
  unitPrice!: number | null;

  @Field(() => String)
  bookNo!: string;

  @Field(() => String)
  ticketNo!: string;

  @Field(() => String)
  ticketLabel!: string;

  @Field(() => Boolean)
  isOwnStore!: boolean;

  @Field(() => LotteryRedemptionExistingModel, { nullable: true })
  existing!: LotteryRedemptionExistingModel | null;
}

@ObjectType()
export class LotteryRedemptionPreviewPayload {
  @Field(() => LotteryRedemptionPreviewModel)
  item!: LotteryRedemptionPreviewModel;
}

/** 進貨單新增頁的兌獎區:進貨分店店內持有(和這張單已勾的)兌獎紀錄(PU-05)。 */
@ObjectType()
export class LotteryPurchaseRedemptionsPayload {
  @Field(() => [LotteryRedemptionModel])
  items!: LotteryRedemptionModel[];
}
