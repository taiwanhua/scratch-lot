import { Field, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 付款 / 收款視窗的 [確認](規格 9):按鈕權限沿用單據的(登記的 `permission`)。
 *
 * - `button`:`out` 支出(付款 / 退款)、`in` 收入(收到退款 / 收款);先填的金額 ≤ 0 的那一顆不能按
 *   (`SETTLEMENT_NOTHING_DUE`)。`amount` 照實際填的(正整數,可以不等於先填的)
 * - `method = bank`:`accountId` 必填(使用中、使用組織包含這一邊的分店)
 * - `method = cash`:`cashSource` 必填(`vault` 小金庫 / `drawer` 有開著班的收銀點抽屜 + `cashPointId`)、
 *   `handler`(經手人 / 收款人)必填
 */
@InputType()
export class RecordLotterySettlementInput {
  @Field(() => String)
  moduleKey!: string;

  @Field(() => ID)
  refId!: string;

  @Field(() => String)
  side!: string;

  @Field(() => String)
  button!: string;

  @Field(() => String)
  method!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => ID, { nullable: true })
  accountId?: string | null;

  @Field(() => String, { nullable: true })
  cashSource?: string | null;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  @Field(() => String, { nullable: true })
  handler?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 沖正收付的一筆(`method` = 那一筆是銀行交易或現金流水);原因必填。 */
@InputType()
export class ReverseLotterySettlementInput {
  @Field(() => String)
  method!: string;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  reason!: string;
}

/** 銀行 [登記交易] 的單據候選:`type` = `purchase_income` / `transfer_income`。 */
@InputType()
export class LotterySettlementCandidatesInput {
  @Field(() => String)
  type!: string;

  /** 只列歸屬這家分店的(選填)。 */
  @Field(() => ID, { nullable: true })
  branchOrgId?: string | null;
}
