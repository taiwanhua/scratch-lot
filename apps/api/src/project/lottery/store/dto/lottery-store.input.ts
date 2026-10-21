import { Field, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 開班(規格 6.6、14.9):對應排班必選 —— 選一筆排班(`scheduleEntryId`)或「沒有排班(臨時代班)」
 * (`temporaryCover = true`、`scheduleEntryId` 留空);兩者都沒有 → `VALIDATION_FAILED`。
 * `floatFromVault` = 第一班「從小金庫領零用金」(選填;要 `store.withdraw`)。
 */
@InputType()
export class OpenLotteryShiftInput {
  @Field(() => ID)
  cashPointId!: string;

  @Field(() => ID, { nullable: true })
  scheduleEntryId?: string | null;

  @Field(() => Boolean)
  temporaryCover!: boolean;

  @Field(() => Int, { nullable: true })
  floatFromVault?: number | null;
}

/** 改對應排班(規格 6.6、14.9):原因必填(欄位管理「改對應排班原因」,選「其他」說明必填)。 */
@InputType()
export class ReassignLotteryShiftEntryInput {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => ID, { nullable: true })
  scheduleEntryId?: string | null;

  @Field(() => Boolean)
  temporaryCover!: boolean;

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 投庫(抽屜 → 小金庫;規格 6.7):金額正整數、不能超過抽屜目前的應有。 */
@InputType()
export class DepositLotteryShiftCashInput {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 出庫(小金庫 → 抽屜;規格 6.7):原因必填(欄位管理「出庫原因」)。 */
@InputType()
export class WithdrawLotteryShiftCashInput {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
