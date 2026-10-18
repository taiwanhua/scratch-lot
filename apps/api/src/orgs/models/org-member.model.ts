import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

/** 成員身上的一個所屬組織(只列操作者**管理範圍**內的,範圍外不露名稱也不露 id)。 */
@ObjectType()
export class OrgMemberOrg {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 「成員」頁籤的一列。
 *
 * api 介面(GQL-07):
 * - 清單範圍 = 這個組織**自己**的成員(`org_user` 直接關聯),**不含下層組織的成員** ——
 *   「加入成員」加的就是一筆直接關聯,列表要跟它對得起來(使用者管理的 `users` 才是子樹)
 * - `otherOrgs`:這位成員**在本組織以外**的所屬組織,只列操作者管理範圍內的。
 *   候選清單(`orgMemberCandidates`)沿用同一個型別 —— 候選本來就不在本組織裡,
 *   所以那裡的 `otherOrgs` 等於他全部的所屬組織,語意仍是「本組織以外的」
 * - `enabled`:使用者自己的停用狀態(與組織的停用無關);停用者照列,只在 UI 標示
 */
@ObjectType()
export class OrgMember {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  account!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => [OrgMemberOrg])
  otherOrgs!: OrgMemberOrg[];
}

/**
 * 成員清單(分頁形狀 GQL-03)。`orgMembers` 與 `orgMemberCandidates` 共用同一個型別 ——
 * 兩邊的列完全同形,差別只在「已在這個組織」還是「還沒在」,再宣告一份只是多一個名字。
 */
@ObjectType()
export class OrgMembersPayload {
  @Field(() => [OrgMember])
  items!: OrgMember[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/**
 * 「加入成員」的結果(GQL-02:mutation 一律回 payload type)。
 *
 * 清單不隨著回傳:加完之後前端本來就要把 `orgMembers` 整個失效重查(分頁與關鍵字都在前端手上),
 * 把一頁塞進 mutation 的回傳只會有兩份可能不一致的真相。
 * `skippedUserIds` = 送進來時**已經是成員**的那幾位(冪等,不報錯;票面「已是成員的略過並在 payload 回報」)。
 */
@ObjectType()
export class AddOrgMembersPayload {
  @Field(() => [ID])
  addedUserIds!: string[];

  @Field(() => [ID])
  skippedUserIds!: string[];
}
