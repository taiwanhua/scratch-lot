import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/** 庫存分頁每頁本數(預設)與上限(防呆)。 */
export const INVENTORY_BOOKS_PAGE_SIZE = 50;
export const INVENTORY_BOOKS_MAX_PAGE_SIZE = 100;

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

  /** 顯示狀態(`INVENTORY_BOOK_FILTER_STATES`:未拆 / 檯面中 / 庫存中 / 在途 / 待查 / 遺失 / 已報廢 / 售完)或 `pending_skip` 有待標註。 */
  @Field(() => String, { nullable: true })
  state?: string | null;

  /** 第幾頁(從 1 開始;資料庫分頁)。 */
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  /** 每頁幾本(上限 `INVENTORY_BOOKS_MAX_PAGE_SIZE`)。 */
  @Field(() => Int, { nullable: true, defaultValue: INVENTORY_BOOKS_PAGE_SIZE })
  pageSize?: number;

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

/**
 * 對調跳號(`inventory.mark-skipped`;規格 7.3,使用者 10/26 定案做法 D):這本的一張跳號(記在哪家店都可以)
 * 與一張未售(自己範圍內、未鎖定、不在途)對調,一次一對;兩張都帶版本。
 */
@InputType()
export class SwapLotterySkippedTicketInput {
  @Field(() => ID)
  bookId!: string;

  /** 改回未售的那張(目前是跳號) */
  @Field(() => LotteryTicketVersionInput)
  skipped!: LotteryTicketVersionInput;

  /** 改標跳號的那張(目前是未售) */
  @Field(() => LotteryTicketVersionInput)
  unsold!: LotteryTicketVersionInput;

  /** 欄位管理「更正跳號原因」;選「其他」要填說明。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/**
 * 標跳號(`inventory.mark-skipped`):還有待標註時,把幾張未售的張標成跳號(拆本時沒標的,例:整本待查後只尋回
 * 幾張就上檯面);張數 1 ~ 待標註張數。
 */
@InputType()
export class MarkLotterySkippedTicketsInput {
  @Field(() => ID)
  bookId!: string;

  @Field(() => [LotteryTicketVersionInput])
  tickets!: LotteryTicketVersionInput[];

  /** 欄位管理「更正跳號原因」;選「其他」要填說明。 */
  @Field(() => String)
  reasonKey!: string;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/**
 * 尋回(`inventory.recover`):待查 / 遺失的張回到庫存。給 `orgId` = 刷到實體(回到刷到的那家店,
 * 可跨店);不給 = 從清單選(本的詳情、待查·遺失分頁:不換店,只能尋回自己範圍內的張)。
 */
@InputType()
export class RecoverLotteryTicketsInput {
  @Field(() => [LotteryTicketVersionInput])
  tickets!: LotteryTicketVersionInput[];

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

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
