import { Field, ID, InputType, Int } from "@nestjs/graphql";

/** 收銀點清單(範圍 = 操作者的可見範圍)。篩選欄位缺席 / null = 不篩(GQL-06)。 */
@InputType()
export class LotteryCashPointsInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  pageSize?: number;

  /** 只列這家分店的(須在可見範圍內,否則空清單)。 */
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean | null;

  /** 關鍵字:比對名稱(部分比對,不分大小寫)。 */
  @Field(() => String, { nullable: true })
  keyword?: string | null;
}

/**
 * 新增收銀點(`master-data.cash-points.create`)。`order` 缺席 = 0;`printerId` / `note` 缺席或 null = 不設定。
 * 新增一律是啟用。
 */
@InputType()
export class CreateLotteryCashPointInput {
  /** 分店(可見範圍內);建立後不能改。 */
  @Field(() => ID)
  orgId!: string;

  /** 欄位管理「崗位」的選項值(必填;同分店不重複)。 */
  @Field(() => String)
  positionKey!: string;

  /** 名稱(必填;同分店不重複)。 */
  @Field(() => String)
  name!: string;

  @Field(() => Int, { nullable: true })
  order?: number | null;

  @Field(() => ID, { nullable: true })
  printerId?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/**
 * 編輯收銀點(`master-data.cash-points.edit`)。**缺席 = 不動**;`positionKey` / `name` / `order` /
 * `enabled` 送 null 視同缺席;`printerId` / `note` 送 null = 清空(印表機改回「用分店預設」)。
 * 分店不能改。停用時有登記的守門回 true → `VALIDATION_FAILED`(`reason = CASH_POINT_IN_USE`)。
 */
@InputType()
export class UpdateLotteryCashPointInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  positionKey?: string | null;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => Int, { nullable: true })
  order?: number | null;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean | null;

  @Field(() => ID, { nullable: true })
  printerId?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
