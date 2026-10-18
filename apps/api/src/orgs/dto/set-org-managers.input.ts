import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 設定組織的主管(`org_manager`):**整組取代** —— 送出的名單就是之後的全部主管,
 * 不在名單裡的既有主管會被移除;給空陣列 = 清空。
 * 主管必須是**本租戶**的使用者(所屬組織在該組織的租戶底下);根組織不能設主管。
 */
@InputType()
export class SetOrgManagersInput {
  /** 要設主管的組織;不在操作者管理範圍內即 `NOT_FOUND`。 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => [ID])
  userIds!: string[];
}
