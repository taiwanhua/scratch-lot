import { Field, ObjectType } from "@nestjs/graphql";

import { RoleMatrixModule } from "../../roles/models/role-matrix.model";

/**
 * 人員條件的權限選項(AudiencePicker 的可搜尋模組 / 權限樹;GQL-02 payload)。
 * 樹與權限矩陣的**顯示樹**同一份(`RoleMatrixService.permissionOptions`)。
 */
@ObjectType("AudiencePermissionOptionsPayload")
export class AudiencePermissionOptionsPayload {
  @Field(() => [RoleMatrixModule])
  modules!: RoleMatrixModule[];
}
