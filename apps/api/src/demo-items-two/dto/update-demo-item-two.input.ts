import { Field, ID, InputType } from "@nestjs/graphql";

import { ShareOrgInput } from "../../sharing/share-org.model";

/**
 * 編輯示範項目(權限 `demo.sample-two.edit`)。
 *
 * **缺席 / null 的語意差異**(GQL-06;正本 `docs/modules/demo.sample-two.md`「api 介面」):
 * - `name`:缺席 = 不動;不可送 null(型別上就不允許)
 * - `note`:缺席 = 不動、`null` = 清空
 * - `shareOrgs`:缺席 = 不動、`[]` = 不共用;整份替換(ADR-0014),不可送 null
 *
 * 前端只放使用者碰過的欄位,不要為了形式一致把整張表單都送上來。
 */
@InputType()
export class UpdateDemoItemTwoInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}
