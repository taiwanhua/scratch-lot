import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/** 清單分頁預設值(同示範模組;上限是防呆)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 遊戲清單(範圍 = 操作者所在租戶的全部遊戲)。篩選欄位缺席 / null = 不篩(GQL-06)。
 */
@InputType()
export class LotteryGamesInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: DEFAULT_PAGE_SIZE })
  pageSize?: number;

  /** 關鍵字:比對代號與名稱(部分比對,不分大小寫)。 */
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  /** 狀態 `on_sale` / `discontinued`。 */
  @Field(() => String, { nullable: true })
  status?: string | null;

  /** 面額(單張金額)。 */
  @Field(() => Int, { nullable: true })
  unitPrice?: number | null;
}

/**
 * 新增遊戲(`master-data.games.create`)。選填欄位缺席或 null = 不設定;`status` 缺席 = 販售中。
 * 整本金額、上市日、停售日不收,由 api 計算(上市日 / 停售日由兌獎截止日推算)。
 * `claimDeadline` 必填:宣告成 nullable 是為了缺值時回 `VALIDATION_FAILED`(欄位 `claimDeadline`)。
 */
@InputType()
export class CreateLotteryGameInput {
  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  ticketsPerBook!: number;

  @Field(() => Int)
  defaultRate!: number;

  @Field(() => String, { nullable: true })
  color?: string | null;

  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  claimDeadline?: Date | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/**
 * 編輯遊戲(`master-data.games.edit`)。**缺席 = 不動**;必填欄位(含 `claimDeadline`)不可送 null
 * (送了視同缺席);`color` / `note` 送 null = 清空。改了兌獎截止日,api 重算上市日與停售日(兩者不收)。
 * 有庫存後 `gameCode` / `unitPrice` / `ticketsPerBook`
 * 只能送原值(改了 → `VALIDATION_FAILED`,`reason = GAME_IN_USE`)。
 */
@InputType()
export class UpdateLotteryGameInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  gameCode?: string | null;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => Int, { nullable: true })
  unitPrice?: number | null;

  @Field(() => Int, { nullable: true })
  ticketsPerBook?: number | null;

  @Field(() => Int, { nullable: true })
  defaultRate?: number | null;

  @Field(() => String, { nullable: true })
  color?: string | null;

  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  claimDeadline?: Date | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 刪除遊戲(`master-data.games.delete`;軟刪除,只有從未被引用的遊戲可以刪)。 */
@InputType()
export class DeleteLotteryGameInput {
  @Field(() => ID)
  id!: string;
}
