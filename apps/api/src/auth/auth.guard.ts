import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GqlExecutionContext } from "@nestjs/graphql";

import { authError } from "./auth-error";
import { AuthService } from "./auth.service";
import {
  ALLOW_BEFORE_CREDENTIAL_CHANGE_KEY,
  IS_PUBLIC_KEY,
} from "./decorators";
import { OperatorContextService } from "./operator-context.service";
import type { GraphqlContext } from "./request-context";
import { TokenService } from "./token.service";

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * 全域登入守門:未標 `@Public()` 的 resolver 一律要求已登入。
 * 1. 解 `Authorization: Bearer <access token>`(HS256、aud=admin;會員 aud=front 一律拒)
 * 2. 以 userId 現查使用者(停用 → ACCOUNT_DISABLED,下一請求即失效)
 * 3. 組操作者上下文(操作者 id、當前組織、可見範圍)附掛在 request 供 resolver / BaseRepository 使用
 * 4. 首登須改密碼者只放行標 `@AllowMustChangePassword()` 的端點,其餘回 MUST_CHANGE_PASSWORD
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly operatorContexts: OperatorContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const { req } =
      GqlExecutionContext.create(context).getContext<GraphqlContext>();

    const header = req.headers.authorization ?? "";
    const token = BEARER_PREFIX.test(header)
      ? header.replace(BEARER_PREFIX, "").trim()
      : "";
    if (!token) {
      throw authError("UNAUTHENTICATED", "Missing access token");
    }
    const verification = this.tokens.verifyAccessToken(token);
    if (verification.status === "expired") {
      throw authError("TOKEN_EXPIRED", "Access token expired");
    }
    if (verification.status === "invalid") {
      throw authError("UNAUTHENTICATED", "Invalid access token");
    }

    const { userId, currentOrgId } = verification.claims;
    const user = await this.auth.loadActiveUser(userId);
    const { operator } = await this.operatorContexts.resolve(
      userId,
      currentOrgId,
    );
    req.user = user;
    req.operator = operator;

    const isAllowedBeforeChange = this.reflector.getAllAndOverride<boolean>(
      ALLOW_BEFORE_CREDENTIAL_CHANGE_KEY,
      targets,
    );
    if (user.settings.mustChangePassword === true && !isAllowedBeforeChange) {
      throw authError(
        "MUST_CHANGE_PASSWORD",
        "Password must be changed before using this operation",
      );
    }
    return true;
  }
}
