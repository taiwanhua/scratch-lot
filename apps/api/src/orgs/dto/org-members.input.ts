import { Field, InputType, Int } from "@nestjs/graphql";

/** 清單分頁預設值(治理模組的表格;上限防呆用,不做設定)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 「成員」頁籤與「加入成員」候選清單共用的分頁 / 篩選。
 *
 * **組織 id 不在這裡**:清單掛在某個實體底下時,那個實體的 id 是獨立參數(GQL-03,
 * 先例 `roleUsers(roleId: ID!, input: RoleUsersInput!)`),input 只放篩選與分頁。
 */
@InputType()
export class OrgMembersInput {
  /** 第幾頁,1 起算。 */
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;

  /** 關鍵字:比對姓名 / 帳號 / Email(不分大小寫的部分比對,與使用者清單同一套欄位)。 */
  @Field(() => String, { nullable: true })
  keyword?: string;
}
