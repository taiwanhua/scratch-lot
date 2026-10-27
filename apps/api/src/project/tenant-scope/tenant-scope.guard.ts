import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";

import type { GraphqlContext } from "../../auth/request-context";
import { isAtRootOrg, rootOrgError } from "./root-org";

/**
 * 租戶範圍守門(`@RequireTenant()` 掛上):當前組織是根組織 → `FORBIDDEN` + reason `TENANT_ONLY`。
 * 掛在類別層,Nest 先跑類別層再跑方法層的 guard,所以根組織一律拿到同一個原因碼。
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { req } =
      GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const operator = req.operator;
    if (operator !== undefined && isAtRootOrg(operator)) {
      throw rootOrgError();
    }
    return true;
  }
}
