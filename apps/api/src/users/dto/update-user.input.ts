import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 編輯使用者的基本欄位(user-manager.md「編輯使用者」);
 * 所屬組織與角色各有專用 mutation,不在這裡改。
 *
 * **缺席 = 不動、`null` = 清空**(GQL-06):選填欄位送 `null` 落庫寫 `null`(ADR-0002);
 * 必填欄位(`name` / `account` / `email`)送 `null` 與送空字串同義 → `VALIDATION_FAILED`。
 * 型別要寫成 `string | null`,否則 service 會對 `null` 直接 `.trim()`。
 */
@InputType()
export class UpdateUserInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  account?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  nickname?: string | null;

  @Field(() => String, { nullable: true })
  gender?: string | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  /** 身分證字號:要改須持 `system.user-manager.edit-national-id`(ADR-0007);`null` 或空字串 = 清除。 */
  @Field(() => String, { nullable: true })
  nationalId?: string | null;
}
