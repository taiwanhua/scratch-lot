import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 這位操作者對這一筆能做什麼(api 依權限與「有沒有庫存」算好,前端只讀)。 */
@ObjectType("LotteryGameAbilities")
export class LotteryGameAbilitiesModel {
  /** `master-data.games.edit`。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** `master-data.games.delete` 且從未被引用(`inUse = false`)。 */
  @Field(() => Boolean)
  canDelete!: boolean;
}

/**
 * 遊戲(欄位語意正本 `docs/modules/project/master-data.md`「api 介面」)。
 * `inUse` = 有任何引用檢查回 true(有庫存):代號、面額、張數唯讀、不能刪除。
 */
@ObjectType("LotteryGame")
export class LotteryGameModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  unitPrice!: number;

  @Field(() => Int)
  ticketsPerBook!: number;

  @Field(() => Int)
  bookPrice!: number;

  @Field(() => Int)
  defaultRate!: number;

  @Field(() => String, { nullable: true })
  color!: string | null;

  /** `on_sale` / `discontinued`。 */
  @Field(() => String)
  status!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  launchedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  discontinuedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  claimDeadline!: Date | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => Boolean)
  inUse!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => LotteryGameAbilitiesModel)
  abilities!: LotteryGameAbilitiesModel;
}

@ObjectType()
export class LotteryGamePayload {
  @Field(() => LotteryGameModel)
  item!: LotteryGameModel;
}

@ObjectType()
export class LotteryGamesPayload {
  @Field(() => [LotteryGameModel])
  items!: LotteryGameModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class DeleteLotteryGamePayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => ID)
  deletedId!: string;
}
