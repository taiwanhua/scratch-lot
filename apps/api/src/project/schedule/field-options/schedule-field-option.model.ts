import { Field, Int, ObjectType } from "@nestjs/graphql";

/** 欄位管理類別的一個選項(存 value、顯示 label)。 */
@ObjectType("ScheduleFieldOption")
export class ScheduleFieldOptionModel {
  @Field(() => String)
  value!: string;

  @Field(() => String)
  label!: string;
}

@ObjectType("ScheduleFieldOptionsPayload")
export class ScheduleFieldOptionsPayload {
  @Field(() => [ScheduleFieldOptionModel])
  items!: ScheduleFieldOptionModel[];

  @Field(() => Int)
  totalCount!: number;
}
