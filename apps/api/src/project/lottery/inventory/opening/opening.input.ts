import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { LotteryTicketVersionInput } from "../dto/lottery-inventory.input";

/** 期初建檔一本的 ③ 分放:這些張號放到哪個收銀點的檯面;`cashPointId` 缺席 / null = 庫存。 */
@InputType()
export class LotteryOpeningPlacementInput {
  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  @Field(() => [String])
  ticketNos!: string[];
}

/** 期初建檔一本(期初建檔規格 3.1;一本一個交易)。張號一律三位字串。 */
@InputType()
export class CreateLotteryOpeningBookInput {
  /** 分店。 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  gameId!: string;

  /** 本號 6 或 7 位。 */
  @Field(() => String)
  bookNo!: string;

  /** 迄號(≥ 標準張數、≤ 999)。 */
  @Field(() => Int)
  lastTicketNo!: number;

  /** 批購金額率(整數 %;預設遊戲的值,可改)。 */
  @Field(() => Int)
  rate!: number;

  /** ① 導入前已賣出。 */
  @Field(() => [String])
  soldTicketNos!: string[];

  /** ② 跳號。 */
  @Field(() => [String])
  skippedTicketNos!: string[];

  /** ③ 手上的張放在哪。 */
  @Field(() => [LotteryOpeningPlacementInput])
  placements!: LotteryOpeningPlacementInput[];
}

/** 期初建檔頁刷到一張(只讀;帶出這本是哪款遊戲、能不能建)。 */
@InputType()
export class LotteryOpeningScanInput {
  @Field(() => ID)
  orgId!: string;

  /** 刷到或手輸的碼(背面編號、正面編號、條碼)。 */
  @Field(() => String)
  code!: string;
}

/** 重新開放期初建檔(原因必填,E1)。 */
@InputType()
export class ReopenLotteryStoreOpeningInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  reason!: string;
}

/** 期初更正的方向:期初已售 → 未售 / 未售 → 期初已售(E2:後者只在期初建檔進行中)。 */
export const OPENING_FIX_DIRECTIONS = ["unsold", "opening_sold"] as const;
export type OpeningFixDirection = (typeof OPENING_FIX_DIRECTIONS)[number];

/** 期初更正(期初建檔規格 4.1;`inventory.opening`)。選到的張要在同一家店、同一個方向。 */
@InputType()
export class FixLotteryOpeningTicketsInput {
  @Field(() => [LotteryTicketVersionInput])
  tickets!: LotteryTicketVersionInput[];

  /** `unsold` 改回未售 / `opening_sold` 改成導入前已賣出。 */
  @Field(() => String)
  to!: string;

  /** 改回未售放哪個收銀點的檯面;缺席 / null = 庫存。改成導入前已賣出時不看。 */
  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  /** 原因(欄位管理「期初更正原因」;選「其他」要填說明)。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}
