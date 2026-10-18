import {
  type ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";

import type { OperatorContext } from "../database/operator-context";
import type { AuthenticatedRequest, RequestUser } from "./request-context";

export const IS_PUBLIC_KEY = "auth:isPublic";
/** 「首登須改密碼」旗標為 true 時仍放行的端點(metadata 鍵)。 */
export const ALLOW_BEFORE_CREDENTIAL_CHANGE_KEY =
  "auth:allowBeforeCredentialChange";

/**
 * 公開端點:不要求登入(僅 login / refresh / 密碼流程 / 健康檢查)。
 * 未標者一律由全域 guard 要求已登入。
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * 「首登須改密碼」旗標為 true 的使用者仍可使用的端點(me / changePassword / logout / logoutAllDevices);
 * 其餘受保護操作一律回 `MUST_CHANGE_PASSWORD`。
 */
export const AllowMustChangePassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_BEFORE_CREDENTIAL_CHANGE_KEY, true);

function requestOf(context: ExecutionContext): AuthenticatedRequest {
  return GqlExecutionContext.create(context).getContext<{
    req: AuthenticatedRequest;
  }>().req;
}

/** guard 解出的操作者上下文(CONTEXT.md:操作者 / 當前組織 / 可見範圍),可直接餵 BaseRepository。 */
export const CurrentOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OperatorContext => {
    const { operator } = requestOf(context);
    if (!operator) {
      throw new Error(
        "CurrentOperator 只能用在受 guard 保護(非 @Public)的 resolver",
      );
    }
    return operator;
  },
);

/** guard 現查到的使用者(每請求以 userId 現查,v1 不快取,ADR-0003)。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const { user } = requestOf(context);
    if (!user) {
      throw new Error(
        "CurrentUser 只能用在受 guard 保護(非 @Public)的 resolver",
      );
    }
    return user;
  },
);
