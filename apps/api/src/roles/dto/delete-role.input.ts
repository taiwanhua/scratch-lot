import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 刪除角色:前置四項(無授予、非種子角色、非租戶副本、沒被人員條件引用)全過才可(軟刪除,ADR-0007);
 * 不過回 `ROLE_NOT_DELETABLE` 附 `extensions.reasons`(被引用時另帶 `extensions.references`)。
 */
@InputType()
export class DeleteRoleInput {
  @Field(() => ID)
  id!: string;
}
