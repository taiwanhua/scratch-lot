import { Field, InputType, Int } from "@nestjs/graphql";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./roles.input";

/**
 * 「加入使用者」彈窗的候選清單分頁。
 * 範圍由 `roleId` 與操作者的管理範圍決定,所以這裡只有分頁與關鍵字。
 */
@InputType()
export class RoleUserCandidatesInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;

  /** 關鍵字:比對姓名 / 帳號 / Email(不分大小寫的部分比對,與使用者清單同一套)。 */
  @Field(() => String, { nullable: true })
  keyword?: string;
}
