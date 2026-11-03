import { Field, ID, InputType, Int } from "@nestjs/graphql";

/** 刷到的碼(條碼槍 / 相機 / 輸入;背面編號、正面編號、正面條碼)。 */
@InputType()
export class LotteryStoreScanInput {
  @Field(() => ID)
  orgId!: string;

  /** 這台裝置的本機收銀點;沒設定 = 不給。 */
  @Field(() => ID, { nullable: true })
  localCashPointId?: string | null;

  @Field(() => String)
  code!: string;
}

/** 一張與讀到的版本(條件更新)。 */
@InputType()
export class LotteryStoreTicketRefInput {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => Int)
  version!: number;
}

/**
 * 當下撤銷(規格 6.3):`ticketId` = 帶著這筆售出的張(售出提示、[最近售出]、卡片 [撤銷售出])。
 * 刷退的票(張數店規格 7.3 第 1 點)另給 `orgId` + `localCashPointId`:這張不是確定張號的已售 → 先和這台最近一筆
 * 依張數售出帶著的其中一張對號,再撤這一張。
 */
@InputType()
export class UndoLotteryTicketSaleInput {
  @Field(() => ID)
  ticketId!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  localCashPointId?: string | null;
}

/** 依張數標記售出的一列:遊戲 × 張數(張數店規格 7.2、13.1)。 */
@InputType()
export class LotteryCountSaleLineInput {
  @Field(() => ID)
  gameId!: string;

  @Field(() => Int)
  count!: number;
}

/**
 * 依張數標記售出(張數店規格 7.2):本機收銀點、好幾列「遊戲 × 張數」、原因(欄位管理「依張數售出原因」)。
 * 一次送出、同一個交易;每個遊戲各一個 `refId`。
 */
@InputType()
export class SellLotteryTicketsByCountInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  localCashPointId!: string;

  @Field(() => [LotteryCountSaleLineInput])
  lines!: LotteryCountSaleLineInput[];

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 撤一筆依張數賣出的其中 N 張(張數店規格 7.3 第 2 點、14.2 `undoLotteryCountSale`)。 */
@InputType()
export class UndoLotteryCountSaleInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  refId!: string;

  @Field(() => Int)
  count!: number;
}

/**
 * 售出(規格 6.3):`source = scan`(刷條碼、快速銷售、移櫃並售出)或 `manual`(手動標記,原因必選)。
 * 刮刮樂在別的收銀點檯面、那一班不是自己的 → 要 `confirmMove`(移櫃並售出,要 `store.move`)。
 */
@InputType()
export class SellLotteryTicketsInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  localCashPointId!: string;

  @Field(() => [LotteryStoreTicketRefInput])
  tickets!: LotteryStoreTicketRefInput[];

  @Field(() => String)
  source!: string;

  @Field(() => Boolean, { nullable: true })
  confirmMove?: boolean | null;

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 拆本的一筆分配。 */
@InputType()
export class LotterySplitAssignmentInput {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => [String])
  ticketNos!: string[];
}

/** 拆本(規格 6.4):① 標的跳號、② 每個收銀點放哪些張。 */
@InputType()
export class SplitLotteryBookInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  bookId!: string;

  @Field(() => [String])
  skippedTicketNos!: string[];

  @Field(() => [LotterySplitAssignmentInput])
  assignments!: LotterySplitAssignmentInput[];
}

/** 移櫃(收銀點之間;規格 6.4)。 */
@InputType()
export class MoveLotteryTicketsInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => [LotteryStoreTicketRefInput])
  tickets!: LotteryStoreTicketRefInput[];

  @Field(() => ID)
  toCashPointId!: string;
}

/** 收回(檯面 → 庫存;規格 6.4)。 */
@InputType()
export class RecallLotteryTicketsInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => [LotteryStoreTicketRefInput])
  tickets!: LotteryStoreTicketRefInput[];
}
