import { Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RoleMatrixService } from "../roles/role-matrix.service";
import { AudiencePermissionOptionsPayload } from "./models/audience-permission-options.model";

/**
 * 人員條件的 GraphQL 端點(《底座規格》3.0)。
 *
 * `audiencePermissionOptions` 沒有掛 `@RequirePermission`:它在資料範圍、流程設計、通知設定
 * 等多個使用處共用,而回傳的樹已是「操作者自己持有的」那一份(權限矩陣顯示樹 = 全樹 ∩ 有效權限集,
 * 且扣掉別租戶客製表單的欄位級權限),登入即可讀,不會多看到什麼。
 */
@Resolver()
export class AudienceResolver {
  constructor(private readonly matrix: RoleMatrixService) {}

  @Query(() => AudiencePermissionOptionsPayload, {
    name: "audiencePermissionOptions",
  })
  async audiencePermissionOptions(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<AudiencePermissionOptionsPayload> {
    return { modules: await this.matrix.permissionOptions(operator) };
  }
}
