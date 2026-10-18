import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 加入成員(org-manager.md 權限表「加入成員」):**增量加入**,不是全量覆蓋 ——
 * 彈窗送的是這次選的人,組織既有的成員不受影響。
 *
 * 做的事等同於「對每一位使用者的所屬組織加一筆」,所以寫入、資格判斷與稽核
 * 一律走使用者管理那一支(`UsersService.addOrgs`,`docs/modules/user-manager.md`「所屬組織」),
 * 不在組織這一側另寫一套:組織與使用者都必須在操作者的**管理範圍**內,
 * 稽核照樣記 `user.add-org`(targetType = user)。
 *
 * **移除不在這裡**:移除所屬組織會牽動「失去資格的角色」與 dry-run 三檔(ADR-0003),
 * 入口維持使用者管理的「選擇所屬組織」彈窗一處。
 */
@InputType()
export class AddOrgMembersInput {
  /** 要加入的組織;不在操作者管理範圍內即 `NOT_FOUND`。 */
  @Field(() => ID)
  orgId!: string;

  /** 這次要加進來的使用者;已經是成員的會被略過(冪等),不報錯。 */
  @Field(() => [ID])
  userIds!: string[];
}
