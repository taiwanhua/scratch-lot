import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../../data-scope/json-object.scalar";

/**
 * 某個組織的規則頁(`orgId` 缺席或 null = 當前組織)。
 */
@InputType()
export class ScheduleRulesInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}

/**
 * 自訂一條規則(本層寫一列;已自訂就改那一列)。
 *
 * **缺席的欄位沿用目前的生效值**(GQL-06):從沿用改成自訂時,沒送的欄位照抄上層 / 程式預設;
 * 已經自訂的,沒送的欄位維持本層原值。`level` 只給有等級的規則(沒有等級的送了 → `VALIDATION_FAILED`)。
 *
 * 自動排班條件:自訂其中一條 = **整組**變成本層自訂(其他條件照抄目前的生效值)。
 */
@InputType()
export class CustomizeScheduleRuleInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  key!: string;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean;

  @Field(() => GraphQLJSONObject, { nullable: true })
  value?: Record<string, unknown>;

  @Field(() => String, { nullable: true })
  level?: string;

  @Field(() => Int, { nullable: true })
  order?: number;
}

/** 自動排班條件的一條:勾選與否;順序 = 陣列順序。 */
@InputType()
export class ScheduleAutoRunConditionInput {
  @Field(() => String)
  key!: string;

  @Field(() => Boolean)
  enabled!: boolean;
}

/** 自訂整組自動排班條件(勾選、拖拉排序);必須列出全部條件、各一次。 */
@InputType()
export class CustomizeScheduleAutoRunInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => [ScheduleAutoRunConditionInput])
  conditions!: ScheduleAutoRunConditionInput[];
}

/** [還原]:刪掉本層的自訂,回到沿用。自動排班條件的任一 key = 整組還原。 */
@InputType()
export class RestoreScheduleRuleInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  key!: string;
}
