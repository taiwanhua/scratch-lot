import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 庫存分頁(以本為單位;規格 7.3)。篩選缺席 / null = 不篩(GQL-06)。
 * `orgId` = 分店選擇器(看那個組織與它底下持有任何一張的本);缺席 = 看得到的全部。
 */
@InputType()
export class LotteryInventoryBooksInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  gameId?: string | null;

  /** `unopened` 未拆 / `on_counter` 檯面中 / `sold_out` 售完 / `pending_skip` 有待標註。 */
  @Field(() => String, { nullable: true })
  state?: string | null;

  /** 批購日起(含)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  purchasedFrom?: Date | null;

  /** 批購日迄(不含)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  purchasedTo?: Date | null;

  /** 本號(6 或 7 位,部分比對)。 */
  @Field(() => String, { nullable: true })
  bookNo?: string | null;
}

/** 查刮刮樂:解析後的編號(`parseTicketInput`);沒有遊戲代號時列出本號對到的每一款。 */
@InputType()
export class LotteryTicketLookupInput {
  @Field(() => String, { nullable: true })
  gameCode?: string | null;

  /** 本號 6 或 7 位。 */
  @Field(() => String)
  bookNo!: string;

  /** 張號 3 位。 */
  @Field(() => String)
  ticketNo!: string;
}

/** 一張與呼叫端讀到的版本(條件更新;版本不符 → `CONFLICT`「已被處理」)。 */
@InputType()
export class LotteryTicketVersionInput {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => Int)
  version!: number;
}

/** 更正跳號(`inventory.mark-skipped`):改完的跳號張號,張數要等於待標註張數。 */
@InputType()
export class CorrectLotterySkippedTicketsInput {
  @Field(() => ID)
  bookId!: string;

  @Field(() => [String])
  ticketNos!: string[];

  /** 欄位管理「更正跳號原因」;選「其他」要填說明。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 尋回(`inventory.recover`):待查 / 遺失的張回到 `orgId`(刷到的那家店)的庫存。 */
@InputType()
export class RecoverLotteryTicketsInput {
  @Field(() => [LotteryTicketVersionInput])
  tickets!: LotteryTicketVersionInput[];

  @Field(() => ID)
  orgId!: string;

  /** 欄位管理「尋回原因」;選「其他」要填說明。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 報廢(`inventory.scrap`):只能報未售的張。 */
@InputType()
export class ScrapLotteryTicketsInput {
  @Field(() => [LotteryTicketVersionInput])
  tickets!: LotteryTicketVersionInput[];

  /** 欄位管理「報廢原因」;選「其他」要填說明。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/**
 * 預計要給本數(規格 7.6):庫存管理的矩陣不給篩選;遊戲詳情給 `gameId`、乙類詳情給 `orgId`(對應分店)。
 */
@InputType()
export class LotteryAllocationsInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  gameId?: string | null;
}

/** 修改預計要給本數(`inventory.edit-allocations`;寫 audit_log)。 */
@InputType()
export class SetLotteryAllocationInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => Int)
  plannedBooks!: number;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 庫存概況:遊戲詳情給 `gameId`(列 = 分店)、乙類詳情給 `orgId`(列 = 遊戲)。 */
@InputType()
export class LotteryStockOverviewInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  gameId?: string | null;
}
