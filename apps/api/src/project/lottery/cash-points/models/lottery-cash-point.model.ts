import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 名稱參照(分店、印表機)。 */
@ObjectType("LotteryCashPointRef")
export class LotteryCashPointRefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

@ObjectType("LotteryCashPointAbilities")
export class LotteryCashPointAbilitiesModel {
  /** `master-data.cash-points.edit`(收銀點不能刪除,所以沒有 canDelete)。 */
  @Field(() => Boolean)
  canEdit!: boolean;
}

/**
 * 收銀點(欄位語意正本 `docs/modules/project/master-data.md`「api 介面」)。
 * `positionLabel`:崗位選項的顯示名;選項已不在(被刪)時為 null,畫面顯示 `positionKey`。
 * `printer`:null = 用分店預設;讀不到那台印表機時也是 null。
 */
@ObjectType("LotteryCashPoint")
export class LotteryCashPointModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryCashPointRefModel)
  org!: LotteryCashPointRefModel;

  @Field(() => String)
  positionKey!: string;

  @Field(() => String, { nullable: true })
  positionLabel!: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  order!: number;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => LotteryCashPointRefModel, { nullable: true })
  printer!: LotteryCashPointRefModel | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => LotteryCashPointAbilitiesModel)
  abilities!: LotteryCashPointAbilitiesModel;
}

@ObjectType()
export class LotteryCashPointPayload {
  @Field(() => LotteryCashPointModel)
  item!: LotteryCashPointModel;
}

@ObjectType()
export class LotteryCashPointsPayload {
  @Field(() => [LotteryCashPointModel])
  items!: LotteryCashPointModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 崗位選單的一個選項(欄位管理「崗位」裡這家分店看得到的啟用選項)。 */
@ObjectType("LotteryPositionOption")
export class LotteryPositionOptionModel {
  @Field(() => String)
  value!: string;

  @Field(() => String)
  label!: string;
}

@ObjectType()
export class LotteryPositionOptionsPayload {
  @Field(() => [LotteryPositionOptionModel])
  items!: LotteryPositionOptionModel[];

  @Field(() => Int)
  totalCount!: number;
}
