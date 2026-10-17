import { Field, Int, ObjectType } from "@nestjs/graphql";

/** 側欄一個模組的計數(底座規格 10.4)。 */
@ObjectType()
export class SidebarBadge {
  @Field({ description: "模組 key(側欄以它對上模組節點)" })
  moduleKey!: string;

  @Field(() => Int, {
    description: "數字;0 也回傳,前端只在大於 0 時顯示",
  })
  count!: number;
}
