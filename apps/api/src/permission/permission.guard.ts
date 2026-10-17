import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GqlExecutionContext } from "@nestjs/graphql";

import { authError } from "../auth/auth-error";
import type { GraphqlContext } from "../auth/request-context";
import { PermissionResolver, holdsPermission } from "./permission-resolver";

/** resolver 所需權限 key 的 metadata 鍵(由 `@RequirePermission` 寫入)。 */
export const REQUIRED_PERMISSION_KEY = "permission:required";

/**
 * 權限守門(ADR-0011「API 防守」):讀 `@RequirePermission` 標註的 key,
 * 以 PermissionResolver 的有效權限集合判斷「key 在集合中,或擁有模組 key + `.*` 在集合中」
 * (`holdsPermission`:別租戶表單的動態權限一律不算持有,`*` 也蓋不到);
 * 無權回 `FORBIDDEN`(有登入但做了不被允許的事,GQL-04)。
 * 由 `@RequirePermission` 以 UseGuards 掛上,必在全域 AuthGuard 之後執行(操作者上下文已在 request 上)。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredKey === undefined) {
      return true;
    }
    const { req } =
      GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const operator = req.operator;
    if (!operator?.actorId) {
      // 防呆:@RequirePermission 與 @Public() 同時標註時沒有登入主體可判斷
      throw authError("UNAUTHENTICATED", "Permission check requires a login");
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    if (!holdsPermission(resolution, requiredKey)) {
      throw authError("FORBIDDEN", `Missing permission ${requiredKey}`);
    }
    return true;
  }
}
